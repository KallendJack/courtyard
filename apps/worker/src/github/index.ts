import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type GitHubConnection,
  type MergeReadiness,
  PullRequest,
  type PullRequestChecks,
  PullRequestReview,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, removeFile, writeBytesIn, writeJsonFile } from "../files.ts";
import { err, ok, type Result } from "../result.ts";
import type { DeviceSignIn, FoundCheck, FoundPullRequest, GitHubApi, UserToken } from "./api.ts";

export type { GitHubApi } from "./api.ts";

/**
 * Courtyard's own GitHub sign-in (#99), through the GitHub App the owner registered and installed
 * on the repos they chose: the only place that knows GitHub. The sign-in is kept in the data
 * folder and handed to a code session's `git` and `gh` through the environment their commands run
 * in, never to the browser, the event log, the context folder or a model.
 */

/** Where the sign-in is kept, in the data folder. */
const FOLDER = "github";
const SIGN_IN_FILE = "sign-in.json";
/** The `gh` config folder Courtyard keeps for code sessions, so `gh` never reads the machine's. */
const GH_FOLDER = "gh";

const Stored = z.object({
  account: z.string(),
  accessToken: z.string(),
  /** When the access token runs out, or `null` when it doesn't. */
  expiresAt: z.iso.datetime().nullable(),
  refreshToken: z.string().nullable(),
});
type Stored = z.infer<typeof Stored>;

/** How long the account's repos are reused before GitHub is asked again. */
const REPOS_TTL_MS = 60_000;
/**
 * How long before the access token runs out it's refreshed (it lasts 8 hours), so a command
 * never runs with one about to run out.
 */
const REFRESH_BEFORE_MS = 60 * 60 * 1000;
/** How often the sign-in is checked and refreshed when it's close to running out. */
export const KEEP_FRESH_EVERY_MS = 5 * 60 * 1000;

/** Why the GitHub sign-in couldn't be acted on. */
export type GitHubProblem =
  | { readonly kind: "not-set-up" }
  /** No one is signed in to GitHub from Connections. */
  | { readonly kind: "signed-out" }
  /** GitHub couldn't do it, in plain words. */
  | { readonly kind: "github"; readonly message: string }
  | { readonly kind: "storage" };

/** A sign-in started from Connections and not yet finished, or why the last one didn't. */
type Pending =
  | {
      readonly kind: "waiting";
      readonly device: DeviceSignIn;
      readonly expiresAt: string;
      readonly stop: AbortController;
    }
  | { readonly kind: "not-finished"; readonly why: "expired" | "denied" | "failed" };

/** `gh`'s settings: version 1, so it doesn't stop to move them about, never prompting. */
const GH_CONFIG = 'version: "1"\ngit_protocol: https\nprompt: disabled\n';

/**
 * What `gh`'s config folder holds while no one is signed in: an account and token that work
 * nowhere. With no token there, `gh` (and git, through it) would fall back to the machine's own
 * login in its keyring.
 */
const STAND_IN = "courtyard-signed-out";

/** `gh`'s record of the account signed in to github.com, with its token. */
const ghHosts = (account: string, token: string) =>
  [
    "github.com:",
    "    users:",
    `        ${account}:`,
    `            oauth_token: ${token}`,
    "    git_protocol: https",
    `    oauth_token: ${token}`,
    `    user: ${account}`,
    "",
  ].join("\n");

/**
 * Where a GitHub login on the worker machine could come from, besides `gh`'s own config folder
 * and git's credential helpers: each is unset for a code session's commands.
 */
const MACHINE_LOGINS = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GH_HOST",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
];

/**
 * Git's settings for a code session's commands, as `GIT_CONFIG_*` variables: no credential helper
 * of the machine's, only `gh`'s, which reads Courtyard's `gh` config folder; and GitHub over HTTPS
 * even for a repo cloned over SSH, so the machine's SSH key is never used either.
 */
const GIT_SETTINGS: readonly (readonly [string, string])[] = [
  // An empty helper clears every helper set before it, the machine's included.
  ["credential.helper", ""],
  ["credential.helper", "!gh auth git-credential"],
  ["url.https://github.com/.insteadOf", "git@github.com:"],
  ["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
];

/**
 * Where a pull request's checks stand, from each check: failed when any has, by name, so its
 * session can start on a fix while the rest run; else running while any is.
 */
const checksOf = (checks: readonly FoundCheck[]): PullRequestChecks => {
  const failed = [
    ...new Set(checks.filter((check) => check.outcome === "failed").map((check) => check.name)),
  ];
  const [first, ...more] = failed;
  if (first !== undefined) return { kind: "failed", failed: [first, ...more] };
  if (checks.some((check) => check.outcome === "running")) return { kind: "running" };
  return checks.length === 0 ? { kind: "none" } : { kind: "passed" };
};

/** Names in a sentence: "e2e", "verify and e2e", "check, verify and e2e". */
const namesOf = (names: readonly string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Whether Merge can merge a pull request now (#160), or why not in the owner's words: never while
 * it conflicts with its base, or a check on its latest commit fails or is still running.
 */
const mergeReadiness = (pull: FoundPullRequest): MergeReadiness => {
  const refused = (reason: string) => ({ kind: "refused", reason }) as const;
  if (pull.state !== "open") return refused(`It's ${pull.state} already.`);
  if (pull.conflicts) {
    return refused(
      `It conflicts with ${pull.base}. Ask the session to bring its branch up to date.`,
    );
  }
  const named = (outcome: FoundCheck["outcome"]) => [
    ...new Set(pull.checks.filter((check) => check.outcome === outcome).map((check) => check.name)),
  ];
  const failed = named("failed");
  if (failed.length > 0) return refused(`Merge waits for ${namesOf(failed)} to pass.`);
  const running = named("running");
  if (running.length > 0) return refused(`Merge waits for ${namesOf(running)} to finish.`);
  return { kind: "ready" };
};

export const createGitHub = (options: {
  api: GitHubApi | null;
  dataDir: string;
  now: () => number;
}) => {
  const { api, now } = options;
  const folder = join(options.dataDir, FOLDER);
  const signInFile = join(folder, SIGN_IN_FILE);
  const ghFolder = join(folder, GH_FOLDER);
  let pending: Pending | undefined;
  let repos: { token: string; at: number; repos: readonly string[] | null } | undefined;
  /** Changes to the sign-in, one at a time, so a refresh and a sign-out never cross. */
  let changing: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(change: () => Promise<T>): Promise<T> => {
    const done = changing.then(change);
    changing = done.catch(() => undefined);
    return done;
  };

  const read = async (): Promise<Result<Stored | undefined, "storage">> => {
    const stored = await readJsonFile(signInFile, Stored);
    return stored.ok ? ok(stored.value) : err("storage");
  };

  const ghConfigFile = join(ghFolder, "config.yml");
  const ghHostsFile = join(ghFolder, "hosts.yml");

  /** Writes Courtyard's `gh` config folder, signed in as `account` with `token`. */
  const writeGh = async (account: string, token: string) =>
    (await writeBytesIn(ghConfigFile, Buffer.from(GH_CONFIG))) &&
    (await writeBytesIn(ghHostsFile, Buffer.from(ghHosts(account, token))));

  /** Keeps the sign-in, and `gh`'s copy of it in Courtyard's own `gh` config folder. */
  const keep = async (stored: Stored) => {
    try {
      await mkdir(folder, { recursive: true });
    } catch {
      return false;
    }
    const written = await writeJsonFile(signInFile, stored);
    return written.ok && (await writeGh(stored.account, stored.accessToken));
  };

  /** Forgets the sign-in, leaving `gh` the stand-in that works nowhere. */
  const forget = async () => {
    repos = undefined;
    return (await removeFile(signInFile)) && (await writeGh(STAND_IN, STAND_IN));
  };

  /**
   * Makes sure `gh`'s config folder is there before a command reads it, with the stand-in while
   * no one has signed in yet. Synchronous, as building a command's environment is; it never
   * replaces a sign-in written meanwhile.
   */
  const ensureGh = () => {
    if (existsSync(ghHostsFile)) return true;
    try {
      mkdirSync(ghFolder, { recursive: true });
      writeFileSync(ghConfigFile, GH_CONFIG, { mode: 0o600 });
      writeFileSync(ghHostsFile, ghHosts(STAND_IN, STAND_IN), { mode: 0o600, flag: "wx" });
    } catch {
      // Written meanwhile (the sign-in just kept), or it can't be written.
    }
    return existsSync(ghHostsFile);
  };

  const storedFrom = (account: string, token: UserToken): Stored => ({
    account,
    accessToken: token.accessToken,
    expiresAt:
      token.expiresIn === null ? null : new Date(now() + token.expiresIn * 1000).toISOString(),
    refreshToken: token.refreshToken,
  });

  /** Follows a device sign-in to its end, keeping the sign-in once the owner has said yes. */
  const follow = async (github: GitHubApi, waiting: Pending & { kind: "waiting" }) => {
    const finished = await github.finishSignIn(waiting.device, waiting.stop.signal);
    // Cancelled, or replaced by a newer sign-in: that one says where things stand.
    if (pending !== waiting) return;
    if (!finished.ok) {
      pending =
        finished.error === "cancelled" ? undefined : { kind: "not-finished", why: finished.error };
      return;
    }
    const account = await github.account(finished.value.accessToken);
    const kept =
      account.ok && (await oneAtATime(() => keep(storedFrom(account.value.login, finished.value))));
    if (pending !== waiting) return;
    pending = kept ? undefined : { kind: "not-finished", why: "failed" };
  };

  /** The repos the GitHub App is installed on, asked of GitHub at most once a minute. */
  const reposOf = async (github: GitHubApi, token: string) => {
    if (repos !== undefined && repos.token === token && now() - repos.at < REPOS_TTL_MS) {
      return repos.repos;
    }
    const account = await github.account(token);
    repos = { token, at: now(), repos: account.ok ? account.value.repos : null };
    return repos.repos;
  };

  /**
   * Refreshes the access token when it's close to running out. GitHub refusing the refresh token
   * (after six months unused) ends the sign-in; GitHub out of reach leaves it to try again.
   */
  const refreshIfDue = (github: GitHubApi) =>
    oneAtATime(async () => {
      const stored = await read();
      if (!stored.ok || stored.value === undefined) return;
      const { expiresAt, refreshToken } = stored.value;
      if (expiresAt === null || Date.parse(expiresAt) - now() > REFRESH_BEFORE_MS) return;
      if (refreshToken === null) return;
      const refreshed = await github.refresh(refreshToken);
      if (refreshed.ok) await keep(storedFrom(stored.value.account, refreshed.value));
      else if (refreshed.error === "lapsed") await forget();
    });

  /** GitHub and the access token signed in now, or why there's none to ask with. */
  const tokenFor = async (
    github: GitHubApi | null,
  ): Promise<Result<{ github: GitHubApi; token: string }, GitHubProblem>> => {
    if (github === null) return err({ kind: "not-set-up" });
    const stored = await read();
    if (!stored.ok) return err({ kind: "storage" });
    if (stored.value === undefined) return err({ kind: "signed-out" });
    return ok({ github, token: stored.value.accessToken });
  };

  return {
    status: async (): Promise<Result<GitHubConnection, "storage">> => {
      if (api === null) return ok({ kind: "not-set-up" });
      if (pending?.kind === "waiting") {
        const { device, expiresAt } = pending;
        return ok({ kind: "waiting", link: device.link, code: device.code, expiresAt });
      }
      if (pending?.kind === "not-finished") return ok(pending);
      const stored = await read();
      if (!stored.ok) return stored;
      if (stored.value === undefined) return ok({ kind: "signed-out" });
      const { account, accessToken } = stored.value;
      return ok({
        kind: "signed-in",
        account,
        repos: (await reposOf(api, accessToken))?.slice() ?? null,
      });
    },

    /**
     * Starts a sign-in with a device code. Signed in already, it's Switch: the account signed in
     * stays until the new sign-in finishes.
     */
    start: async (): Promise<Result<null, GitHubProblem>> => {
      if (api === null) return err({ kind: "not-set-up" });
      if (pending?.kind === "waiting") pending.stop.abort();
      pending = undefined;
      const device = await api.startSignIn();
      if (!device.ok) return err({ kind: "github", message: device.error });
      const waiting = {
        kind: "waiting",
        device: device.value,
        expiresAt: new Date(now() + device.value.expiresIn * 1000).toISOString(),
        stop: new AbortController(),
      } as const;
      pending = waiting;
      void follow(api, waiting);
      return ok(null);
    },

    /** Gives up a sign-in in progress, or forgets one that didn't finish. */
    cancel: () => {
      if (pending?.kind === "waiting") pending.stop.abort();
      pending = undefined;
    },

    signOut: async (): Promise<Result<null, GitHubProblem>> => {
      if (pending?.kind === "waiting") pending.stop.abort();
      pending = undefined;
      return (await oneAtATime(forget)) ? ok(null) : err({ kind: "storage" });
    },

    /**
     * The latest pull request from `branch` in `repo` (`owner/name`), as a session shows it
     * (#172): `undefined` when there's none, or no one is signed in to ask.
     */
    pullRequest: async (find: {
      repo: string;
      branch: string;
    }): Promise<Result<PullRequest | undefined, GitHubProblem>> => {
      if (api === null) return err({ kind: "not-set-up" });
      const stored = await read();
      if (!stored.ok) return err({ kind: "storage" });
      if (stored.value === undefined) return ok(undefined);
      const found = await api.pullRequest(stored.value.accessToken, find);
      if (!found.ok) return err({ kind: "github", message: found.error });
      if (found.value === null) return ok(undefined);
      const parsed = PullRequest.safeParse({
        ...found.value,
        checks: checksOf(found.value.checks),
      });
      return parsed.success
        ? ok(parsed.data)
        : err({ kind: "github", message: "GitHub's pull request couldn't be read." });
    },

    /**
     * The latest pull request from `branch` in `repo` as the owner reviews it (#160): the files it
     * changes with their diffs, its checks by name, and whether Merge can merge it now.
     */
    review: async (find: {
      repo: string;
      branch: string;
    }): Promise<Result<PullRequestReview | undefined, GitHubProblem>> => {
      const signedIn = await tokenFor(api);
      if (!signedIn.ok) return signedIn;
      const { github, token } = signedIn.value;
      const found = await github.pullRequest(token, find);
      if (!found.ok) return err({ kind: "github", message: found.error });
      if (found.value === null) return ok(undefined);
      const pull = found.value;
      const files = await github.pullRequestFiles(token, { repo: find.repo, number: pull.number });
      if (!files.ok) return err({ kind: "github", message: files.error });
      const parsed = PullRequestReview.safeParse({
        pullRequest: { ...pull, checks: checksOf(pull.checks) },
        branch: find.branch,
        base: pull.base,
        checks: pull.checks,
        files: files.value,
        merge: mergeReadiness(pull),
      });
      return parsed.success
        ? ok(parsed.data)
        : err({ kind: "github", message: "GitHub's pull request couldn't be read." });
    },

    /** Merges pull request `number` in `repo`, only while its latest commit is `head` (#160). */
    merge: async (pull: {
      repo: string;
      number: number;
      head: string;
    }): Promise<Result<null, GitHubProblem>> => {
      const signedIn = await tokenFor(api);
      if (!signedIn.ok) return signedIn;
      const merged = await signedIn.value.github.merge(signedIn.value.token, pull);
      return merged.ok ? merged : err({ kind: "github", message: merged.error });
    },

    /** Closes pull request `number` in `repo` without merging it (#160). */
    close: async (pull: { repo: string; number: number }): Promise<Result<null, GitHubProblem>> => {
      const signedIn = await tokenFor(api);
      if (!signedIn.ok) return signedIn;
      const closed = await signedIn.value.github.close(signedIn.value.token, pull);
      return closed.ok ? closed : err({ kind: "github", message: closed.error });
    },

    /** For the worker's repeating jobs: refreshes the sign-in when it's close to running out. */
    keepFresh: async () => {
      if (api !== null) await refreshIfDue(api);
    },

    /**
     * What a code session's commands get on top of the worker's environment (story 25): `gh`
     * reading Courtyard's own config folder, git asking only `gh` for GitHub's credentials, and
     * every way to the machine's own GitHub login unset (an `undefined` is unset). No token is in
     * it, only where `gh` keeps Courtyard's; or, if that folder can't be written, the stand-in, so
     * `gh` still never reaches for the machine's keyring.
     */
    commandEnv: (): Readonly<Record<string, string | undefined>> => ({
      ...Object.fromEntries(MACHINE_LOGINS.map((name) => [name, undefined])),
      ...(ensureGh() ? {} : { GH_TOKEN: STAND_IN }),
      GH_CONFIG_DIR: ghFolder,
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      GIT_CONFIG_COUNT: String(GIT_SETTINGS.length),
      ...Object.fromEntries(
        GIT_SETTINGS.flatMap(([key, value], index) => [
          [`GIT_CONFIG_KEY_${index}`, key],
          [`GIT_CONFIG_VALUE_${index}`, value],
        ]),
      ),
    }),
  };
};

export type GitHub = ReturnType<typeof createGitHub>;
