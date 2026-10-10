import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { GitHubConnection } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  followSession,
  gitIn,
  postJson,
  type Requester,
  RUNNING_MODEL,
  requesterFor,
  runningProvider,
  setUpOwner,
  testWorker,
} from "./testing.ts";

// Signing in to GitHub through Courtyard's GitHub App (#99): a device code from Connections, kept
// in the data folder, and given only to a code session's git and gh.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const connection = async (request: Requester) =>
  GitHubConnection.parse(await (await request("/api/github")).json());

describe("the GitHub connection", () => {
  it("starts signed out", async () => {
    const github = createFakeGitHub();
    const request = await asOwner(testWorker({ root, github: github.api }));

    expect(await connection(request)).toEqual({ kind: "signed-out" });
  });

  it("starts a sign-in with a device code, and cancels it", async () => {
    const github = createFakeGitHub();
    const request = await asOwner(testWorker({ root, github: github.api }));

    const started = await postJson(request, "/api/github/sign-in", {});
    const waiting = await connection(request);
    const cancelled = await postJson(request, "/api/github/cancel", {});

    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({
      kind: "waiting",
      link: "https://github.com/login/device",
      code: "FAKE-0001",
    });
    expect(waiting).toMatchObject({ kind: "waiting", code: "FAKE-0001" });
    expect(cancelled.status).toBe(204);
    expect(await connection(request)).toEqual({ kind: "signed-out" });
  });

  it("is signed in once the owner enters the code on GitHub, with the account and its repos", async () => {
    const github = createFakeGitHub({ account: "octo-owner" });
    const request = await asOwner(testWorker({ root, github: github.api }));

    await postJson(request, "/api/github/sign-in", {});
    github.approve();

    await expect
      .poll(() => connection(request))
      .toEqual({
        kind: "signed-in",
        account: "octo-owner",
        repos: ["octo-owner/courtyard", "octo-owner/stacks"],
      });
  });

  it("keeps the sign-in in the data folder, across a restart", async () => {
    const github = createFakeGitHub();
    const app = testWorker({ root, github: github.api });
    const cookie = await setUpOwner(app);
    await postJson(requesterFor(app, cookie), "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => (await connection(requesterFor(app, cookie))).kind)
      .toBe("signed-in");

    const restarted = requesterFor(testWorker({ root, github: github.api }), cookie);

    expect(await connection(restarted)).toMatchObject({ kind: "signed-in", account: "octo-owner" });
  });

  it("says why a sign-in didn't finish: the code ran out, or the owner said no", async () => {
    const github = createFakeGitHub();
    const request = await asOwner(testWorker({ root, github: github.api }));

    await postJson(request, "/api/github/sign-in", {});
    github.expire();
    await expect.poll(() => connection(request)).toEqual({ kind: "not-finished", why: "expired" });
    await postJson(request, "/api/github/sign-in", {});
    github.deny();

    await expect.poll(() => connection(request)).toEqual({ kind: "not-finished", why: "denied" });
  });

  it("signs out, and switches account by signing in again, keeping the first until the second finishes", async () => {
    const github = createFakeGitHub();
    const request = await asOwner(testWorker({ root, github: github.api }));
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect.poll(async () => (await connection(request)).kind).toBe("signed-in");

    // Switch, then think better of it: still signed in.
    await postJson(request, "/api/github/sign-in", {});
    const switching = await connection(request);
    await postJson(request, "/api/github/cancel", {});
    const keptAfterCancel = await connection(request);
    const signedOut = await postJson(request, "/api/github/sign-out", {});

    expect(switching).toMatchObject({ kind: "waiting" });
    expect(keptAfterCancel).toMatchObject({ kind: "signed-in" });
    expect(signedOut.status).toBe(204);
    expect(await connection(request)).toEqual({ kind: "signed-out" });
  });

  it("needs the owner's login", async () => {
    const app = testWorker({ root, github: createFakeGitHub().api });

    const response = await postJson(
      (path, init) => app.request(path, init),
      "/api/github/sign-in",
      {},
    );

    expect(response.status).toBe(401);
  });

  it("says it isn't set up on a worker with no GitHub App", async () => {
    const request = await asOwner(testWorker({ root }));

    expect(await connection(request)).toEqual({ kind: "not-set-up" });
  });
});

/** What git's credential helpers give for github.com: `fill` with the host it's asked about. */
const GIT_CREDENTIAL = {
  command: ["git", "credential", "fill"],
  input: "protocol=https\nhost=github.com\n\n",
};
const GH_TOKEN = { command: ["gh", "auth", "token"] };

/** Starts a code session on the running provider, and follows its first turn to its end. */
const codeTurn = async (request: Requester) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text: "Push it",
    model: RUNNING_MODEL,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return followSession(request, { sessionId: id, until: "turn-completed" });
};

/** Every file in a folder as text, and, when it's a git repository, its whole history. */
const everythingIn = async (folder: string) => {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries.filter(
    (entry) => entry.isFile() && !relative(folder, entry.parentPath).startsWith(".git"),
  );
  const texts = await Promise.all(
    files.map((entry) => readFile(join(entry.parentPath, entry.name), "utf8")),
  );
  const isRepo = entries.some((entry) => entry.name === ".git" && entry.parentPath === folder);
  const history = isRepo ? await gitIn(folder, "log", "--all", "-p") : "";
  return [...texts, history].join("\n");
};

/** Any of GitHub's tokens, by the start GitHub gives each kind (`ghu_`, `gho_`, `ghp_` …). */
const GITHUB_TOKEN = /gh[a-z]_[A-Za-z0-9]/;

/** The password git's credential helpers gave, from what `git credential fill` printed. */
const passwordIn = (printed: string | undefined) => /^password=(.*)$/m.exec(printed ?? "")?.[1];

describe("a code session's git and gh", () => {
  beforeEach(async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
  });

  it("use Courtyard's GitHub sign-in, and only that", async () => {
    const github = createFakeGitHub();
    const running = runningProvider([GIT_CREDENTIAL, GH_TOKEN]);
    const request = await asOwner(
      testWorker({ root, github: github.api, providers: [running.provider] }),
    );
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect.poll(async () => (await connection(request)).kind).toBe("signed-in");

    await codeTurn(request);

    const [credential, token] = running.printed;
    expect(passwordIn(credential?.output)).toBe(github.token());
    expect(token?.output.trim()).toBe(github.token());
  });

  it("get a fresh token once the last one is close to running out", async () => {
    const github = createFakeGitHub();
    const running = runningProvider([GH_TOKEN]);
    let time = Date.parse("2026-10-10T09:00:00Z");
    const jobs: (() => Promise<void>)[] = [];
    const request = await asOwner(
      testWorker({
        root,
        github: github.api,
        providers: [running.provider],
        now: () => time,
        repeat: (_everyMs, job) => {
          jobs.push(job);
        },
      }),
    );
    const runJobs = async () => {
      for (const job of jobs) await job();
    };
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect.poll(async () => (await connection(request)).kind).toBe("signed-in");
    const first = github.token();

    // An hour in, it's still good for hours.
    time += 60 * 60 * 1000;
    await runJobs();
    await codeTurn(request);
    // Seven and a half hours in, half an hour before it runs out.
    time += 6.5 * 60 * 60 * 1000;
    await runJobs();
    await codeTurn(request);

    const [early, late] = running.printed;
    expect(early?.output.trim()).toBe(first);
    expect(late?.output.trim()).toBe(github.token());
    expect(github.token()).not.toBe(first);
    expect(await connection(request)).toMatchObject({ kind: "signed-in", account: "octo-owner" });
  });

  it("sign out when GitHub won't refresh the sign-in any more", async () => {
    const github = createFakeGitHub();
    let time = Date.parse("2026-10-10T09:00:00Z");
    const jobs: (() => Promise<void>)[] = [];
    const request = await asOwner(
      testWorker({
        root,
        github: github.api,
        now: () => time,
        repeat: (_everyMs, job) => {
          jobs.push(job);
        },
      }),
    );
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect.poll(async () => (await connection(request)).kind).toBe("signed-in");

    github.lapse();
    time += 8 * 60 * 60 * 1000;
    for (const job of jobs) await job();

    expect(await connection(request)).toEqual({ kind: "signed-out" });
  });

  it("are the only place the token goes: never the browser, the event log, the context folder or a model", async () => {
    const github = createFakeGitHub();
    const running = runningProvider([{ command: ["git", "status", "--short"] }]);
    const request = await asOwner(
      testWorker({ root, github: github.api, providers: [running.provider] }),
    );
    const answers: string[] = [];
    const answer = async (path: string, init?: RequestInit) => {
      const response = await request(path, init);
      // The event stream stays open; its events are looked at below.
      if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        answers.push(await response.clone().text());
      }
      return response;
    };
    await answer("/api/github/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    github.approve();
    await expect.poll(async () => (await connection(request)).kind).toBe("signed-in");

    const events = await codeTurn(answer);
    for (const path of ["/api/github", "/api/sign-ins", "/api/sessions", "/api/workspaces"]) {
      await answer(path);
    }
    const contextFolder = await everythingIn(join(root, "context"));

    const token = github.token() ?? "";
    expect(token).not.toBe("");
    expect(answers.some((text) => text.includes(token))).toBe(false);
    expect(JSON.stringify(events).includes(token)).toBe(false);
    expect(contextFolder.includes(token)).toBe(false);
    expect(JSON.stringify(running.framings).includes(token)).toBe(false);
    expect(JSON.stringify(running.envs).includes(token)).toBe(false);
  });

  it("never use the machine's own GitHub login, signed in or not", async () => {
    const github = createFakeGitHub();
    const running = runningProvider([GIT_CREDENTIAL, GH_TOKEN]);
    const request = await asOwner(
      testWorker({ root, github: github.api, providers: [running.provider] }),
    );
    // The worker machine's own login, as a token in its environment.
    process.env.GH_TOKEN = "ghp_machine";
    try {
      // Before signing in, and after signing in and out again.
      await codeTurn(request);
      await postJson(request, "/api/github/sign-in", {});
      github.approve();
      await expect.poll(async () => (await connection(request)).kind).toBe("signed-in");
      await postJson(request, "/api/github/sign-out", {});
      await codeTurn(request);
    } finally {
      delete process.env.GH_TOKEN;
    }

    // Neither finds any GitHub token: not the one in the environment, nor one in the machine's
    // own gh or git setup (its keyring, its credential manager).
    // (Asked as a yes or no, so a failure never prints a real token.)
    expect(running.printed.map(({ output }) => GITHUB_TOKEN.test(output))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
