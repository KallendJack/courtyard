import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeSessionList, GitHubConnection, RunningTasks } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err, ok, type Result } from "../src/lib/result.ts";
import type { Provider } from "../src/providers/index.ts";
import {
  asOwner,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  createFakeGitHub,
  type FakeGitHub,
  gitIn,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// Builders check only what they changed (#589, ADR 0031): a Lead's builder is refused the full
// suite, told CI runs it, and runs its checks in its turn, never as a task. The owner's own
// sessions are unchanged. Against the fake GitHub, with real git in temporary folders.

let root: string;
let repo: string;
let onGitHub: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, github: onGitHub } = await codeRepo(root));
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** The messages a turn asks on: a builder's first, and the owner's own session's. */
const ASKS = /^(Build issue #|Check it$)/;

/** What a session's model asked for, on its branch, and the worker's answer. */
type Asked = { readonly branch: string; readonly command: string; readonly answer: unknown };

/**
 * A provider that codes: each turn asks to run `run` (which never really run, each ending at
 * once) and to start `tasks` as tasks, keeping the worker's answers by the session's branch. Only
 * a builder's first turn and the owner's ask (`ASKS`): the Lead's turns, and those telling of a
 * task, only answer.
 */
const askingCoder = (steps: { run?: readonly string[]; tasks?: readonly string[] }) => {
  const asked: Asked[] = [];
  /** Each asking turn's instructions, by the session's branch. */
  const told = new Map<string, string>();
  const { provider: coder } = codingProvider([]);
  const provider: Provider = {
    ...coder,
    runTurn: async (input) => {
      const { code } = input;
      if (code === null) return err({ kind: "unknown", message: "Only codes." });
      if (ASKS.test(input.framing.newMessage)) {
        const branch = await gitIn(code.worktree, "branch", "--show-current");
        told.set(branch, input.framing.instructions);
        for (const command of steps.run ?? []) {
          const answer = await code.run(command);
          asked.push({ branch, command, answer });
          // It ran and ended, so a heavy check frees its place for the next.
          if (answer.ok) code.ran(command);
        }
        for (const command of steps.tasks ?? []) {
          const started: Result<string, string> = await code.task(command);
          asked.push({ branch, command, answer: started.ok ? ok(null) : started });
        }
      }
      await input.emit("Done.");
      return ok(null);
    },
  };
  return { provider, asked, told };
};

/** The fake GitHub the worker is on. */
let github: FakeGitHub;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

/** A worker with Side project on the fake GitHub, one issue ready to build, signed in. */
const signedIn = async (provider: Provider) => {
  await codeWorkspace(root, "side-project", repo, { name: "Side project" });
  github = createFakeGitHub({
    issues: { [onGitHub]: [{ number: 22, title: "Which session waits", milestone: "4 · Code" }] },
    milestones: { [onGitHub]: { "4 · Code": "NOW. Build order: #22." } },
  });
  jobs = [];
  const request = await asOwner(
    testWorker({
      root,
      github: github.api,
      providers: [provider],
      repeat: (_everyMs, job) => {
        jobs.push(job);
      },
    }),
  );
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
    .toBe("signed-in");
  return request;
};

/** A session's tasks still running. */
const tasksOf = async (request: Requester, sessionId: string) =>
  RunningTasks.parse(await (await request(`/api/sessions/${sessionId}/tasks`)).json()).tasks;

const sessionsOf = async (request: Requester) =>
  CodeSessionList.parse(await (await request("/api/workspaces/side-project/sessions")).json())
    .sessions;

/** Runs the build order, which starts a builder for #22, and waits until every turn has ended. */
const buildsOne = async (request: Requester) => {
  const response = await postJson(request, "/api/workspaces/side-project/lead/run", {
    model: CODING_MODEL,
  });
  expect(response.status).toBe(200);
  await expect
    .poll(async () => (await sessionsOf(request)).find((each) => each.byLead === true)?.busy, {
      timeout: 15_000,
    })
    .toBe(false);
  await settled(request);
  const builder = (await sessionsOf(request)).find((each) => each.byLead === true);
  if (builder?.branch === undefined) throw new Error("No builder started");
  return builder;
};

const settled = (request: Requester) =>
  expect
    .poll(async () => (await sessionsOf(request)).filter((each) => each.busy), { timeout: 15_000 })
    .toHaveLength(0);

/** An owner's own session in Side project, on the coder, once its turn has ended. */
const ownSession = async (request: Requester) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text: "Check it",
    model: CODING_MODEL,
  });
  expect(response.status).toBe(201);
  await settled(request);
  const own = (await sessionsOf(request)).find((each) => each.byLead !== true && !each.lead);
  if (own?.branch === undefined) throw new Error("No session started");
  return own;
};

const FULL_SUITES = [
  "pnpm test",
  "pnpm e2e",
  "pnpm verify",
  "pnpm run test",
  "pnpm -r test",
  "pnpm --filter worker exec vitest run",
  "pnpm exec playwright test",
  "pnpm exec playwright test --project=chromium",
];

describe("a Lead's builder (#589)", () => {
  it("is told to check only what it changed, in its turn; the owner's own session isn't", async () => {
    const { provider, told } = askingCoder({});
    const request = await signedIn(provider);

    const builder = await buildsOne(request);
    const own = await ownSession(request);

    const checks = await quotedInGuide("You're one of this workspace's Lead's builders");
    const access = await quotedInGuide("You're working on your own session branch");
    const houseProcess = await quotedInGuide("Work the way this repository does");
    const builderAccess = access.replace(
      "(a dev server, a slow test run)",
      "(a dev server or a preview)",
    );
    expect(builderAccess).not.toBe(access);
    // A builder starts no helpers (#621, ADR 0031), so its house process says nothing of them.
    const helpers = houseProcess.slice(
      houseProcess.indexOf(" Hand parts of the work to helpers"),
      houseProcess.indexOf(" Base a pull request"),
    );
    expect(helpers).toMatch(/^ Hand parts .* when it finishes\.$/);
    expect(told.get(builder.branch ?? "")).toContain(
      `${builderAccess}\n\n${houseProcess.replace(helpers, "")}\n\n${checks}`,
    );
    expect(told.get(own.branch ?? "")).toContain(`${access}\n\n${houseProcess}`);
    expect(told.get(own.branch ?? "")).not.toContain(checks);
  });

  it("is refused the full suite, the full browser suite and verify, told CI runs them; the owner's own session isn't", async () => {
    const { provider, asked } = askingCoder({ run: FULL_SUITES });
    const request = await signedIn(provider);

    const builder = await buildsOne(request);
    const own = await ownSession(request);

    const refused = await quotedInGuide("CI runs the full suite on your pull request");
    expect(asked.filter((each) => each.branch === builder.branch)).toEqual(
      FULL_SUITES.map((command) => ({ branch: builder.branch, command, answer: err(refused) })),
    );
    expect(asked.filter((each) => each.branch === own.branch)).toEqual(
      FULL_SUITES.map((command) => ({ branch: own.branch, command, answer: ok(null) })),
    );
  });

  it("runs the checks for what it changed: its test files and specs by name, check and typecheck", async () => {
    const named = [
      "pnpm check",
      "pnpm typecheck",
      "pnpm -C apps/worker exec vitest run test/live.test.ts",
      "pnpm --filter worker test test/live.test.ts",
      "pnpm exec playwright test e2e/live.spec.ts",
      "pnpm e2e e2e/live.spec.ts",
    ];
    const { provider, asked } = askingCoder({ run: named });
    const request = await signedIn(provider);

    const builder = await buildsOne(request);

    expect(asked.filter((each) => each.branch === builder.branch)).toEqual(
      named.map((command) => ({ branch: builder.branch, command, answer: ok(null) })),
    );
  });

  it("ends its dev server, a preview's task, once its pull request merges", async () => {
    await writeFile(join(repo, "serve.mjs"), "setInterval(() => {}, 1000);\n");
    await gitIn(repo, "add", ".");
    await gitIn(repo, "commit", "--quiet", "-m", "A server");
    await gitIn(repo, "push", "--quiet", "origin", "main");
    const { provider } = askingCoder({ tasks: ["node serve.mjs"] });
    const request = await signedIn(provider);
    const builder = await buildsOne(request);
    expect(await tasksOf(request, builder.id)).toHaveLength(1);
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: builder.branch ?? "",
      head: "c0ffee1",
    });
    for (const job of jobs) await job();

    github.merge(number);
    for (const job of jobs) await job();

    expect(await tasksOf(request, builder.id)).toEqual([]);
    await settled(request);
  });

  it("runs its checks in its turn, never as a task", async () => {
    const { provider, asked } = askingCoder({
      tasks: ["pnpm -C apps/worker exec vitest run test/live.test.ts"],
    });
    const request = await signedIn(provider);

    const builder = await buildsOne(request);

    expect(asked.filter((each) => each.branch === builder.branch)).toEqual([
      {
        branch: builder.branch,
        command: "pnpm -C apps/worker exec vitest run test/live.test.ts",
        answer: err(await quotedInGuide("Run your checks in your turn")),
      },
    ]);
  });
});
