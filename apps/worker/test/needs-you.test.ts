import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeSessionList, GitHubConnection, NeedsYou, WorkspaceList } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  createFakeGitHub,
  FAKE_MODEL,
  type FakeGitHub,
  followSession,
  gitIn,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  testWorker,
} from "./testing.ts";

// Needs you on Home (#492): everything waiting on the owner, in every workspace, decided once by
// the worker and listed in one answer, so Home, the Courtyard mark's count and a session's Next
// pill all say the same.

let root: string;
let now: number;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  await mkdir(join(root, "context", "porch"), { recursive: true });
  now = Date.parse("2026-10-18T09:00:00Z");
  jobs = [];
});

afterEach(async () => {
  await removeTestFolder(root);
});

const start = async (
  more: { coding?: ReturnType<typeof codingProvider>; github?: FakeGitHub } = {},
) => {
  const app = testWorker({
    root,
    now: () => now,
    providers: [
      createFakeProvider({ delayMs: 0 }),
      ...(more.coding === undefined ? [] : [more.coding.provider]),
    ],
    ...(more.github === undefined ? {} : { github: more.github.api }),
    repeat: (_everyMs, job) => {
      jobs.push(job);
    },
  });
  return requesterFor(app, await setUpOwner(app));
};

const needsYou = async (request: Requester) => {
  const response = await request("/api/needs-you");
  expect(response.status).toBe(200);
  return NeedsYou.parse(await response.json());
};

/** A workspace's name, as the workspace list says it. */
const nameOf = async (request: Requester, id: string) => {
  const { workspaces } = WorkspaceList.parse(await (await request("/api/workspaces")).json());
  return workspaces.find((workspace) => workspace.id === id)?.name;
};

/** A session's title, as its workspace's list says it now. */
const titleOf = async (request: Requester, workspace: string, id: string) => {
  const response = await request(`/api/workspaces/${workspace}/sessions`);
  const { sessions } = CodeSessionList.parse(await response.json());
  return sessions.find((session) => session.id === id)?.title;
};

/** Starts a session in `workspace` on the fake and follows its first turn to its end. */
const answeredIn = async (request: Requester, workspace: string, text: string) => {
  const response = await postJson(request, `/api/workspaces/${workspace}/sessions`, {
    text,
    model: FAKE_MODEL,
  });
  const { id } = (await response.json()) as { id: string };
  const events = await followSession(request, { sessionId: id, until: "turn-completed" });
  return { id, seq: events.at(-1)?.seq ?? 0 };
};

describe("Needs you", () => {
  it("says nothing needs the owner when nothing does", async () => {
    const request = await start();

    expect(await needsYou(request)).toEqual({ needs: [], busy: false });
  });

  it("lists every workspace's new replies, the newest first, each naming its workspace", async () => {
    const request = await start();
    const older = await answeredIn(request, "garage-gym", "Where does the rack go?");
    now += 60_000;
    const newer = await answeredIn(request, "porch", "Which stain for the decking?");

    const { needs } = await needsYou(request);

    expect(needs.map((need) => [need.kind, need.workspace.id, need.session.id])).toEqual([
      ["reply", "porch", newer.id],
      ["reply", "garage-gym", older.id],
    ]);
    expect(needs[0]?.workspace.name).toBe(await nameOf(request, "porch"));
    expect(needs[0]?.session.title).toBe(await titleOf(request, "porch", newer.id));
  });

  it("drops a reply once the owner has seen it, on whichever device", async () => {
    const request = await start();
    const { id, seq } = await answeredIn(request, "garage-gym", "Where does the rack go?");

    await postJson(request, `/api/sessions/${id}/seen`, { upTo: seq });

    expect((await needsYou(request)).needs).toEqual([]);
  });

  it("puts an approval before every new reply, and is busy while it waits", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const request = await start({ coding: codingProvider([{ run: "curl https://example.com" }]) });
    now += 60_000;
    await answeredIn(request, "garage-gym", "Where does the rack go?");
    const response = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Check the site",
      model: CODING_MODEL,
    });
    const { id } = (await response.json()) as { id: string };
    await followSession(request, { sessionId: id, until: "approval-requested" });

    const waiting = await needsYou(request);
    await postJson(request, `/api/sessions/${id}/stop`, { turn: 1 });
    await followSession(request, { sessionId: id, until: "turn-stopped" });

    expect(waiting.needs.map((need) => [need.kind, need.workspace.id])).toEqual([
      ["approval", "side-project"],
      ["reply", "garage-gym"],
    ]);
    // What it asks, and by which approval, so Home's row can Allow it in place (#592).
    expect(waiting.needs[0]).toMatchObject({
      approval: {
        number: expect.any(Number),
        ask: { kind: "command", command: "curl https://example.com" },
      },
    });
    expect(waiting.needs[0]).not.toHaveProperty("builder");
    expect(waiting.busy).toBe(true);
    expect((await needsYou(request)).busy).toBe(false);
  });

  it("lists a session's pull request ready to merge, by its number and title, not as a reply", async () => {
    const { repo, github: onGitHub } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub();
    const request = await start({ github });
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");
    const { id } = await answeredIn(request, "side-project", "Implement the talk key");
    const listed = await gitIn(repo, "worktree", "list", "--porcelain");
    const branch = /branch refs\/heads\/(courtyard\/\S+)/.exec(listed)?.[1] ?? "";
    const number = github.openPullRequest({
      repo: onGitHub,
      branch,
      head: "c0ffee1",
      title: "Talk",
    });
    github.setChecks(number, [{ name: "e2e", outcome: "passed" }]);
    for (const job of jobs) await job();

    const { needs } = await needsYou(request);

    expect(needs).toEqual([
      expect.objectContaining({
        kind: "merge",
        workspace: { id: "side-project", name: await nameOf(request, "side-project") },
        session: { id, title: await titleOf(request, "side-project", id) },
        pullRequest: { number, title: "Talk" },
      }),
    ]);
  });
});
