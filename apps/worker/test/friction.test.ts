import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrictionPlace, type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  errorOf,
  followSession,
  gitIn,
  pngOf,
  postWithFiles,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  type TestFile,
  testWorker,
} from "./testing.ts";

// Something's off (#554): from any screen, the owner files friction in Courtyard's own code
// workspace, the one on the repository the live copy runs from.

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo } = await codeRepo(root));
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A worker with Courtyard's code workspace on `repo`, running as a live copy of it unless `live` is false. */
const courtyard = async (more: { live?: boolean } = {}) => {
  await codeWorkspace(root, "courtyard", repo, { name: "Courtyard" });
  return asOwner(
    testWorker({
      root,
      providers: [createFakeProvider({ delayMs: 0 })],
      env: more.live === false ? {} : { COURTYARD_LIVE_COPY: repo },
    }),
  );
};

const placeOf = async (request: Requester) => {
  const response = await request("/api/friction");
  expect(response.status).toBe(200);
  return FrictionPlace.parse(await response.json());
};

const SCREEN: TestFile = {
  name: "screen.png",
  type: "image/png",
  bytes: pngOf(4, 3, () => [10, 10, 10]),
};

const REPORT = {
  said: "The backup line says Fix it, but not what's wrong",
  page: "Home",
  path: "/",
  size: { device: "unfolded", width: 950, height: 712 },
  version: "8d57986",
  part: "Backup line",
} as const;

const file = (request: Requester, report: unknown, files: readonly TestFile[] = [SCREEN]) =>
  postWithFiles(request, "/api/friction", report, files);

const ownerMessage = (events: readonly SessionEvent[]) => {
  const message = events.find((event) => event.type === "owner-message");
  if (message?.type !== "owner-message") throw new Error("no owner message");
  return message;
};

describe("where Something's off files it", () => {
  it("is the code workspace on the live copy's repository, with the version it runs", async () => {
    const request = await courtyard();
    const head = await gitIn(repo, "rev-parse", "--short=7", "HEAD");

    expect(await placeOf(request)).toEqual({
      workspace: { id: "courtyard", name: "Courtyard" },
      version: head,
    });
  });

  it("is nowhere on a worker that isn't a live copy", async () => {
    const request = await courtyard({ live: false });

    expect(await placeOf(request)).toEqual({ workspace: null, version: null });
  });
});

describe("filing it", () => {
  it("starts a session in Courtyard's code workspace with what was filled in and the screen attached", async () => {
    const request = await courtyard();

    const started = await file(request, REPORT);

    expect(started.status).toBe(201);
    const session = SessionSummary.parse(await started.json());
    expect(session).toMatchObject({
      workspaceId: "courtyard",
      // Cut at a word to fit a session's title.
      title: "Something's off: The backup line says Fix it, but not…",
    });
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect(ownerMessage(events)).toMatchObject({
      text: await quotedInGuide("Something's off in Courtyard", {
        said: REPORT.said,
        page: "Home",
        path: "/",
        size: "the Fold open",
        width: "950",
        height: "712",
        version: "8d57986",
        part: "Backup line",
      }),
      attachments: [{ name: "screen.png", kind: "photo" }],
    });
  });

  it("says so when the screen couldn't be taken, and leaves out what wasn't known", async () => {
    const request = await courtyard();

    const started = await file(request, { ...REPORT, version: null, part: null }, []);

    expect(started.status).toBe(201);
    const session = SessionSummary.parse(await started.json());
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const { text, attachments } = ownerMessage(events);
    expect(attachments).toBeUndefined();
    expect(text).toContain("It was on Home (/), on the Fold open, 950 × 712. The screen");
    expect(text).toContain(await quotedInGuide("The screen couldn't be taken"));
  });

  it("is refused without words, saying what to do", async () => {
    const request = await courtyard();

    const refused = await file(request, { ...REPORT, said: " " });

    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toBe("Say what's off first");
  });

  it("is refused when no code workspace is on Courtyard's own repository", async () => {
    const request = await courtyard({ live: false });

    const refused = await file(request, REPORT);

    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe(
      "There's no code workspace on Courtyard's own repository to file it in.",
    );
  });
});
