import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FreshStartSummary,
  OwnerContextDetail,
  ProviderList,
  RecentChanges,
  SignInList,
  TidyProposal,
  WorkspaceList,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  FAKE_MODEL,
  FAKE_TWO_MODEL,
  followSession,
  gatedProvider,
  gitIn,
  postJson,
  type Requester,
  SAVING_MODEL,
  savingProvider,
  startSession,
  testWorker,
} from "./testing.ts";

// Fresh start (spec stories 105-107): clears everything from trying Courtyard out, so it starts as
// on its first run, and keeps the owner's login, sign-ins and remembered limits.

let root: string;
let clock: number;
const contextDir = () => join(root, "context");
const dataDir = () => join(root, "data");

const GARAGE_GYM = [
  "# Garage gym",
  "",
  "## Facts",
  "",
  "- Single garage.",
  "",
  "## Plans",
  "",
  "## Ideas",
  "",
].join("\n");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(contextDir(), "garage-gym"), { recursive: true });
  await writeFile(join(contextDir(), "garage-gym", "CONTEXT.md"), GARAGE_GYM);
  await mkdir(join(contextDir(), "archived", "old-allotment"), { recursive: true });
  await writeFile(join(contextDir(), "archived", "old-allotment", "CONTEXT.md"), "# Allotment\n");
  await writeFile(join(contextDir(), "notes.md"), "Loose notes.\n");
  clock = Date.parse("2026-10-08T12:00:00.000Z");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const now = () => clock;

const start = (providers: readonly Provider[] = [createFakeProvider({ delayMs: 0, now })]) =>
  asOwner(testWorker({ root, providers, now }));

const summaryOf = async (request: Requester) => {
  const response = await request("/api/fresh-start");
  expect(response.status).toBe(200);
  return FreshStartSummary.parse(await response.json());
};

const startFresh = (request: Requester, confirm: unknown = "start fresh") =>
  postJson(request, "/api/fresh-start", { confirm });

/** Starts a session in garage-gym and waits for its first answer and the title a model gives it after. */
const finishedSession = async (request: Requester, text: string) => {
  const session = await startSession(request, text);
  await followSession(request, { sessionId: session.id, until: "session-titled" });
  return session;
};

const workspacesOf = async (request: Requester) =>
  WorkspaceList.parse(await (await request("/api/workspaces")).json()).workspaces;

describe("what a fresh start would clear", () => {
  it("counts the workspaces, archived ones too, and the sessions, and names the folder they'd go to", async () => {
    const request = await start();
    await finishedSession(request, "Where should the rack go?");
    await finishedSession(request, "Mats or tiles?");

    expect(await summaryOf(request)).toEqual({
      workspaces: 2,
      sessions: 2,
      tidies: 0,
      running: null,
      folder: "fresh-starts/2026-10-08",
    });
  });

  it("names a session whose turn is running, with its workspace", async () => {
    const { provider, release } = gatedProvider();
    const request = await start([provider]);
    const session = await startSession(request, "Where should the rack go?");

    expect((await summaryOf(request)).running).toEqual({
      id: session.id,
      title: "Where should the rack go?",
      workspaceId: "garage-gym",
      workspaceName: "Garage gym",
    });
    release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
  });
});

describe("a fresh start", () => {
  it("clears every workspace, archived ones too, the owner context and every other file", async () => {
    const request = await start();
    await postJson(request, "/api/owner-context", {});

    const response = await startFresh(request);

    expect(response.status).toBe(204);
    expect(await workspacesOf(request)).toEqual([]);
    const owner = OwnerContextDetail.parse(await (await request("/api/owner-context")).json());
    expect(owner.ownerContext).toBeNull();
    expect((await readdir(contextDir())).filter((name) => name !== ".git")).toEqual([]);
  });

  it("is one Fresh start change, and the old files are still in the history", async () => {
    const request = await start();

    await startFresh(request);

    const [last] = await changesIn(contextDir());
    expect(last?.title).toBe("Fresh start");
    expect(last?.trailers).toContain("Courtyard-Change: fresh-start");
    const before = await gitIn(contextDir(), "show", "HEAD^:garage-gym/CONTEXT.md");
    expect(before).toContain("Single garage.");
    expect(await gitIn(contextDir(), "show", "HEAD^:notes.md")).toBe("Loose notes.");
  });

  it("moves the sessions to a dated folder in the data folder, -2 for a second the same day", async () => {
    const request = await start();
    const first = await finishedSession(request, "Where should the rack go?");
    await startFresh(request);
    await mkdir(join(contextDir(), "garage-gym"), { recursive: true });
    const second = await finishedSession(request, "Mats or tiles?");

    expect((await summaryOf(request)).folder).toBe("fresh-starts/2026-10-08-2");
    await startFresh(request);

    const firstEvents = join(dataDir(), "fresh-starts", "2026-10-08", first.id, "events.jsonl");
    expect(await readFile(firstEvents, "utf8")).toContain("Where should the rack go?");
    const secondFile = join(dataDir(), "fresh-starts", "2026-10-08-2", second.id, "events.jsonl");
    expect(await readFile(secondFile, "utf8")).toContain("Mats or tiles?");
    expect(await readdir(join(dataDir(), "sessions")).catch(() => [])).toEqual([]);
    expect((await summaryOf(request)).sessions).toBe(0);
    expect((await request(`/api/sessions/${second.id}`)).status).toBe(404);
  });

  it("keeps the owner's login, the sign-ins, Not now and the usage limits remembered", async () => {
    const request = await start([
      createFakeProvider({ delayMs: 0, now, signIn: { finishAfterMs: 60_000 } }),
      createFakeProvider({ delayMs: 0, now, second: true }),
    ]);
    await postJson(request, "/api/sign-ins/fake/not-now", {});
    const limited = await startSession(request, "please hit Fake two's limit", FAKE_TWO_MODEL);
    await followSession(request, { sessionId: limited.id, until: "turn-failed" });

    expect((await startFresh(request)).status).toBe(204);

    // Still logged in, on the same device.
    expect((await request("/api/workspaces")).status).toBe(200);
    const { signIns } = SignInList.parse(await (await request("/api/sign-ins")).json());
    expect(signIns[0]?.notNow).toBe(true);
    const { providers } = ProviderList.parse(await (await request("/api/providers")).json());
    const fakeTwo = providers.find((provider) => provider.id === "fake-two");
    expect(fakeTwo?.available && fakeTwo.models[0]?.limit).toBeDefined();
  });

  it("drops a tidy waiting for review", async () => {
    await writeFile(
      join(contextDir(), "garage-gym", "CONTEXT.md"),
      GARAGE_GYM.replace("- Single garage.", "- Double garage (merge)\n- 5.4 m by 5.1 m (merge)"),
    );
    const request = await start();
    const proposed = await postJson(request, "/api/workspaces/garage-gym/tidy", {
      model: FAKE_MODEL,
    });
    const tidy = TidyProposal.parse(await proposed.json());
    expect((await summaryOf(request)).tidies).toBe(1);

    await startFresh(request);

    expect((await summaryOf(request)).tidies).toBe(0);
    const saved = await postJson(request, `/api/tidies/${tidy.id}/save`, { keep: [0] });
    expect(saved.status).toBe(404);
  });

  it("is refused while a turn is running, naming the session, and clears nothing", async () => {
    const { provider, release } = gatedProvider();
    const request = await start([provider]);
    const session = await startSession(request, "Where should the rack go?");

    const response = await startFresh(request);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/“Where should the rack go\?” in Garage gym/);
    expect((await workspacesOf(request)).map((workspace) => workspace.id)).toEqual(["garage-gym"]);
    expect((await summaryOf(request)).sessions).toBe(1);
    release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
  });

  it("stops a session asked for just before it from starting after it", async () => {
    const fake = createFakeProvider({ delayMs: 0, now });
    let holding = false;
    let asked = () => {};
    const statusAsked = new Promise<void>((resolve) => {
      asked = resolve;
    });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Holds the new session at its provider's status, while the fresh start happens.
    const held: Provider = {
      ...fake,
      status: async () => {
        if (holding) {
          asked();
          await released;
        }
        return fake.status();
      },
    };
    const request = await start([held]);
    holding = true;
    const starting = postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where should the rack go?",
      model: FAKE_MODEL,
    });
    await statusAsked;
    holding = false;

    expect((await startFresh(request)).status).toBe(204);
    release();

    expect((await starting).status).toBe(409);
    expect((await summaryOf(request)).sessions).toBe(0);
  });

  it("is refused without the exact confirm words", async () => {
    const request = await start();

    for (const confirm of ["Start Fresh", "start", null]) {
      const response = await startFresh(request, confirm);
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toMatch(/Type “start fresh” to confirm/);
    }
    expect(await workspacesOf(request)).toHaveLength(1);
  });

  it("is refused while the context folder can't be kept in git, and clears nothing", async () => {
    const request = await start();
    // A file where git keeps its repository: nothing can be committed.
    await rm(join(contextDir(), ".git"), { recursive: true, force: true });
    await writeFile(join(contextDir(), ".git"), "not a repository");

    const response = await startFresh(request);

    expect(response.status).toBe(500);
    expect(await errorOf(response)).toMatch(/can't be kept in git/);
    expect(await workspacesOf(request)).toHaveLength(1);
  });
});

describe("Recent changes after a fresh start", () => {
  // Many real git changes in a row: slow on Windows while every test file runs at once.
  it("stop at it, so a workspace reusing an old folder name, or a new owner context, starts empty", async () => {
    const saver = savingProvider([
      [
        { action: "add", section: "facts", text: "Padel lessons on Tuesdays." },
        { action: "add", place: "owner", section: "facts", text: "Lives in Leeds." },
      ],
    ]);
    const request = await start([saver.provider]);
    await postJson(request, "/api/owner-context", {});
    const session = await startSession(request, "Some news.", SAVING_MODEL);
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const listed = async (path: string) =>
      RecentChanges.parse(await (await request(path)).json()).changes;
    expect(await listed("/api/workspaces/garage-gym/changes")).toHaveLength(1);

    await startFresh(request);
    await postJson(request, "/api/workspaces", { name: "Garage gym" });
    await postJson(request, "/api/owner-context", {});

    expect(await listed("/api/workspaces/garage-gym/changes")).toEqual([]);
    expect(await listed("/api/owner-context/changes")).toEqual([]);
  }, 20_000);
});
