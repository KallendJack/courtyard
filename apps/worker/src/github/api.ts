import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { err, ok, type Result } from "../result.ts";

/**
 * GitHub itself, as the worker asks it (#99): signing in through Courtyard's GitHub App with a
 * device code, refreshing the sign-in, who is signed in with which repos, and a session branch's
 * pull request: its state and checks (#172), its files, Merge and Close (#160); main's build
 * (#249), and re-running it and filing what fails again (#355). Passed in to the
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
   * The repos the GitHub App is installed on, with what New workspace → Code shows of each and
   * where git clones it from (#258).
   */
  readonly repositories: (accessToken: string) => Promise<Result<readonly FoundRepo[], string>>;
  /**
   * The latest pull request from `branch` in `repo` (`owner/name`), whatever its state, with the
   * checks on its latest commit (#172); `null` when there's none.
   */
  readonly pullRequest: (
    accessToken: string,
    find: { readonly repo: string; readonly branch: string },
  ) => Promise<Result<FoundPullRequest | null, string>>;
  /** Pull request `number` in `repo`, whatever its state (#278); `null` when there's none. */
  readonly pullRequestNumbered: (
    accessToken: string,
    pull: { readonly repo: string; readonly number: number },
  ) => Promise<Result<FoundPullRequest | null, string>>;
  /** Every open pull request in `repo`, latest first, whoever opened it (#278). */
  readonly openPullRequests: (
    accessToken: string,
    find: { readonly repo: string },
  ) => Promise<Result<readonly FoundPullRequest[], string>>;
  /** The checks on `commit` in `repo` (#249): main's build, one per CI job, each try of it. */
  readonly commitChecks: (
    accessToken: string,
    find: { readonly repo: string; readonly commit: string },
  ) => Promise<Result<readonly FoundCheckRun[], string>>;
  /**
   * The workflows that ran on `commit` in `repo` (#337): each one's file as it was on that commit,
   * which says which job waits on which, and whether its latest try has finished.
   */
  readonly commitWorkflows: (
    accessToken: string,
    find: { readonly repo: string; readonly commit: string },
  ) => Promise<Result<readonly FoundWorkflow[], string>>;
  /** The files pull request `number` in `repo` changes, each with its diff (#160). */
  readonly pullRequestFiles: (
    accessToken: string,
    pull: { readonly repo: string; readonly number: number },
  ) => Promise<Result<readonly FoundFile[], string>>;
  /**
   * The open issues in `repo` with `label` (#301's Next up), each with its milestone and, asked
   * `forBuild`, what says whether it can be built now: its comments' text, which say whether
   * someone has claimed it, and the open issues it's blocked by (#377) (none of either otherwise).
   */
  readonly openIssues: (
    accessToken: string,
    find: { readonly repo: string; readonly label: string; readonly forBuild: boolean },
  ) => Promise<Result<readonly FoundIssue[], string>>;
  /**
   * The title and description of each open pull request in `repo` (#301): what says which issues
   * they close. Lighter than `openPullRequests`, which asks for each one's checks.
   */
  readonly openPullRequestTexts: (
    accessToken: string,
    find: { readonly repo: string },
  ) => Promise<Result<readonly { readonly title: string; readonly body: string }[], string>>;
  /** Comments on issue `number` in `repo` (Build's claim, #298). */
  readonly commentOnIssue: (
    accessToken: string,
    comment: { readonly repo: string; readonly number: number; readonly body: string },
  ) => Promise<Result<null, string>>;
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
  /** The names of `repo`'s labels (#181). */
  readonly labels: (
    accessToken: string,
    find: { readonly repo: string },
  ) => Promise<Result<readonly string[], string>>;
  /** Makes a label in `repo` (#181): GitHub's reason in plain words when it won't. */
  readonly createLabel: (
    accessToken: string,
    label: {
      readonly repo: string;
      readonly name: string;
      readonly color: string;
      readonly description: string;
    },
  ) => Promise<Result<null, string>>;
  /** Re-runs the failed jobs of each workflow run on `commit` in `repo` (#355). */
  readonly rerunFailedJobs: (
    accessToken: string,
    find: { readonly repo: string; readonly commit: string },
  ) => Promise<Result<null, string>>;
  /**
   * The failing test a check run names in its annotations (#355), such as a browser test's
   * title; `null` when it names none.
   */
  readonly checkRunFailure: (
    accessToken: string,
    find: { readonly repo: string; readonly id: number },
  ) => Promise<Result<string | null, string>>;
  /** `repo`'s open milestones (#355). */
  readonly openMilestones: (
    accessToken: string,
    find: { readonly repo: string },
  ) => Promise<Result<readonly FoundMilestone[], string>>;
  /** Changes milestone `number`'s description in `repo` (#355). */
  readonly describeMilestone: (
    accessToken: string,
    change: { readonly repo: string; readonly number: number; readonly description: string },
  ) => Promise<Result<null, string>>;
  /** Files an issue in `repo` with `labels`, in milestone `milestone` if any (#355). */
  readonly createIssue: (
    accessToken: string,
    issue: {
      readonly repo: string;
      readonly title: string;
      readonly body: string;
      readonly labels: readonly string[];
      readonly milestone: number | null;
    },
  ) => Promise<Result<{ readonly number: number; readonly url: string }, string>>;
  /** Opens a pull request in `repo` from `branch` into `base` (#181): its number and address. */
  readonly openPullRequest: (
    accessToken: string,
    pull: {
      readonly repo: string;
      readonly branch: string;
      readonly base: string;
      readonly title: string;
      readonly body: string;
    },
  ) => Promise<Result<{ readonly number: number; readonly url: string }, string>>;
};

/** A pull request as GitHub has it. */
export type FoundPullRequest = {
  readonly number: number;
  readonly title: string;
  /** Its description, in Markdown: empty when it has none. */
  readonly body: string;
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
  /** The branch it merges from (#278). */
  readonly branch: string;
  /** It comes from a fork, so its branch isn't in the repository itself. */
  readonly fork: boolean;
  /** Who opened it, by their GitHub login. */
  readonly author: string;
  /** When it was merged, or `null` while it hasn't been. */
  readonly mergedAt: string | null;
};

/** A file a pull request changes, and its diff: `null` when GitHub shows none (binary, too large). */
export type FoundFile = {
  readonly path: string;
  readonly status: "added" | "removed" | "modified" | "renamed";
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string | null;
};

/** An open issue as GitHub has it (#301). */
export type FoundIssue = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** Its milestone's title, or `null` when it's in none. */
  readonly milestone: string | null;
  /** Its milestone's description, which may hold its `Build order:` line (#336); `null` if none. */
  readonly milestoneDescription: string | null;
  /** The text of each comment on it, oldest first. */
  readonly comments: readonly string[];
  /** The titles of the open issues it's blocked by (#377), as GitHub lists them. */
  readonly blockedBy: readonly string[];
};

/** An open milestone as GitHub has it (#355). */
export type FoundMilestone = {
  readonly number: number;
  readonly title: string;
  /** Its description, which may hold its `Build order:` line; empty when it has none. */
  readonly description: string;
};

/** One check on a pull request's latest commit, and how it's going. */
export type FoundCheck = {
  readonly name: string;
  /** `other` for one that ended neither passing nor failing: skipped, cancelled. */
  readonly outcome: "running" | "passed" | "failed" | "other";
};

/** A check on a commit, with when it ran and its page on GitHub (#249). */
export type FoundCheckRun = FoundCheck & {
  /** GitHub's id for it: a later try of a job has a higher one. */
  readonly id: number;
  /** Its page on GitHub, with its log. */
  readonly url: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

/** A workflow that ran on a commit (#337). */
export type FoundWorkflow = {
  /** Its file in the repository: `.github/workflows/ci.yml`. */
  readonly path: string;
  /** Its file's text, as it was on the commit. */
  readonly text: string;
  /** Its latest try has finished, so a job with no run by now never will have one. */
  readonly done: boolean;
  /** When its latest try started, or `null` when GitHub doesn't say. */
  readonly startedAt: string | null;
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

/** A repository as GitHub has it (#258). */
export type FoundRepo = {
  /** `owner/name`. */
  readonly fullName: string;
  readonly description: string | null;
  readonly private: boolean;
  /**
   * Where git clones it from: its HTTPS address on GitHub, never with a token in it (git asks
   * Courtyard's sign-in for that, through `gh`).
   */
  readonly cloneUrl: string;
  /** When it was last pushed to, or `null` when it never has been. */
  readonly pushedAt: string | null;
};

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
  repositories: z.array(
    z.object({
      full_name: z.string(),
      description: z.string().nullable(),
      private: z.boolean(),
      // Only GitHub's own address: anything else would send Courtyard's sign-in elsewhere.
      clone_url: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
      pushed_at: z.string().nullable(),
    }),
  ),
});

const Pulls = z.array(z.object({ number: z.number().int().positive() }));
/** One pull request, with what only asking for it alone gives: its size and whether it merges. */
const Pull = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.url({ protocol: /^https$/ }),
  state: z.enum(["open", "closed"]),
  merged_at: z.string().nullable(),
  head: z.object({
    sha: z.string().regex(/^[0-9a-f]+$/),
    ref: z.string(),
    /** `null` once a fork it came from is deleted. */
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
  user: z.object({ login: z.string() }),
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
const Labels = z.array(z.object({ name: z.string() }));
/** A repository's issues: a pull request is listed among them too, with `pull_request`. */
const Issues = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string(),
    html_url: z.url({ protocol: /^https$/ }),
    milestone: z
      .object({ title: z.string(), description: z.string().nullable().optional() })
      .nullable(),
    comments: z.number().int().nonnegative(),
    pull_request: z.unknown().optional(),
    /** How many open issues it's blocked by (#377); a GitHub without dependencies leaves it out. */
    issue_dependencies_summary: z.object({ blocked_by: z.number().int() }).optional(),
  }),
);
/** The issues one is blocked by (#377), open and closed, in any repository. */
const Blockers = z.array(z.object({ title: z.string(), state: z.string() }));
const Comments = z.array(z.object({ body: z.string().nullable().optional() }));
const PullTexts = z.array(z.object({ title: z.string(), body: z.string().nullable() }));
/** How many issues' comments are asked for at once. */
const COMMENTS_AT_ONCE = 8;
/** A pull request just opened, or an issue just filed. */
const Opened = z.object({
  number: z.number().int().positive(),
  html_url: z.url({ protocol: /^https$/ }),
});

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
/** A commit's check runs, with what main's build shows of each (#249). */
const CommitCheckRuns = z.object({
  check_runs: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      html_url: z.url({ protocol: /^https$/ }),
      started_at: z.string().nullable(),
      completed_at: z.string().nullable(),
    }),
  ),
});
/** The workflow runs on a commit (#355). */
const WorkflowRuns = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number().int(),
      status: z.string().nullable(),
      conclusion: z.string().nullable(),
    }),
  ),
});
/** The workflow runs on a commit, with each one's file and its latest try (#337). */
const WorkflowFiles = z.object({
  workflow_runs: z.array(
    z.object({
      path: z.string(),
      status: z.string().nullable(),
      run_started_at: z.string().nullable().optional(),
    }),
  ),
});
/** A file's contents, as GitHub gives it. */
const FileContents = z.object({ content: z.string(), encoding: z.literal("base64") });
/** A workflow's file: only GitHub's workflow folder, by a path safe in an address. */
const WorkflowPath = z.string().regex(/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/);
/** A check run's annotations, where a test reporter names what failed (#355). */
const Annotations = z.array(
  z.object({
    annotation_level: z.string().nullable(),
    title: z.string().nullable(),
    message: z.string().nullable(),
  }),
);
const Milestones = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string(),
    description: z.string().nullable(),
  }),
);
/** A commit, as GitHub's addresses take it. */
const Commit = z.string().regex(/^[0-9a-f]{40}$/);

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
/** The most open pull requests listed (#278): a repository's page of them, newest first. */
const OPEN_PAGE = 30;
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
   * The titles of the open issues `issue` (`owner/name/issues/<number>`) is blocked by (#377).
   * Ones GitHub won't list leave it unblocked, rather than Next up unread.
   */
  const openBlockersOf = async (token: string, issue: string) => {
    try {
      const blockers = await apiGet(
        token,
        `/repos/${issue}/dependencies/blocked_by?per_page=${PAGE}`,
        Blockers,
      );
      return blockers.filter((blocker) => blocker.state === "open").map(({ title }) => title);
    } catch {
      return [];
    }
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

  /** Every repo the GitHub App is installed on, across its installations; throws when GitHub fails. */
  const installedRepos = async (accessToken: string) => {
    const { installations } = await apiGet(
      accessToken,
      `/user/installations?per_page=${PAGE}`,
      Installations,
    );
    const repos: FoundRepo[] = [];
    for (const { id } of installations) {
      for (let page = 1; ; page += 1) {
        const listed = await apiGet(
          accessToken,
          `/user/installations/${id}/repositories?per_page=${PAGE}&page=${page}`,
          Repositories,
        );
        repos.push(
          ...listed.repositories.map((repo) => ({
            fullName: repo.full_name,
            description: repo.description,
            private: repo.private,
            cloneUrl: repo.clone_url,
            pushedAt: repo.pushed_at,
          })),
        );
        if (listed.repositories.length < PAGE) break;
      }
    }
    return repos;
  };

  /**
   * Pull request `number` in `repo` (checked), with the checks on its latest commit, or `null`
   * when there's none by that number; throws when GitHub fails.
   */
  const numbered = async (
    accessToken: string,
    repo: string,
    number: number,
  ): Promise<FoundPullRequest | null> => {
    const response = await apiRequest(accessToken, `/repos/${repo}/pulls/${number}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const pull = Pull.parse(await response.json());
    const { check_runs } = await apiGet(
      accessToken,
      `/repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=${PAGE}`,
      CheckRuns,
    );
    return {
      number: pull.number,
      title: pull.title,
      body: pull.body ?? "",
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
      branch: pull.head.ref,
      fork: pull.head.repo?.full_name !== repo,
      author: pull.user.login,
      mergedAt: pull.merged_at,
    };
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
        const repos = await installedRepos(accessToken);
        return ok({ login: user.login, repos: repos.map((repo) => repo.fullName).sort() });
      } catch {
        return err("GitHub couldn't be asked who's signed in.");
      }
    },

    repositories: async (accessToken) => {
      try {
        return ok(await installedRepos(accessToken));
      } catch {
        return err("GitHub couldn't be asked for your repos.");
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
        return ok(await numbered(accessToken, repo.data, latest.number));
      } catch {
        return err("GitHub couldn't be asked about the pull request.");
      }
    },

    pullRequestNumbered: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      try {
        return ok(await numbered(accessToken, repo.data, find.number));
      } catch {
        return err("GitHub couldn't be asked about the pull request.");
      }
    },

    openPullRequests: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      try {
        // GitHub lists the newest first; each is asked for alone for its size and conflicts.
        const listed = await apiGet(
          accessToken,
          `/repos/${repo.data}/pulls?state=open&per_page=${OPEN_PAGE}`,
          Pulls,
        );
        const found: FoundPullRequest[] = [];
        for (const { number } of listed) {
          const pull = await numbered(accessToken, repo.data, number);
          if (pull !== null) found.push(pull);
        }
        return ok(found);
      } catch {
        return err("GitHub couldn't be asked for the pull requests.");
      }
    },

    commitChecks: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      const commit = Commit.safeParse(find.commit);
      if (!repo.success || !commit.success) return err("That isn't a commit on GitHub.");
      try {
        const { check_runs } = await apiGet(
          accessToken,
          `/repos/${repo.data}/commits/${commit.data}/check-runs?per_page=${PAGE}`,
          CommitCheckRuns,
        );
        return ok(
          check_runs.map((run) => ({
            id: run.id,
            name: run.name,
            outcome: outcomeOf(run),
            url: run.html_url,
            startedAt: run.started_at,
            completedAt: run.completed_at,
          })),
        );
      } catch {
        return err("GitHub couldn't be asked about main's build.");
      }
    },

    commitWorkflows: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      const commit = Commit.safeParse(find.commit);
      if (!repo.success || !commit.success) return err("That isn't a commit on GitHub.");
      try {
        const { workflow_runs } = await apiGet(
          accessToken,
          `/repos/${repo.data}/actions/runs?head_sha=${commit.data}&per_page=${PAGE}`,
          WorkflowFiles,
        );
        // GitHub lists the newest first: a workflow that ran twice on the commit is its newest run.
        const byPath = new Map(workflow_runs.toReversed().map((run) => [run.path, run]));
        const found: FoundWorkflow[] = [];
        for (const [path, run] of byPath) {
          const file = WorkflowPath.safeParse(path);
          if (!file.success) continue;
          const { content } = await apiGet(
            accessToken,
            `/repos/${repo.data}/contents/${file.data}?ref=${commit.data}`,
            FileContents,
          );
          found.push({
            path: file.data,
            text: Buffer.from(content, "base64").toString("utf8"),
            done: run.status === "completed",
            startedAt: run.run_started_at ?? null,
          });
        }
        return ok(found);
      } catch {
        return err("GitHub couldn't be asked for main's workflows.");
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

    openIssues: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      const label = encodeURIComponent(find.label);
      try {
        const listed: z.infer<typeof Issues> = [];
        for (let page = 1; page <= FILE_PAGES; page += 1) {
          const issues = await apiGet(
            accessToken,
            `/repos/${repo.data}/issues?state=open&labels=${label}&per_page=${PAGE}&page=${page}`,
            Issues,
          );
          listed.push(...issues.filter((issue) => issue.pull_request === undefined));
          if (issues.length < PAGE) break;
        }
        // Only an issue with comments is asked for them, and one blocked for its blockers, a few
        // at a time.
        const found: FoundIssue[] = [];
        for (let at = 0; at < listed.length; at += COMMENTS_AT_ONCE) {
          const some = await Promise.all(
            listed.slice(at, at + COMMENTS_AT_ONCE).map(async (issue) => ({
              number: issue.number,
              title: issue.title,
              url: issue.html_url,
              milestone: issue.milestone?.title ?? null,
              milestoneDescription: issue.milestone?.description ?? null,
              comments:
                issue.comments === 0 || !find.forBuild
                  ? []
                  : (
                      await apiGet(
                        accessToken,
                        `/repos/${repo.data}/issues/${issue.number}/comments?per_page=${PAGE}`,
                        Comments,
                      )
                    ).map((comment) => comment.body ?? ""),
              blockedBy:
                (issue.issue_dependencies_summary?.blocked_by ?? 0) === 0 || !find.forBuild
                  ? []
                  : await openBlockersOf(accessToken, `${repo.data}/issues/${issue.number}`),
            })),
          );
          found.push(...some);
        }
        return ok(found);
      } catch {
        return err("GitHub couldn't be asked for the repository's issues.");
      }
    },

    openPullRequestTexts: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      try {
        const pulls = await apiGet(
          accessToken,
          `/repos/${repo.data}/pulls?state=open&per_page=${PAGE}`,
          PullTexts,
        );
        return ok(pulls.map((pull) => ({ title: pull.title, body: pull.body ?? "" })));
      } catch {
        return err("GitHub couldn't be asked for the pull requests.");
      }
    },

    commentOnIssue: async (accessToken, comment) => {
      const repo = RepoName.safeParse(comment.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      return apiChange(accessToken, `/repos/${repo.data}/issues/${comment.number}/comments`, {
        method: "POST",
        body: { body: comment.body },
        fallback: `GitHub couldn't comment on #${comment.number}.`,
      });
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

    labels: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      try {
        const names: string[] = [];
        for (let page = 1; page <= FILE_PAGES; page += 1) {
          const listed = await apiGet(
            accessToken,
            `/repos/${repo.data}/labels?per_page=${PAGE}&page=${page}`,
            Labels,
          );
          names.push(...listed.map((label) => label.name));
          if (listed.length < PAGE) break;
        }
        return ok(names);
      } catch {
        return err("GitHub couldn't be asked for the repository's labels.");
      }
    },

    createLabel: async (accessToken, label) => {
      const repo = RepoName.safeParse(label.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      return apiChange(accessToken, `/repos/${repo.data}/labels`, {
        method: "POST",
        body: { name: label.name, color: label.color, description: label.description },
        fallback: `GitHub couldn't make the label ${label.name}.`,
      });
    },

    openPullRequest: async (accessToken, pull) => {
      const repo = RepoName.safeParse(pull.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      const fallback = "GitHub couldn't open the pull request.";
      try {
        const response = await apiRequest(accessToken, `/repos/${repo.data}/pulls`, {
          method: "POST",
          body: { head: pull.branch, base: pull.base, title: pull.title, body: pull.body },
        });
        const answer: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          const refused = Refusal.safeParse(answer);
          return err(refused.success ? `GitHub said: ${refused.data.message}` : fallback);
        }
        const opened = Opened.safeParse(answer);
        return opened.success
          ? ok({ number: opened.data.number, url: opened.data.html_url })
          : err(fallback);
      } catch {
        return err(fallback);
      }
    },

    rerunFailedJobs: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      const commit = Commit.safeParse(find.commit);
      if (!repo.success || !commit.success) return err("That isn't a commit on GitHub.");
      try {
        const { workflow_runs } = await apiGet(
          accessToken,
          `/repos/${repo.data}/actions/runs?head_sha=${commit.data}&per_page=${PAGE}`,
          WorkflowRuns,
        );
        for (const run of workflow_runs) {
          if (run.status !== "completed" || run.conclusion === null) continue;
          if (!FAILED.has(run.conclusion)) continue;
          const rerun = await apiChange(
            accessToken,
            `/repos/${repo.data}/actions/runs/${run.id}/rerun-failed-jobs`,
            { method: "POST", body: {}, fallback: "GitHub couldn't re-run main's failed jobs." },
          );
          if (!rerun.ok) return rerun;
        }
        return ok(null);
      } catch {
        return err("GitHub couldn't be asked about main's build.");
      }
    },

    checkRunFailure: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      try {
        const annotations = await apiGet(
          accessToken,
          `/repos/${repo.data}/check-runs/${find.id}/annotations?per_page=${PAGE}`,
          Annotations,
        );
        // GitHub's own "Process completed with exit code 1." has no title: a reporter's names the test.
        const named = annotations.find(
          (each) => each.annotation_level === "failure" && (each.title ?? "").trim() !== "",
        );
        return ok(named?.title?.split("\n")[0]?.trim() ?? null);
      } catch {
        return err("GitHub couldn't be asked what failed.");
      }
    },

    openMilestones: async (accessToken, find) => {
      const repo = RepoName.safeParse(find.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      try {
        const milestones = await apiGet(
          accessToken,
          `/repos/${repo.data}/milestones?state=open&per_page=${PAGE}`,
          Milestones,
        );
        return ok(
          milestones.map(({ number, title, description }) => ({
            number,
            title,
            description: description ?? "",
          })),
        );
      } catch {
        return err("GitHub couldn't be asked for the repository's milestones.");
      }
    },

    describeMilestone: async (accessToken, change) => {
      const repo = RepoName.safeParse(change.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      return apiChange(accessToken, `/repos/${repo.data}/milestones/${change.number}`, {
        method: "PATCH",
        body: { description: change.description },
        fallback: "GitHub couldn't change the milestone.",
      });
    },

    createIssue: async (accessToken, issue) => {
      const repo = RepoName.safeParse(issue.repo);
      if (!repo.success) return err("That isn't a repository on GitHub.");
      const fallback = "GitHub couldn't file the issue.";
      try {
        const response = await apiRequest(accessToken, `/repos/${repo.data}/issues`, {
          method: "POST",
          body: {
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            ...(issue.milestone === null ? {} : { milestone: issue.milestone }),
          },
        });
        const answer: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          const refused = Refusal.safeParse(answer);
          return err(refused.success ? `GitHub said: ${refused.data.message}` : fallback);
        }
        const filed = Opened.safeParse(answer);
        return filed.success
          ? ok({ number: filed.data.number, url: filed.data.html_url })
          : err(fallback);
      } catch {
        return err(fallback);
      }
    },
  };
};
