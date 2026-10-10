import { gitOrNothing } from "../git.ts";
import { err, ok } from "../result.ts";
import type {
  DeviceSignIn,
  FoundCheck,
  FoundPullRequest,
  GitHubApi,
  SignInEnd,
  UserToken,
} from "./api.ts";

/** How long the fake's tokens last, as GitHub's do: 8 hours. */
const TOKEN_SECONDS = 8 * 60 * 60;

/**
 * For tests only: GitHub in memory (#99), so signing in, refreshing and who is signed in are
 * tested with no network. A device sign-in waits until the test says how it ends (`approve`,
 * `deny`, `expire`), or finishes by itself after `finishAfterMs`. Each token it gives out works
 * until it's refreshed; `lapse` makes GitHub refuse the refresh token, as after six months.
 *
 * It holds pull requests too (#172): a test opens one for a branch, sets its checks, and merges or
 * closes it, as the model's gh and GitHub itself would. With `opensOnPush`, for the browser tests,
 * a branch pushed to that bare repository (GitHub's copy, on disk) has a pull request opened for
 * it the first time it's asked about, and each commit pushed there gets `checks`.
 */
export const createFakeGitHub = (
  options: {
    account?: string;
    repos?: readonly string[];
    finishAfterMs?: number;
    opensOnPush?: { readonly remote: string; readonly checks: readonly FoundCheck[] };
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

  /** Every pull request opened, numbered from 1. */
  const pulls: (FoundPullRequest & { readonly repo: string; readonly branch: string })[] = [];
  const pullNumbered = (number: number) => {
    const at = pulls.findIndex((pull) => pull.number === number);
    if (at === -1) throw new Error(`The fake GitHub has no pull request #${number}`);
    return at;
  };
  const change = (number: number, to: Partial<FoundPullRequest>) => {
    const at = pullNumbered(number);
    const pull = pulls[at];
    if (pull !== undefined) pulls[at] = { ...pull, ...to };
  };
  const openPullRequest = (open: { repo: string; branch: string; head: string }) => {
    const number = pulls.length + 1;
    pulls.push({
      ...open,
      number,
      url: `https://github.com/${open.repo}/pull/${number}`,
      state: "open",
      checks: [],
    });
    return number;
  };
  const latestFor = (find: { repo: string; branch: string }) =>
    pulls.findLast((pull) => pull.repo === find.repo && pull.branch === find.branch);

  /** For the browser tests: the pull request for a branch pushed to GitHub's copy on disk. */
  const pushed = async (find: { repo: string; branch: string }) => {
    const onPush = options.opensOnPush;
    if (onPush === undefined) return;
    const head = await gitOrNothing(onPush.remote, ["rev-parse", `refs/heads/${find.branch}`]);
    if (head === undefined) return;
    const pull = latestFor(find);
    if (pull === undefined) {
      change(openPullRequest({ ...find, head }), { checks: onPush.checks });
    } else if (pull.head !== head && pull.state === "open") {
      change(pull.number, { head, checks: onPush.checks });
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
      if (accessToken !== current?.accessToken) return err("That token doesn't work.");
      await pushed(find);
      const pull = latestFor(find);
      if (pull === undefined) return ok(null);
      const { repo: _, branch: __, ...found } = pull;
      return ok(found);
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
    /** The pull request was merged, on GitHub or from Courtyard. */
    merge: (number: number) => change(number, { state: "merged" }),
    /** The pull request was closed without merging. */
    close: (number: number) => change(number, { state: "closed" }),
  };
};

export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
