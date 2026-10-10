import { gitOrNothing } from "../git.ts";
import { err, ok } from "../result.ts";
import type {
  DeviceSignIn,
  FoundCheck,
  FoundFile,
  FoundPullRequest,
  GitHubApi,
  SignInEnd,
  UserToken,
} from "./api.ts";

/** How long the fake's tokens last, as GitHub's do: 8 hours. */
const TOKEN_SECONDS = 8 * 60 * 60;

const STATUSES: Readonly<Record<string, FoundFile["status"]>> = {
  A: "added",
  D: "removed",
  M: "modified",
};

/**
 * For the browser tests: the files commit `head` changes since `main` in a bare repository, with
 * their diffs, as GitHub lists a pull request's.
 */
const filesPushed = async (remote: string, head: string): Promise<FoundFile[]> => {
  const range = `main...${head}`;
  const statuses = (await gitOrNothing(remote, ["diff", "--name-status", range])) ?? "";
  const files: FoundFile[] = [];
  for (const line of statuses.split("\n")) {
    const [status, path] = line.split("\t");
    if (status === undefined || path === undefined) continue;
    const diff = (await gitOrNothing(remote, ["diff", range, "--", path])) ?? "";
    const hunks = diff.slice(Math.max(0, diff.indexOf("\n@@") + 1));
    const lines = hunks.split("\n");
    files.push({
      path,
      status: STATUSES[status] ?? "modified",
      additions: lines.filter((text) => text.startsWith("+")).length,
      deletions: lines.filter((text) => text.startsWith("-")).length,
      patch: hunks.startsWith("@@") ? hunks : null,
    });
  }
  return files;
};

/**
 * For tests only: GitHub in memory (#99), so signing in, refreshing and who is signed in are
 * tested with no network. A device sign-in waits until the test says how it ends (`approve`,
 * `deny`, `expire`), or finishes by itself after `finishAfterMs`. Each token it gives out works
 * until it's refreshed; `lapse` makes GitHub refuse the refresh token, as after six months.
 *
 * It holds pull requests too (#172): a test opens one for a branch, sets its checks, and merges or
 * closes it, as the model's gh and GitHub itself would; Courtyard's Merge and Close act on it too
 * (#160), and a test can give it files and a conflict. With `opensOnPush`, for the browser tests,
 * a branch pushed to that bare repository (GitHub's copy, on disk) has a pull request opened for
 * it the first time it's asked about, changing the files the branch changes since `main`, and each
 * commit pushed there gets the `checks` its subject says.
 */
export const createFakeGitHub = (
  options: {
    account?: string;
    repos?: readonly string[];
    finishAfterMs?: number;
    opensOnPush?: {
      readonly remote: string;
      /** The checks on a commit pushed, from its subject. */
      readonly checks: (subject: string) => readonly FoundCheck[];
    };
  } = {},
) => {
  const account = options.account ?? "octo-owner";
  const repos = options.repos ?? [`${account}/courtyard`, `${account}/stacks`];
  let issued = 0;
  let codes = 0;
  /** The access token that works now, and its refresh token. */
  let current: { accessToken: string; refreshToken: string } | undefined;
  /** How the sign-in waiting now ends, once the test says. */
  let ending: ((how: "approved" | SignInEnd) => void) | undefined;

  const issue = (): UserToken => {
    issued += 1;
    current = { accessToken: `ghu_fake${issued}`, refreshToken: `ghr_fake${issued}` };
    return { ...current, expiresIn: TOKEN_SECONDS };
  };
  const end = (how: "approved" | SignInEnd) => {
    const was = ending;
    ending = undefined;
    was?.(how);
  };

  /** Every pull request opened, numbered from 1, with the files it changes (#160). */
  const pulls: (FoundPullRequest & {
    readonly repo: string;
    readonly branch: string;
    readonly files: readonly FoundFile[];
  })[] = [];
  const pullNumbered = (number: number) => {
    const at = pulls.findIndex((pull) => pull.number === number);
    if (at === -1) throw new Error(`The fake GitHub has no pull request #${number}`);
    return at;
  };
  const change = (number: number, to: Partial<(typeof pulls)[number]>) => {
    const at = pullNumbered(number);
    const pull = pulls[at];
    if (pull !== undefined) pulls[at] = { ...pull, ...to };
  };
  /** A pull request's size, from the files it changes, as GitHub counts it. */
  const changesOf = (files: readonly FoundFile[]) => ({
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files: files.length,
  });
  const openPullRequest = (open: {
    repo: string;
    branch: string;
    head: string;
    /** The files it changes, with their diffs: none unless a test says. */
    files?: readonly FoundFile[];
  }) => {
    const number = pulls.length + 1;
    const files = open.files ?? [];
    pulls.push({
      repo: open.repo,
      branch: open.branch,
      head: open.head,
      base: "main",
      number,
      url: `https://github.com/${open.repo}/pull/${number}`,
      state: "open",
      checks: [],
      files,
      changes: changesOf(files),
      conflicts: false,
    });
    return number;
  };
  /** The token works now; else GitHub's refusal. */
  const refusedToken = (accessToken: string) =>
    accessToken === current?.accessToken ? undefined : err("That token doesn't work.");
  const latestFor = (find: { repo: string; branch: string }) =>
    pulls.findLast((pull) => pull.repo === find.repo && pull.branch === find.branch);

  /** For the browser tests: the pull request for a branch pushed to GitHub's copy on disk. */
  const pushed = async (find: { repo: string; branch: string }) => {
    const onPush = options.opensOnPush;
    if (onPush === undefined) return;
    const head = await gitOrNothing(onPush.remote, ["rev-parse", `refs/heads/${find.branch}`]);
    if (head === undefined) return;
    const pull = latestFor(find);
    if (pull !== undefined && (pull.head === head || pull.state !== "open")) return;
    const files = await filesPushed(onPush.remote, head);
    const subject = (await gitOrNothing(onPush.remote, ["log", "-1", "--format=%s", head])) ?? "";
    const checks = onPush.checks(subject);
    if (pull === undefined) {
      change(openPullRequest({ ...find, head, files }), { checks });
    } else {
      change(pull.number, { head, checks, files, changes: changesOf(files) });
    }
  };

  const api: GitHubApi = {
    startSignIn: async () => {
      codes += 1;
      return ok({
        deviceCode: `device-${codes}`,
        code: `FAKE-${String(codes).padStart(4, "0")}`,
        link: "https://github.com/login/device",
        expiresIn: 900,
        interval: 5,
      });
    },
    finishSignIn: (_device: DeviceSignIn, signal: AbortSignal) =>
      new Promise((resolve) => {
        const finishing =
          options.finishAfterMs === undefined
            ? undefined
            : setTimeout(() => end("approved"), options.finishAfterMs);
        const ended = (how: "approved" | SignInEnd) => {
          clearTimeout(finishing);
          signal.removeEventListener("abort", cancelled);
          resolve(how === "approved" ? ok(issue()) : err(how));
        };
        const cancelled = () => {
          if (ending === ended) ending = undefined;
          ended("cancelled");
        };
        ending = ended;
        signal.addEventListener("abort", cancelled, { once: true });
      }),
    refresh: async (refreshToken) => {
      if (current === undefined || refreshToken !== current.refreshToken) return err("lapsed");
      return ok(issue());
    },
    account: async (accessToken) =>
      accessToken === current?.accessToken
        ? ok({ login: account, repos })
        : err("That token doesn't work."),
    pullRequest: async (accessToken, find) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      await pushed(find);
      const pull = latestFor(find);
      if (pull === undefined) return ok(null);
      const { repo: _, branch: __, files: ___, ...found } = pull;
      return ok(found);
    },
    pullRequestFiles: async (accessToken, { number }) =>
      refusedToken(accessToken) ?? ok(pulls[pullNumbered(number)]?.files ?? []),
    merge: async (accessToken, { number, head }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      const pull = pulls[pullNumbered(number)];
      if (pull?.state !== "open") return err("GitHub said: Pull Request is not mergeable");
      if (pull.conflicts) return err("GitHub said: Pull Request is not mergeable");
      if (pull.head !== head) return err("GitHub said: Head branch was modified.");
      change(number, { state: "merged" });
      return ok(null);
    },
    close: async (accessToken, { number }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      change(number, { state: "closed" });
      return ok(null);
    },
  };

  return {
    api,
    /** The owner entered the code and said yes. */
    approve: () => end("approved"),
    /** The owner said no on GitHub. */
    deny: () => end("denied"),
    /** The code ran out before it was used. */
    expire: () => end("expired"),
    /** GitHub won't take the refresh token any more, nor its access token. */
    lapse: () => {
      current = undefined;
    },
    /** The access token that works now, if any. */
    token: () => current?.accessToken,
    /** The model opened a pull request from `branch`, its latest commit `head`: its number. */
    openPullRequest,
    /** The pull request's checks are now these; on a new commit `head`, if it was pushed. */
    setChecks: (number: number, checks: readonly FoundCheck[], head?: string) =>
      change(number, { checks, ...(head === undefined ? {} : { head }) }),
    /** The pull request now conflicts with its base, or no longer does (#160). */
    setConflicts: (number: number, conflicts: boolean) => change(number, { conflicts }),
    /** Its state on GitHub now, as a test checks Merge or Close reached it (#160). */
    stateOf: (number: number) => pulls[pullNumbered(number)]?.state,
    /** The pull request was merged, on GitHub or from Courtyard. */
    merge: (number: number) => change(number, { state: "merged" }),
    /** The pull request was closed without merging. */
    close: (number: number) => change(number, { state: "closed" }),
  };
};

export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
