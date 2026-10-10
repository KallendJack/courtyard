import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { err, ok, type Result } from "../result.ts";

/**
 * GitHub itself, as the worker asks it (#99): signing in through Courtyard's GitHub App with a
 * device code, refreshing the sign-in, who is signed in with which repos, and a session branch's
 * pull request: its state and checks (#172), its files, Merge and Close (#160). Passed in to the
 * worker like the clock, so tests use an in-memory fake; this file is the one real one.
 */
export type GitHubApi = {
  /** Starts a device sign-in: the code for the owner to enter, where, and for how long. */
  readonly startSignIn: () => Promise<Result<DeviceSignIn, string>>;
  /**
   * Waits for the owner to enter the code and say yes on GitHub, asking as often as GitHub
   * allows, until they do, the code runs out, they say no, or `signal` gives up.
   */
  readonly finishSignIn: (
    device: DeviceSignIn,
    signal: AbortSignal,
  ) => Promise<Result<UserToken, SignInEnd>>;
  /** A new token for the refresh token, or `lapsed` when GitHub won't take it any more. */
  readonly refresh: (refreshToken: string) => Promise<Result<UserToken, "lapsed" | "failed">>;
  /** The account a token signs in as, and the repos the GitHub App is installed on there. */
  readonly account: (accessToken: string) => Promise<Result<GitHubAccount, string>>;
  /**
   * The latest pull request from `branch` in `repo` (`owner/name`), whatever its state, with the
   * checks on its latest commit (#172); `null` when there's none.
   */
  readonly pullRequest: (
    accessToken: string,
    find: { readonly repo: string; readonly branch: string },
  ) => Promise<Result<FoundPullRequest | null, string>>;
  /** The files pull request `number` in `repo` changes, each with its diff (#160). */
  readonly pullRequestFiles: (
    accessToken: string,
    pull: { readonly repo: string; readonly number: number },
  ) => Promise<Result<readonly FoundFile[], string>>;
  /**
   * Merges pull request `number` in `repo`, only while its latest commit is still `head` (#160):
   * GitHub's reason in plain words when it won't.
   */
  readonly merge: (
    accessToken: string,
    pull: { readonly repo: string; readonly number: number; readonly head: string },
  ) => Promise<Result<null, string>>;
  /** Closes pull request `number` in `repo` without merging it (#160). */
  readonly close: (
    accessToken: string,
    pull: { readonly repo: string; readonly number: number },
  ) => Promise<Result<null, string>>;
  /** Deletes `branch` from `repo`, once its session's pull request was merged or closed. */
  readonly deleteBranch: (
    accessToken: string,
    find: { readonly repo: string; readonly branch: string },
  ) => Promise<Result<null, string>>;
};

/** A pull request as GitHub has it. */
export type FoundPullRequest = {
  readonly number: number;
  readonly url: string;
  readonly state: "open" | "merged" | "closed";
  /** Its latest commit. */
  readonly head: string;
  /** The branch it merges into. */
  readonly base: string;
  readonly checks: readonly FoundCheck[];
  /** Lines added and removed, and files changed, over the whole pull request. */
  readonly changes: {
    readonly additions: number;
    readonly deletions: number;
    readonly files: number;
  };
  /** It conflicts with its base, so GitHub can't merge it. */
  readonly conflicts: boolean;
};

/** A file a pull request changes, and its diff: `null` when GitHub shows none (binary, too large). */
export type FoundFile = {
  readonly path: string;
  readonly status: "added" | "removed" | "modified" | "renamed";
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string | null;
};

/** One check on a pull request's latest commit, and how it's going. */
export type FoundCheck = {
  readonly name: string;
  /** `other` for one that ended neither passing nor failing: skipped, cancelled. */
  readonly outcome: "running" | "passed" | "failed" | "other";
};

/** A device sign-in in progress. Only `link`, `code` and when it runs out reach the browser. */
export type DeviceSignIn = {
  /** GitHub's secret for this sign-in, which the worker asks with: never shown. */
  readonly deviceCode: string;
  /** What the owner enters on GitHub: "WDJB-MJHT". */
  readonly code: string;
  readonly link: string;
  /** Seconds until the code runs out. */
  readonly expiresIn: number;
  /** The fewest seconds between two asks. */
  readonly interval: number;
};

/** How a device sign-in ended without signing in. */
export type SignInEnd = "expired" | "denied" | "cancelled" | "failed";

/**
 * A GitHub App's user token: the access token, and, when it runs out (8 hours, unless the app's
 * tokens don't), the refresh token for the next one.
 */
export type UserToken = {
  readonly accessToken: string;
  /** Seconds until the access token runs out, or `null` when it doesn't. */
  readonly expiresIn: number | null;
  readonly refreshToken: string | null;
};

export type GitHubAccount = { readonly login: string; readonly repos: readonly string[] };

// GitHub's tokens and names are plain letters, digits, `_` and `-`; anything else is refused, so
// nothing GitHub sends can break the files they're written into.
const Token = z.string().regex(/^[A-Za-z0-9_]+$/);
const Login = z.string().regex(/^[A-Za-z0-9-]+$/);

const DeviceCodeAnswer = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url({ protocol: /^https$/ }),
  expires_in: z.number().positive(),
  interval: z.number().nonnegative(),
});

const TokenAnswer = z.object({
  access_token: Token,
  expires_in: z.number().positive().optional(),
  refresh_token: Token.optional(),
});
const ErrorAnswer = z.object({ error: z.string(), interval: z.number().optional() });

const User = z.object({ login: Login });
const Installations = z.object({ installations: z.array(z.object({ id: z.number() })) });
const Repositories = z.object({
  total_count: z.number(),
  repositories: z.array(z.object({ full_name: z.string() })),
});

const Pulls = z.array(z.object({ number: z.number().int().positive() }));
/** One pull request, with what only asking for it alone gives: its size and whether it merges. */
const Pull = z.object({
  number: z.number().int().positive(),
  html_url: z.url({ protocol: /^https$/ }),
  state: z.enum(["open", "closed"]),
  merged_at: z.string().nullable(),
  head: z.object({ sha: z.string().regex(/^[0-9a-f]+$/) }),
  base: z.object({ ref: z.string() }),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
  /** `null` while GitHub is still working it out. */
  mergeable: z.boolean().nullable(),
});
const PullFiles = z.array(
  z.object({
    filename: z.string().min(1),
    status: z.string(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    patch: z.string().optional(),
  }),
);
const Refusal = z.object({ message: z.string() });

/** GitHub's file statuses as Courtyard shows them: a copied file is added, say. */
const statusOf = (status: string): FoundFile["status"] => {
  switch (status) {
    case "added":
    case "copied":
      return "added";
    case "removed":
    case "renamed":
      return status;
    default:
      return "modified";
  }
};
const CheckRuns = z.object({
  check_runs: z.array(
    z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
  ),
});

/** What GitHub calls a check that ended in failure. */
const FAILED = new Set(["failure", "timed_out", "action_required", "startup_failure"]);

const outcomeOf = (run: { status: string; conclusion: string | null }): FoundCheck["outcome"] => {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "passed";
  return run.conclusion !== null && FAILED.has(run.conclusion) ? "failed" : "other";
};

/** A repository as `owner/name`, and a branch, safe to put in GitHub's addresses. */
const RepoName = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);

const tokenOf = (answer: z.infer<typeof TokenAnswer>): UserToken => ({
  accessToken: answer.access_token,
  expiresIn: answer.expires_in ?? null,
  refreshToken: answer.refresh_token ?? null,
});

/** How long any one request to GitHub may take. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Seconds GitHub adds to the wait between asks when it says to slow down. */
const SLOW_DOWN_SECONDS = 5;
/** The most repos read from one installation: a page of GitHub's at a time. */
const PAGE = 100;
/** The most pages of a pull request's files read: GitHub lists up to 3,000, a review shows 300. */
const FILE_PAGES = 3;

/**
 * GitHub, through the GitHub App whose client ID the owner set (`COURTYARD_GITHUB_CLIENT_ID`).
 * A device sign-in needs only the client ID, never a secret, and so does refreshing its token.
 */
export const createGitHubApi = (options: { clientId: string }): GitHubApi => {
  /** Posts a form to github.com's sign-in, and reads the JSON answer. */
  const signInPost = async (path: string, fields: Record<string, string>, signal?: AbortSignal) => {
    const response = await fetch(`https://github.com${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: options.clientId, ...fields }),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return (await response.json()) as unknown;
  };

  /** Asks GitHub's API as the account signed in with `token`, sending `body` as JSON if any. */
  const apiRequest = (token: string, path: string, send?: { method: string; body: unknown }) =>
    fetch(`https://api.github.com${path}`, {
      ...(send === undefined
        ? {}
        : {
            method: send.method,
            body: JSON.stringify(send.body),
          }),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "Courtyard",
        "x-github-api-version": "2022-11-28",
        ...(send === undefined ? {} : { "content-type": "application/json" }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  /** Reads one of GitHub's API answers as the account signed in with `token`. */
  const apiGet = async <T>(token: string, path: string, schema: z.ZodType<T>) => {
    const response = await apiRequest(token, path);
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return schema.parse(await response.json());
  };

  /**
   * Changes something on GitHub: nothing once it's done, or GitHub's reason in its own words when
   * it won't (`fallback` when it gives none, or can't be reached).
   */
  const apiChange = async (
    token: string,
    path: string,
    change: { method: string; body: unknown; fallback: string },
  ): Promise<Result<null, string>> => {
    try {
      const response = await apiRequest(token, path, change);
      if (response.ok) return ok(null);
      const refused = Refusal.safeParse(await response.json().catch(() => undefined));
      return err(refused.success ? `GitHub said: ${refused.data.message}` : change.fallback);
    } catch {
      return err(change.fallback);
    }
  };

  return {
    startSignIn: async () => {
      try {
        const answer = DeviceCodeAnswer.safeParse(await signInPost("/login/device/code", {}));
        if (!answer.success) return err("GitHub didn't give a sign-in code. Is device flow on?");
        return ok({
          deviceCode: answer.data.device_code,
          code: answer.data.user_code,
          link: answer.data.verification_uri,
          expiresIn: answer.data.expires_in,
          interval: answer.data.interval,
        });
      } catch {
        return err("GitHub couldn't be reached.");
      }
    },

    finishSignIn: async (device, signal) => {
      let interval = device.interval;
      // GitHub says when the code runs out; this is in case it can't be reached to say so.
      const expiresAt = Date.now() + device.expiresIn * 1000;
      for (;;) {
        if (Date.now() > expiresAt) return err("expired");
        try {
          await wait(interval * 1000, undefined, { signal });
          const answer = await signInPost(
            "/login/oauth/access_token",
            {
              device_code: device.deviceCode,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            },
            AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          );
          const token = TokenAnswer.safeParse(answer);
          if (token.success) return ok(tokenOf(token.data));
          const refused = ErrorAnswer.safeParse(answer);
          if (!refused.success) return err("failed");
          switch (refused.data.error) {
            case "authorization_pending":
              continue;
            case "slow_down":
              interval = refused.data.interval ?? interval + SLOW_DOWN_SECONDS;
              continue;
            case "expired_token":
            case "token_expired":
              return err("expired");
            case "access_denied":
              return err("denied");
            default:
              return err("failed");
          }
        } catch {
          // Given up on, or GitHub couldn't be reached: asking again unless it was given up on.
          if (signal.aborted) return err("cancelled");
        }
      }
    },

    refresh: async (refreshToken) => {
      try {
        const answer = await signInPost("/login/oauth/access_token", {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        });
        const token = TokenAnswer.safeParse(answer);
        if (token.success) return ok(tokenOf(token.data));
        const refused = ErrorAnswer.safeParse(answer);
        return err(
          refused.success && refused.data.error === "bad_refresh_token" ? "lapsed" : "failed",
        );
      } catch {
        return err("failed");
      }
    },

    account: async (accessToken) => {
      try {
        const user = await apiGet(accessToken, "/user", User);
        const { installations } = await apiGet(
          accessToken,
          `/user/installations?per_page=${PAGE}`,
          Installations,
        );
        const repos: string[] = [];
        for (const { id } of installations) {
          for (let page = 1; ; page += 1) {
            const listed = await apiGet(
              accessToken,
              `/user/installations/${id}/repositories?per_page=${PAGE}&page=${page}`,
              Repositories,
            );
            repos.push(...listed.repositories.map((repo) => repo.full_name));
            if (listed.repositories.length < PAGE) break;
          }
        }
        return ok({ login: user.login, repos: repos.sort() });
      } catch {
        return err("GitHub couldn't be asked who's signed in.");
      }
    },

    pullRequest: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      const [owner] = repo.data.split("/");
      try {
        const head = encodeURIComponent(`${owner}:${find.branch}`);
        const [latest] = await apiGet(
          accessToken,
          `/repos/${repo.data}/pulls?head=${head}&state=all&per_page=1`,
          Pulls,
        );
        if (latest === undefined) return ok(null);
        const pull = await apiGet(accessToken, `/repos/${repo.data}/pulls/${latest.number}`, Pull);
        const { check_runs } = await apiGet(
          accessToken,
          `/repos/${repo.data}/commits/${pull.head.sha}/check-runs?per_page=${PAGE}`,
          CheckRuns,
        );
        return ok({
          number: pull.number,
          url: pull.html_url,
          state: pull.merged_at !== null ? "merged" : pull.state,
          head: pull.head.sha,
          base: pull.base.ref,
          checks: check_runs.map((run) => ({ name: run.name, outcome: outcomeOf(run) })),
          changes: {
            additions: pull.additions,
            deletions: pull.deletions,
            files: pull.changed_files,
          },
          conflicts: pull.mergeable === false,
        });
      } catch {
        return err("GitHub couldn't be asked about the pull request.");
      }
    },

    pullRequestFiles: async (accessToken, pull) => {
      const repo = RepoName.safeParse(pull.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      try {
        const files: FoundFile[] = [];
        for (let page = 1; page <= FILE_PAGES; page += 1) {
          const listed = await apiGet(
            accessToken,
            `/repos/${repo.data}/pulls/${pull.number}/files?per_page=${PAGE}&page=${page}`,
            PullFiles,
          );
          files.push(
            ...listed.map((file) => ({
              path: file.filename,
              status: statusOf(file.status),
              additions: file.additions,
              deletions: file.deletions,
              patch: file.patch ?? null,
            })),
          );
          if (listed.length < PAGE) break;
        }
        return ok(files);
      } catch {
        return err("GitHub couldn't be asked what the pull request changes.");
      }
    },

    merge: async (accessToken, pull) => {
      const repo = RepoName.safeParse(pull.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      return apiChange(accessToken, `/repos/${repo.data}/pulls/${pull.number}/merge`, {
        method: "PUT",
        // Only the commit the owner reviewed: GitHub refuses if more was pushed since.
        body: { sha: pull.head },
        fallback: "GitHub couldn't merge the pull request.",
      });
    },

    close: async (accessToken, pull) => {
      const repo = RepoName.safeParse(pull.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      return apiChange(accessToken, `/repos/${repo.data}/pulls/${pull.number}`, {
        method: "PATCH",
        body: { state: "closed" },
        fallback: "GitHub couldn't close the pull request.",
      });
    },

    deleteBranch: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      const ref = find.branch.split("/").map(encodeURIComponent).join("/");
      return apiChange(accessToken, `/repos/${repo.data}/git/refs/heads/${ref}`, {
        method: "DELETE",
        body: {},
        fallback: "GitHub couldn't delete the branch.",
      });
    },
  };
};
