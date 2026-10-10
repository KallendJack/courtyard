import { err, ok } from "../result.ts";
import type { DeviceSignIn, GitHubApi, SignInEnd, UserToken } from "./api.ts";

/** How long the fake's tokens last, as GitHub's do: 8 hours. */
const TOKEN_SECONDS = 8 * 60 * 60;

/**
 * For tests only: GitHub in memory (#99), so signing in, refreshing and who is signed in are
 * tested with no network. A device sign-in waits until the test says how it ends (`approve`,
 * `deny`, `expire`), or finishes by itself after `finishAfterMs`. Each token it gives out works
 * until it's refreshed; `lapse` makes GitHub refuse the refresh token, as after six months.
 */
export const createFakeGitHub = (
  options: { account?: string; repos?: readonly string[]; finishAfterMs?: number } = {},
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
  };
};

export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
