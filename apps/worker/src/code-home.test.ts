import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODE_SESSIONS_AT_ONCE,
  CodeSessionList,
  GitHubConnection,
  LiveStatus,
  NextUp,
  PaperFileList,
  SessionSummary,
  WorkspaceConnections,
  WorkspaceDetail,
  WorkspaceMain,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIssueMessage } from "./agent/prompts/index.ts";
import { createFakeProvider } from "./agent/providers/fake.ts";
import type { Provider } from "./agent/providers/index.ts";
import { createFakePaperFiles, type FakePaperFiles } from "./integrations/paper/fake.ts";
import {
  asOwner,
  CODING_MODEL,
  changesIn,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  errorOf,
  FAKE_MODEL,
  type FakeIssue,
  followSession,
  gitIn,
  heldCoder,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// A code workspace's Home (#301) and its connections (#308): its one line in workspace.json, Next
// up from its repository's milestones and ready issues, Build (#298), and connecting Paper.

let root: string;
let repo: string;
/** The bare repository standing in for the one on GitHub. */
let origin: string;
/** The repository on GitHub, as `owner/name`: what the code workspace's remote names. */
let onGitHub: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, origin, github: onGitHub } = await codeRepo(root));
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A worker with a code workspace, Side project, on the fake GitHub with these issues, signed in. */
const signedInWith = async (
  issues: readonly FakeIssue[],
  more: {
    paper?: FakePaperFiles;
    config?: Record<string, unknown>;
    signIn?: boolean;
    /** Its milestones' descriptions, by title. */
    milestones?: Readonly<Record<string, string>>;
    providers?: readonly Provider[];
  } = {},
) => {
  await codeWorkspace(root, "side-project", repo, { name: "Side project", ...more.config });
  const github = createFakeGitHub({
    issues: { [onGitHub]: issues },
    ...(more.milestones === undefined ? {} : { milestones: { [onGitHub]: more.milestones } }),
  });
  const request = await asOwner(
    testWorker({
      root,
      github: github.api,
      providers: more.providers ?? [createFakeProvider({ delayMs: 0 })],
      ...(more.paper === undefined ? {} : { paperFiles: more.paper.paper }),
    }),
  );
  if (more.signIn !== false) {
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");
  }
  return { github, request };
};

const nextUpOf = async (request: Requester) => {
  const response = await request("/api/workspaces/side-project/next-up");
  expect(response.status).toBe(200);
  return NextUp.parse(await response.json()).issues.map((issue) => [issue.number, issue.milestone]);
};

describe("a code workspace's one line (#301)", () => {
  it("lives in its workspace.json, and the page reads no context file", async () => {
    await codeWorkspace(root, "side-project", repo, { description: "A side project" });
    const request = await asOwner(testWorker({ root }));

    const detail = WorkspaceDetail.parse(
      await (await request("/api/workspaces/side-project")).json(),
    );

    expect(detail).toMatchObject({ contextFile: null, description: "A side project" });
  });

  it("is read from a context file kept from before, until its workspace.json has one, and nothing else of it shows", async () => {
    await codeWorkspace(root, "side-project", repo);
    await writeFile(
      join(root, "context", "side-project", "CONTEXT.md"),
      "# Side project\n\nPlan and code with AI models.\n\n## Facts\n\n- Single garage.\n",
    );
    const request = await asOwner(testWorker({ root }));

    const detail = WorkspaceDetail.parse(
      await (await request("/api/workspaces/side-project")).json(),
    );

    expect(detail).toMatchObject({
      workspace: { name: "Side project", hasContextFile: false },
      contextFile: null,
      description: "Plan and code with AI models.",
    });
  });

  it("is none when the context file kept from before still holds the old starter hint (#333)", async () => {
    await codeWorkspace(root, "side-project", repo);
    await writeFile(
      join(root, "context", "side-project", "CONTEXT.md"),
      [
        "# Side project",
        "",
        "Write one line for each fact, plan or idea. Facts are true now, plans are decided but not done, and ideas are being considered.",
        "",
        "## Facts",
        "",
      ].join("\n"),
    );
    const request = await asOwner(testWorker({ root }));

    const detail = WorkspaceDetail.parse(
      await (await request("/api/workspaces/side-project")).json(),
    );

    expect(detail).toMatchObject({ workspace: { name: "Side project" }, contextFile: null });
    expect(detail.description).toBeUndefined();
  });
});

describe("Next up (#301)", () => {
  it("offers the ready issues nobody has claimed, in milestone order, Later last and no milestone after it", async () => {
    const { github, request } = await signedInWith([
      { number: 40, title: "Later idea", milestone: "Later" },
      { number: 31, title: "Polish", milestone: "7 · Polish" },
      { number: 12, title: "Tablet hub", milestone: "5 · Tablet hub" },
      { number: 9, title: "No milestone" },
      { number: 20, title: "Claimed by a comment", milestone: "4 · Code workspaces" },
      { number: 21, title: "Claimed by a pull request", milestone: "4 · Code workspaces" },
      { number: 22, title: "Next", milestone: "4 · Code workspaces" },
      { number: 25, title: "Claimed, then stopped", milestone: "4 · Code workspaces" },
      { number: 23, title: "Not ready", milestone: "4 · Code workspaces", labels: ["enhancement"] },
      { number: 24, title: "Closed", milestone: "4 · Code workspaces", state: "closed" },
    ]);
    github.comment(onGitHub, 20, "Building this: Claude Code helper (branch 20-thing)");
    // A claim released is free again (AGENTS.md, claim rule).
    github.comment(onGitHub, 25, "Building this: Claude Code helper (25-thing), next in order");
    github.comment(onGitHub, 25, "Stopped: the board isn't agreed yet.");
    github.openPullRequest({
      repo: onGitHub,
      branch: "21-thing",
      head: "c0ffee1",
      body: "Does the thing.\n\nCloses #21",
    });

    expect(await nextUpOf(request)).toEqual([
      [22, "4 · Code workspaces"],
      [25, "4 · Code workspaces"],
      [12, "5 · Tablet hub"],
      [31, "7 · Polish"],
      [40, "Later"],
      [9, null],
    ]);
  });

  it("uses the ready issues in number order when the repository has no milestones, and none when none are ready", async () => {
    const { request } = await signedInWith([
      { number: 7, title: "Seven" },
      { number: 3, title: "Three" },
    ]);
    expect(await nextUpOf(request)).toEqual([
      [3, null],
      [7, null],
    ]);
  });

  it("follows a milestone's Build order line, then the rest of it by number (#336)", async () => {
    const { request } = await signedInWith(
      [
        { number: 12, title: "Tablet hub", milestone: "5 · Tablet hub" },
        { number: 2, title: "Two", milestone: "4 · Code workspaces" },
        { number: 3, title: "Three", milestone: "4 · Code workspaces" },
        { number: 5, title: "Five", milestone: "4 · Code workspaces" },
        { number: 9, title: "Nine", milestone: "4 · Code workspaces" },
      ],
      {
        milestones: {
          "4 · Code workspaces": "NOW. Build order: #9 → #7 → #3. Notes in #1.",
          "5 · Tablet hub": "Next.",
        },
      },
    );

    expect(await nextUpOf(request)).toEqual([
      [9, "4 · Code workspaces"],
      [3, "4 · Code workspaces"],
      [2, "4 · Code workspaces"],
      [5, "4 · Code workspaces"],
      [12, "5 · Tablet hub"],
    ]);
  });

  it("lists the issues on a Build order line that need grilling first in their place, and no others that aren't ready (#363)", async () => {
    const { request } = await signedInWith(
      [
        { number: 2, title: "Two", milestone: "4 · Code workspaces" },
        {
          number: 117,
          title: "Sub-agents",
          milestone: "4 · Code workspaces",
          labels: ["needs-triage"],
        },
        { number: 8, title: "Eight", milestone: "4 · Code workspaces", labels: ["needs-info"] },
        {
          number: 6,
          title: "Off the line",
          milestone: "4 · Code workspaces",
          labels: ["needs-triage"],
        },
        {
          number: 7,
          title: "For a human",
          milestone: "4 · Code workspaces",
          labels: ["ready-for-human"],
        },
        { number: 12, title: "Tablet hub", milestone: "5 · Tablet hub", labels: ["needs-triage"] },
      ],
      {
        milestones: {
          "4 · Code workspaces": "NOW. Build order: #117 → #2 → #7 → #8.",
          "5 · Tablet hub": "Next.",
        },
      },
    );

    const response = await request("/api/workspaces/side-project/next-up");

    expect(
      NextUp.parse(await response.json()).issues.map((issue) => [issue.number, issue.ready]),
    ).toEqual([
      [117, false],
      [2, true],
      [8, false],
    ]);
  });

  it("says which open issue a ready one is blocked by, keeping it in its place, and ignores a closed blocker (#377)", async () => {
    const { request } = await signedInWith(
      [
        { number: 2, title: "One loading state", milestone: "4 · Code workspaces" },
        {
          number: 3,
          title: "Nothing moves once drawn",
          milestone: "4 · Code workspaces",
          blockedBy: [2],
        },
        { number: 4, title: "Buttons working", milestone: "4 · Code workspaces", blockedBy: [9] },
        { number: 9, title: "Done already", state: "closed" },
      ],
      { milestones: { "4 · Code workspaces": "Build order: #3 → #2 → #4." } },
    );

    const response = await request("/api/workspaces/side-project/next-up");

    expect(
      NextUp.parse(await response.json()).issues.map((issue) => [issue.number, issue.after]),
    ).toEqual([
      [3, "One loading state"],
      [2, null],
      [4, null],
    ]);
  });

  it("asks GitHub only when a page asks, then keeps the answer a couple of minutes", async () => {
    const { github, request } = await signedInWith([{ number: 3, title: "Three" }]);
    expect(github.issuesAsked()).toBe(0);

    await nextUpOf(request);
    const asked = github.issuesAsked();
    await nextUpOf(request);

    expect(asked).toBeGreaterThan(0);
    expect(github.issuesAsked()).toBe(asked);
  });

  it("says to sign in to GitHub while no one is", async () => {
    const { request } = await signedInWith([{ number: 3, title: "Three" }], { signIn: false });

    const response = await request("/api/workspaces/side-project/next-up");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Sign in to GitHub/);
  });
});

describe("Build (#298)", () => {
  it("starts a code session whose first message is the issue, and claims the issue for its branch", async () => {
    const { github, request } = await signedInWith([
      { number: 22, title: "One Reply box everywhere", milestone: "4 · Code workspaces" },
      { number: 23, title: "After it", milestone: "4 · Code workspaces" },
    ]);
    expect(await nextUpOf(request)).toHaveLength(2);

    const response = await postJson(request, "/api/workspaces/side-project/next-up/22/build", {
      model: FAKE_MODEL,
    });

    expect(response.status).toBe(201);
    const session = SessionSummary.parse(await response.json());
    expect(session.title).toBe("Build #22: One Reply box everywhere");
    const events = await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
    });
    const first = events.find((event) => event.type === "owner-message");
    expect(first?.type === "owner-message" && first.text).toBe(
      await quotedInGuide("Build issue #<number>", {
        number: "22",
        title: "One Reply box everywhere",
      }),
    );
    expect(buildIssueMessage({ number: 22, title: "One Reply box everywhere" })).toBe(
      first?.type === "owner-message" ? first.text : "",
    );
    expect(github.commentsOn(onGitHub, 22)).toEqual([
      expect.stringMatching(
        /^Building this: Courtyard session \(courtyard\/[0-9a-f]{8}\), next in order$/,
      ),
    ]);
    // It leaves Next up at once, for every page.
    expect(await nextUpOf(request)).toEqual([[23, "4 · Code workspaces"]]);
  });

  it("refuses an issue someone claimed since the page showed it, and starts nothing", async () => {
    const { github, request } = await signedInWith([{ number: 22, title: "Taken" }]);
    await nextUpOf(request);
    github.comment(onGitHub, 22, "Building this: Courtyard session courtyard/abcd1234");

    const response = await postJson(request, "/api/workspaces/side-project/next-up/22/build", {
      model: FAKE_MODEL,
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/claimed/);
    const listed = await request("/api/workspaces/side-project/sessions");
    expect(((await listed.json()) as { sessions: unknown[] }).sessions).toEqual([]);
  });
});

describe("Build on an issue blocked by an open one (#377)", () => {
  it("is refused, starting and claiming nothing, until its blocker closes", async () => {
    const { github, request } = await signedInWith([
      { number: 2, title: "One loading state" },
      { number: 3, title: "Nothing moves once drawn", blockedBy: [2] },
    ]);

    const refused = await postJson(request, "/api/workspaces/side-project/next-up/3/build", {
      model: FAKE_MODEL,
    });

    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe(
      "That issue waits on One loading state: it's offered to build once that closes.",
    );
    expect(github.commentsOn(onGitHub, 3)).toEqual([]);
    const listed = await request("/api/workspaces/side-project/sessions");
    expect(((await listed.json()) as { sessions: unknown[] }).sessions).toEqual([]);

    github.closeIssue(onGitHub, 2);
    const built = await postJson(request, "/api/workspaces/side-project/next-up/3/build", {
      model: FAKE_MODEL,
    });

    expect(built.status).toBe(201);
    expect(github.commentsOn(onGitHub, 3)).toEqual([
      expect.stringMatching(/^Building this: Courtyard session/),
    ]);
  });
});

describe("Grill (#363)", () => {
  const needsGrilling = [
    {
      number: 117,
      title: "Sub-agents",
      milestone: "4 · Code workspaces",
      labels: ["needs-triage"],
    },
    { number: 22, title: "Ready one", milestone: "4 · Code workspaces" },
  ];
  const buildOrder = { "4 · Code workspaces": "Build order: #117 → #22." };

  it("starts a code session with the grilling skill whose first message is the issue, and claims nothing", async () => {
    const { github, request } = await signedInWith(needsGrilling, { milestones: buildOrder });

    const response = await postJson(request, "/api/workspaces/side-project/next-up/117/grill", {
      model: FAKE_MODEL,
    });

    expect(response.status).toBe(201);
    const session = SessionSummary.parse(await response.json());
    expect(session.title).toBe("Grill #117: Sub-agents");
    const events = await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
    });
    const first = events.find((event) => event.type === "owner-message");
    expect(first).toMatchObject({
      text: await quotedInGuide("Grill issue #<number>", { number: "117", title: "Sub-agents" }),
      skill: "grilling",
    });
    expect(github.commentsOn(onGitHub, 117)).toEqual([]);
  });

  it("doesn't take a builder's place among the code sessions running", async () => {
    const { provider, turns } = heldCoder();
    const { request } = await signedInWith(needsGrilling, {
      milestones: buildOrder,
      providers: [provider],
    });
    for (let place = 1; place <= CODE_SESSIONS_AT_ONCE; place += 1) {
      await postJson(request, "/api/workspaces/side-project/sessions", {
        text: `Task ${place}`,
        model: CODING_MODEL,
      });
    }
    await vi.waitFor(() => expect(turns).toHaveLength(CODE_SESSIONS_AT_ONCE));

    const response = await postJson(request, "/api/workspaces/side-project/next-up/117/grill", {
      model: CODING_MODEL,
    });

    expect(response.status).toBe(201);
    await vi.waitFor(() => expect(turns).toHaveLength(CODE_SESSIONS_AT_ONCE + 1));
    const listed = CodeSessionList.parse(
      await (await request("/api/workspaces/side-project/sessions")).json(),
    );
    expect(listed.running).toBe(CODE_SESSIONS_AT_ONCE);
    expect(turns[CODE_SESSIONS_AT_ONCE]?.env.COURTYARD_SESSION_SLOT).toBeUndefined();
    for (const turn of turns) turn.finish();
  });

  it("refuses an issue that doesn't need grilling, and starts nothing", async () => {
    const { request } = await signedInWith(needsGrilling, { milestones: buildOrder });

    const response = await postJson(request, "/api/workspaces/side-project/next-up/22/grill", {
      model: FAKE_MODEL,
    });

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toMatch(/doesn't need grilling/);
    const listed = await request("/api/workspaces/side-project/sessions");
    expect(((await listed.json()) as { sessions: unknown[] }).sessions).toEqual([]);
  });
});

describe("main (#301's Main row)", () => {
  it("gives the default branch's newest commit and its build, and says when it's the live copy's repository", async () => {
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub();
    const head = await gitIn(repo, "rev-parse", "HEAD");
    github.setCommitChecks(head, [
      {
        id: 1,
        name: "Checks",
        outcome: "passed",
        url: "https://github.com/octo-owner/side-project/actions/runs/1",
        startedAt: "2026-10-12T09:00:00Z",
        completedAt: "2026-10-12T09:01:00Z",
      },
    ]);
    const request = await asOwner(
      testWorker({ root, github: github.api, env: { COURTYARD_LIVE_COPY: repo } }),
    );
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");

    const response = await request("/api/workspaces/side-project/main");

    expect(response.status).toBe(200);
    expect(WorkspaceMain.parse(await response.json())).toEqual({
      newest: { commit: head, title: `${head.slice(0, 7)} Start` },
      build: {
        kind: "passed",
        startedAt: "2026-10-12T09:00:00.000Z",
        completedAt: "2026-10-12T09:01:00.000Z",
        stages: [
          [
            {
              name: "Checks",
              outcome: "passed",
              startedAt: "2026-10-12T09:00:00.000Z",
              completedAt: "2026-10-12T09:01:00.000Z",
              shards: null,
              needs: [],
            },
          ],
        ],
      },
      liveCopy: true,
    });
  });

  it("names a merge commit by the title of the pull request it merged (#335)", async () => {
    await codeWorkspace(root, "side-project", repo);
    await gitIn(repo, "switch", "--quiet", "-c", "301-code-workspace-home");
    await writeFile(join(repo, "home.md"), "Home\n");
    await gitIn(repo, "add", ".");
    await gitIn(repo, "commit", "--quiet", "-m", "Draw the Home");
    await gitIn(repo, "switch", "--quiet", "main");
    await gitIn(
      repo,
      "merge",
      "--quiet",
      "--no-ff",
      "-m",
      "Merge pull request #331 from octo-owner/301-code-workspace-home",
      "-m",
      "Code workspace Home",
      "301-code-workspace-home",
    );
    await gitIn(repo, "push", "--quiet", "origin", "main");
    const head = await gitIn(repo, "rev-parse", "HEAD");
    const github = createFakeGitHub();
    const request = await asOwner(testWorker({ root, github: github.api }));
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");

    const response = await request("/api/workspaces/side-project/main");

    expect(WorkspaceMain.parse(await response.json()).newest).toEqual({
      commit: head,
      title: `${head.slice(0, 7)} Code workspace Home`,
    });
  });

  it("is asked afresh once the app merges a pull request, as the live copy's status is (#387)", async () => {
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub();
    const request = await asOwner(
      testWorker({ root, github: github.api, env: { COURTYARD_LIVE_COPY: repo } }),
    );
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");
    const newestOnMain = async () =>
      WorkspaceMain.parse(await (await request("/api/workspaces/side-project/main")).json()).newest
        .commit;
    const live = async () => LiveStatus.parse(await (await request("/api/live")).json());
    const start = await gitIn(repo, "rev-parse", "HEAD");
    expect(await newestOnMain()).toBe(start);
    expect(await live()).toMatchObject({ newerOnMain: false });
    // A pull request's branch, and main moved on to it as GitHub's merge moves it.
    const elsewhere = join(root, "elsewhere");
    await gitIn(root, "clone", "--quiet", origin, elsewhere);
    await gitIn(elsewhere, "switch", "--quiet", "-c", "306-machine-lock");
    await writeFile(join(elsewhere, "builds.md"), "Builds take turns\n");
    await gitIn(elsewhere, "add", ".");
    await gitIn(elsewhere, "commit", "--quiet", "-m", "Builds take turns");
    await gitIn(
      elsewhere,
      "push",
      "--quiet",
      "origin",
      "306-machine-lock",
      "306-machine-lock:main",
    );
    const head = (await gitIn(elsewhere, "rev-parse", "HEAD")).trim();
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: "306-machine-lock",
      head,
      title: "Builds queue",
      body: "## Summary\n\nBuilds take turns.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    });

    const merging = await postJson(
      request,
      `/api/workspaces/side-project/pull-requests/${number}/merge`,
      { head },
    );

    expect(merging.status).toBe(204);
    expect(await newestOnMain()).toBe(head);
    expect(await live()).toMatchObject({ newerOnMain: true, newest: { commit: head } });
  });
});

describe("connections (#308)", () => {
  const connectionsOf = async (request: Requester) =>
    WorkspaceConnections.parse(
      await (await request("/api/workspaces/side-project/connections")).json(),
    );

  it("says GitHub is connected on the repository, and that there's no Paper file yet", async () => {
    const { request } = await signedInWith([]);

    expect(await connectionsOf(request)).toEqual({
      github: { kind: "connected", repo: onGitHub },
      paper: { kind: "none" },
    });
  });

  it("lists the owner's Paper files and connects the one picked, kept in workspace.json as one change", async () => {
    const paper = createFakePaperFiles({
      files: [
        { id: "file-1", name: "Courtyard" },
        { id: "file-2", name: "Side project" },
      ],
    });
    const { request } = await signedInWith([], {
      paper,
      // Paper's command comes from another code workspace that names it.
      config: {},
    });
    await codeWorkspace(root, "stacks", repo, {
      connections: { paper: { command: "/path/to/paper", fileId: "file-1" } },
    });

    const files = await request("/api/workspaces/side-project/connections/paper/files");
    expect(PaperFileList.parse(await files.json()).files.map((file) => file.name)).toEqual([
      "Courtyard",
      "Side project",
    ]);
    const connected = await postJson(request, "/api/workspaces/side-project/connections/paper", {
      kind: "file",
      file: { id: "file-2", name: "Side project" },
    });

    expect(connected.status).toBe(200);
    expect(WorkspaceConnections.parse(await connected.json()).paper).toEqual({
      kind: "connected",
      fileId: "file-2",
      name: "Side project",
    });
    const config: unknown = JSON.parse(
      await readFile(join(root, "context", "side-project", "workspace.json"), "utf8"),
    );
    expect(config).toMatchObject({
      name: "Side project",
      mode: "code",
      connections: {
        paper: { command: "/path/to/paper", fileId: "file-2", name: "Side project" },
      },
    });
    expect((await changesIn(join(root, "context")))[0]?.title).toBe(
      "Connect Paper to Side project: Side project",
    );
    expect(paper.asked()).toEqual(["/path/to/paper"]);
  });

  it("makes a new Paper file named after the workspace and connects it", async () => {
    const paper = createFakePaperFiles();
    const { request } = await signedInWith([], {
      paper,
      config: { connections: { paper: { command: "/path/to/paper", fileId: "old" } } },
    });

    const connected = await postJson(request, "/api/workspaces/side-project/connections/paper", {
      kind: "new",
      name: "Side project",
    });

    expect(WorkspaceConnections.parse(await connected.json()).paper).toEqual({
      kind: "connected",
      fileId: "new-file-1",
      name: "Side project",
    });
    expect(paper.files()).toEqual([{ id: "new-file-1", name: "Side project" }]);
  });

  it("says when Paper isn't open on the worker machine, or Courtyard doesn't know where it is", async () => {
    const paper = createFakePaperFiles();
    const { request } = await signedInWith([], { paper });

    const unknown = await request("/api/workspaces/side-project/connections/paper/files");
    expect(unknown.status).toBe(409);
    expect(await errorOf(unknown)).toMatch(/COURTYARD_PAPER_COMMAND/);

    await codeWorkspace(root, "stacks", repo, {
      connections: { paper: { command: "/path/to/paper", fileId: "file-1" } },
    });
    paper.setOpen(false);
    const closed = await request("/api/workspaces/side-project/connections/paper/files");
    expect(closed.status).toBe(503);
    expect(await errorOf(closed)).toMatch(/Open Paper on the worker machine/);
  });
});
