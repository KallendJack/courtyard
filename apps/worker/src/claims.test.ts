import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubConnection, SessionDetail, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./agent/providers/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  FAKE_MODEL,
  type FakeGitHub,
  type FakeIssue,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// The worker owns the claim of a session started on an issue (#324): it posts "Building this"
// as the session starts, and "Stopped" when it stops, fails or is deleted before a pull request.

let root: string;
let repo: string;
/** The repository on GitHub, as `owner/name`: what the code workspace's remote names. */
let onGitHub: string;
/** While set, each turn waits for it before answering, so a turn can be kept running. */
let holding: Promise<void> | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, github: onGitHub } = await codeRepo(root));
  holding = undefined;
});

afterEach(async () => {
  await removeTestFolder(root);
});

const ISSUES: readonly FakeIssue[] = [
  { number: 22, title: "One Reply box everywhere", milestone: "4 · Code workspaces" },
  { number: 23, title: "After it", milestone: "4 · Code workspaces" },
  {
    number: 30,
    title: "Needs a grill",
    milestone: "4 · Code workspaces",
    labels: ["needs-triage"],
  },
];

/** A worker with a code workspace, Side project, on the fake GitHub with `ISSUES`, signed in. */
const signedIn = async (): Promise<{ github: FakeGitHub; request: Requester }> => {
  await codeWorkspace(root, "side-project", repo, { name: "Side project" });
  const github = createFakeGitHub({ issues: { [onGitHub]: ISSUES } });
  const request = await asOwner(
    testWorker({
      root,
      github: github.api,
      providers: [createFakeProvider({ delayMs: 0, beforeReply: async () => holding })],
    }),
  );
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
    .toBe("signed-in");
  return { github, request };
};

/** Starts a code session with the owner's first message, its first turn held until `release`. */
const heldSession = async (request: Requester, text: string) => {
  let release = () => {};
  holding = new Promise<void>((resolve) => {
    release = resolve;
  });
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: FAKE_MODEL,
  });
  expect(response.status).toBe(201);
  const { id } = SessionSummary.parse(await response.json());
  const { branch } = SessionDetail.parse(await (await request(`/api/sessions/${id}`)).json());
  return { id, branch: branch ?? "", release };
};

const stop = (request: Requester, id: string, turn = 1) =>
  postJson(request, `/api/sessions/${id}/stop`, { turn });

const deleteSession = (request: Requester, id: string) =>
  request(`/api/sessions/${id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

const CLAIM = /^Building this: Courtyard session \(courtyard\/[0-9a-f]{8}\), the owner asked$/;

describe("a session started on an issue (#324)", () => {
  it("claims a ready issue its first message names, naming its branch, once", async () => {
    const { github, request } = await signedIn();

    const { id, branch, release } = await heldSession(request, "Build #22, the reply box.");

    expect(branch).toMatch(/^courtyard\//);
    expect(github.commentsOn(onGitHub, 22)).toEqual([
      `Building this: Courtyard session (${branch}), the owner asked`,
    ]);
    release();
    await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(github.commentsOn(onGitHub, 22)).toHaveLength(1);
  });

  it("claims nothing for a message naming no issue, two, or one that isn't ready to build", async () => {
    const { github, request } = await signedIn();

    for (const text of ["Tidy the README", "Compare #22 with #23", "Look at #30", "Look at #99"]) {
      const { id, release } = await heldSession(request, text);
      release();
      await followSession(request, { sessionId: id, until: "turn-completed" });
    }

    for (const number of [22, 23, 30]) expect(github.commentsOn(onGitHub, number)).toEqual([]);
  });

  it("releases the claim when the owner stops it before a pull request, and claims it again when they carry on", async () => {
    const { github, request } = await signedIn();
    const { id, branch } = await heldSession(request, "Build #22");

    expect((await stop(request, id)).status).toBe(202);
    await followSession(request, { sessionId: id, until: "turn-stopped" });

    await expect.poll(() => github.commentsOn(onGitHub, 22)).toHaveLength(2);
    expect(github.commentsOn(onGitHub, 22)[1]).toBe(
      `Stopped: the owner stopped Courtyard session (${branch}) before its pull request.`,
    );
    holding = undefined;
    await postJson(request, `/api/sessions/${id}/messages`, { text: "Go on", model: FAKE_MODEL });
    await followSession(request, {
      sessionId: id,
      until: (event) => event.type === "turn-completed",
    });
    expect(github.commentsOn(onGitHub, 22).slice(2)).toEqual([expect.stringMatching(CLAIM)]);
  });

  it("releases the claim when the owner deletes it before a pull request", async () => {
    const { github, request } = await signedIn();
    const { id, branch, release } = await heldSession(request, "Build #22");
    release();
    await followSession(request, { sessionId: id, until: "turn-completed" });

    expect((await deleteSession(request, id)).status).toBe(204);

    expect(github.commentsOn(onGitHub, 22)).toEqual([
      expect.stringMatching(CLAIM),
      `Stopped: the owner deleted Courtyard session (${branch}) before its pull request.`,
    ]);
  });

  it("says nothing more once it has a pull request, which links the issue itself", async () => {
    const { github, request } = await signedIn();
    const { id, branch } = await heldSession(request, "Build #22");
    github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1", title: "Reply box" });
    await stop(request, id);
    await followSession(request, { sessionId: id, until: "turn-stopped" });

    expect((await deleteSession(request, id)).status).toBe(204);

    expect(github.commentsOn(onGitHub, 22)).toEqual([expect.stringMatching(CLAIM)]);
  });
});
