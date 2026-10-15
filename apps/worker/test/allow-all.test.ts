import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodeSessionList,
  GitHubConnection,
  type SessionEvent,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  createFakeGitHub,
  errorOf,
  FAKE_MODEL,
  type FakeGitHub,
  followSession,
  gitIn,
  loginCookie,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  testWorker,
} from "./testing.ts";

// Allow all for this task (#428): for an hour, four, twelve, or until the task is done, a code
// session runs commands off the allowlist and edits setup files without asking, each marked; what
// must always ask still does. It's one session's, turns off by itself, and survives a restart.

let root: string;
let repo: string;
/** The repository on GitHub, as `owner/name`. */
let onGitHub: string;
let github: FakeGitHub;
let now: number;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, github: onGitHub } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo);
  github = createFakeGitHub();
  jobs = [];
  now = Date.parse("2026-10-15T09:00:00Z");
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A worker on the coder (and the fake), on the fake GitHub, with the owner logged in. */
const start = async (coding = codingProvider([]).provider) => {
  const app = testWorker({
    root,
    now: () => now,
    github: github.api,
    providers: [coding, createFakeProvider({ delayMs: 0 })],
    repeat: (_everyMs, job) => {
      jobs.push(job);
    },
  });
  return requesterFor(app, await setUpOwner(app));
};

/** Another worker on the same folders, as after a restart, with the owner logging in again. */
const restarted = async (coding = codingProvider([]).provider) => {
  const app = testWorker({ root, now: () => now, github: github.api, providers: [coding] });
  return requesterFor(
    app,
    loginCookie(await postJson(app.request, "/api/login", { password: "test password" })),
  );
};

/** Starts a code session on the coder, as the owner, and returns its id. */
const startSession = async (request: Requester, text = "Check your work") => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: CODING_MODEL,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

const allowAll = (request: Requester, id: string, lasts: string) =>
  postJson(request, `/api/sessions/${id}/allow-all`, { lasts });

const turnOff = (request: Requester, id: string) =>
  postJson(request, `/api/sessions/${id}/allow-all/off`, {});

/** A session as its page reads it. */
const sessionOf = async (request: Requester, id: string) =>
  SessionSummary.parse(await (await request(`/api/sessions/${id}`)).json());

type Asked = Extract<SessionEvent, { type: "approval-requested" }>;

/**
 * Follows a session's turn after `after` to its end, denying each approval it asks for on the way:
 * the approvals, and every event.
 */
const denyingEach = async (request: Requester, id: string, after = 0) => {
  const asked: Asked[] = [];
  const all: SessionEvent[] = [];
  let seen = after;
  for (;;) {
    const events = await followSession(request, {
      sessionId: id,
      after: seen,
      until: (event) => event.type === "approval-requested" || event.type === "turn-completed",
    });
    all.push(...events);
    const last = events.at(-1);
    seen = last?.seq ?? seen;
    if (last?.type !== "approval-requested") return { asked, events: all, last: seen };
    asked.push(last);
    await postJson(request, `/api/sessions/${id}/approvals/${last.seq}`, { answer: "deny" });
  }
};

/** The commands and edits a turn's events say ran under Allow all. */
const ranUnderAllowAll = (events: readonly SessionEvent[]) =>
  events.flatMap((event) =>
    event.type === "activity" && event.allowedAll === true ? [event.activity] : [],
  );

/** What a turn asked about, as its approvals say. */
const askedAbout = (asked: readonly Asked[]) =>
  asked.map(({ ask }) =>
    ask.kind === "command" ? ask.command : ask.kind === "tool" ? ask.action : ask.path,
  );

/** Sends the session another message, starting its next turn. */
const sendAgain = (request: Requester, id: string) =>
  postJson(request, `/api/sessions/${id}/messages`, { text: "Again", model: CODING_MODEL });

/**
 * Commands and edits that still ask under Allow all (#428 decision 4), each with what its approval
 * asks about.
 */
const STILL_ASKS: readonly (readonly [{ run: string } | { edit: string }, unknown])[] = [
  // Pushing anywhere but its own branch, force pushing, deleting a branch, however git is told.
  [{ run: "git push origin main" }, "git push origin main"],
  [{ run: "git push --force origin HEAD" }, "git push --force origin HEAD"],
  [{ run: "git branch -D old-work" }, "git branch -D old-work"],
  [{ run: "git -c a.b=c push --force origin main" }, "git -c a.b=c push --force origin main"],
  [{ run: "git -C . push origin --delete main" }, "git -C . push origin --delete main"],
  [{ run: "git --no-pager branch -D main" }, "git --no-pager branch -D main"],
  // Anything else on GitHub, outside the session branch, however it's run.
  [{ run: "gh pr merge 12" }, "gh pr merge 12"],
  [{ run: "gh repo delete owner/name --yes" }, "gh repo delete owner/name --yes"],
  [{ run: "pnpm exec gh pr merge 12" }, "pnpm exec gh pr merge 12"],
  [{ run: "npx gh pr merge 12" }, "npx gh pr merge 12"],
  // A path outside the worktree, for an edit or a command.
  [{ edit: "../notes.md" }, expect.stringMatching(/notes\.md$/)],
  [{ run: "rm -rf /path/to/elsewhere" }, "rm -rf /path/to/elsewhere"],
  // Credentials, and setup files that hold them, run with the repository's secrets, decide how
  // the model itself is allowed, or say where the worktree's git is.
  [{ run: "printenv GH_TOKEN" }, "printenv GH_TOKEN"],
  [{ run: "npm token list" }, "npm token list"],
  [{ edit: ".npmrc" }, ".npmrc"],
  [{ edit: ".github/workflows/ci.yml" }, ".github/workflows/ci.yml"],
  [{ edit: ".claude/settings.json" }, ".claude/settings.json"],
  [{ edit: ".git" }, ".git"],
  // Programs that run another command, or code given on the line.
  [{ run: "sh -c ls" }, "sh -c ls"],
  [{ run: "pnpm exec sh -c ls" }, "pnpm exec sh -c ls"],
  [{ run: "python3 -c pass" }, "python3 -c pass"],
];

describe("Allow all for this task", () => {
  it("turned on while an approval waits allows it, and the turn runs on without asking, each step marked", async () => {
    const { provider, answers } = codingProvider([
      { run: "pnpm add left-pad" },
      { run: "cargo test --release" },
      { edit: "package.json" },
      { edit: ".husky/pre-commit" },
      { run: "pnpm exec eslint src" },
    ]);
    const request = await start(provider);
    const id = await startSession(request);
    const events = await followSession(request, { sessionId: id, until: "approval-requested" });
    const asked = events.at(-1);
    if (asked?.type !== "approval-requested") throw new Error("no approval asked for");
    // The card offers it, since Allow all would cover this.
    expect(asked.all).toBe(true);

    const turnedOn = await allowAll(request, id, "1h");

    expect(turnedOn.status).toBe(200);
    expect(SessionSummary.parse(await turnedOn.json()).allowingAll).toEqual({
      until: "2026-10-15T10:00:00.000Z",
      task: false,
    });
    const rest = await followSession(request, {
      sessionId: id,
      after: asked.seq,
      until: "turn-completed",
    });
    expect(rest.find((event) => event.type === "approval-answered")).toMatchObject({
      approval: asked.seq,
      answer: "allow",
      allowedAll: true,
    });
    expect(rest.filter((event) => event.type === "approval-requested")).toEqual([]);
    expect(ranUnderAllowAll(rest)).toEqual([
      { kind: "ran-command", command: "pnpm add left-pad" },
      { kind: "ran-command", command: "cargo test --release" },
      { kind: "edited-file", path: "package.json" },
      { kind: "edited-file", path: ".husky/pre-commit" },
      { kind: "ran-command", command: "pnpm exec eslint src" },
    ]);
    expect(answers.every((answer) => answer.ok)).toBe(true);
  });

  it("still asks for what must always ask, never offering itself there", async () => {
    const { provider } = codingProvider(STILL_ASKS.map(([step]) => step));
    const request = await start(provider);
    const id = await startSession(request);
    const first = await denyingEach(request, id);
    expect((await allowAll(request, id, "4h")).status).toBe(200);

    await sendAgain(request, id);
    const { asked } = await denyingEach(request, id, first.last);

    expect(askedAbout(asked)).toEqual(STILL_ASKS.map(([, about]) => about));
    expect(asked.map((each) => each.all)).toEqual(STILL_ASKS.map(() => undefined));
  });

  it("still asks before running what's in a folder git ignores (#219), never offering itself or Allow always", async () => {
    await writeFile(join(repo, ".gitignore"), "test-results/\n");
    await gitIn(repo, "add", ".gitignore");
    await gitIn(repo, "commit", "--quiet", "-m", "Ignore test results");
    await gitIn(repo, "push", "--quiet", "origin", "main");
    const commands = ["pnpm -C test-results/ci test", "node test-results/ci/run.js"];
    const { provider } = codingProvider(commands.map((run) => ({ run })));
    const request = await start(provider);
    const id = await startSession(request);
    const first = await denyingEach(request, id);
    expect((await allowAll(request, id, "4h")).status).toBe(200);

    await sendAgain(request, id);
    const { asked } = await denyingEach(request, id, first.last);

    expect(askedAbout(asked)).toEqual(commands);
    expect(asked.map(({ all, always }) => ({ all, always }))).toEqual(
      commands.map(() => ({ all: undefined, always: undefined })),
    );
  });

  it("from the menu between turns: the next turn runs without asking, and the session and its row in Running say so", async () => {
    const { provider } = codingProvider([{ run: "pnpm add left-pad" }]);
    const request = await start(provider);
    const id = await startSession(request);
    const first = await denyingEach(request, id);

    expect((await allowAll(request, id, "12h")).status).toBe(200);
    await sendAgain(request, id);
    const { asked, events } = await denyingEach(request, id, first.last);

    expect(asked).toEqual([]);
    expect(ranUnderAllowAll(events)).toEqual([
      { kind: "ran-command", command: "pnpm add left-pad" },
    ]);
    const allowing = { until: "2026-10-15T21:00:00.000Z", task: false };
    expect((await sessionOf(request, id)).allowingAll).toEqual(allowing);
    const listed = CodeSessionList.parse(
      await (await request("/api/workspaces/side-project/sessions")).json(),
    );
    expect(listed.sessions.find((session) => session.id === id)?.allowingAll).toEqual(allowing);
  });

  it("runs out on its own, Turn off ends it at once, and it isn't extended while on", async () => {
    const { provider } = codingProvider([{ run: "pnpm add left-pad" }]);
    const request = await start(provider);
    const id = await startSession(request);
    const first = await denyingEach(request, id);
    await allowAll(request, id, "1h");

    const again = await allowAll(request, id, "12h");
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe(
      "This session is allowing all already. Turn it off first, then pick again.",
    );

    now += HOUR + 1;
    expect((await sessionOf(request, id)).allowingAll).toBeUndefined();
    await sendAgain(request, id);
    const ranOut = await denyingEach(request, id, first.last);
    expect(ranOut.asked).toHaveLength(1);

    // Once it's off, it can be turned on again; Turn off ends that at once.
    expect((await allowAll(request, id, "4h")).status).toBe(200);
    const off = await turnOff(request, id);
    expect(off.status).toBe(200);
    expect(SessionSummary.parse(await off.json()).allowingAll).toBeUndefined();
    await sendAgain(request, id);
    const { asked, events } = await denyingEach(request, id, ranOut.last);
    expect(asked).toHaveLength(1);
    expect(ranUnderAllowAll(events)).toEqual([]);
  });

  it("until this task is done ends when the session's pull request opens, 12 hours at most", async () => {
    const request = await start();
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");
    const id = await startSession(request);
    await followSession(request, { sessionId: id, until: "turn-completed" });

    expect((await allowAll(request, id, "task")).status).toBe(200);
    expect((await sessionOf(request, id)).allowingAll).toEqual({
      until: "2026-10-15T21:00:00.000Z",
      task: true,
    });

    const listed = await gitIn(repo, "worktree", "list", "--porcelain");
    const branch = /branch refs\/heads\/(courtyard\/\S+)/.exec(listed)?.[1];
    if (branch === undefined) throw new Error("no session branch");
    github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    for (const job of jobs) await job();

    expect((await sessionOf(request, id)).allowingAll).toBeUndefined();
  });

  it("survives a restart: its end time is kept, so the clock keeps running", async () => {
    const request = await start();
    const id = await startSession(request);
    await followSession(request, { sessionId: id, until: "turn-completed" });
    await allowAll(request, id, "4h");

    now += HOUR;
    const after = await restarted();

    expect((await sessionOf(after, id)).allowingAll).toEqual({
      until: "2026-10-15T13:00:00.000Z",
      task: false,
    });
  });

  it("is for a code session only, and for a length it knows", async () => {
    const request = await start();
    await postJson(request, "/api/workspaces", { name: "Garage gym" });
    const planning = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Hello",
      model: FAKE_MODEL,
    });
    const { id } = (await planning.json()) as { id: string };
    await followSession(request, { sessionId: id, until: "turn-completed" });
    const code = await startSession(request);

    const refused = await allowAll(request, id, "1h");
    const unknown = await allowAll(request, code, "forever");

    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe(
      "Only a code session can allow all, never the Lead: its builders can, from Run the build order.",
    );
    expect(unknown.status).toBe(400);
    await followSession(request, { sessionId: code, until: "turn-completed" });
  });
});
