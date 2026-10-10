import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GitHubConnection } from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, removeFile, writeBytesIn, writeJsonFile } from "../files.ts";
import { err, ok, type Result } from "../result.ts";
import type { DeviceSignIn, GitHubApi, UserToken } from "./api.ts";

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
