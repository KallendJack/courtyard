import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import {
  asOwner,
  errorOf,
  FAKE_MODEL,
  FAKE_TWO_MODEL,
  followSession,
  pdfOf,
  pngOf,
  postJson,
  postWithFiles,
  type Requester,
  startSession,
  type TestFile,
  testWorker,
} from "./testing.ts";

// Photos and PDFs in a message (#78), through the worker's API.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const start = () => asOwner(testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }));

const PHOTO: TestFile = {
  name: "IMG_2041.jpg",
  type: "image/png",
  bytes: pngOf(4, 3, (x) => (x < 2 ? [200, 30, 30] : [30, 30, 200])),
};

const MANUAL: TestFile = {
  name: "rack-manual.pdf",
  type: "application/pdf",
  bytes: pdfOf(["Titan T-3 J-hooks", "The cup is 64 mm across."]),
};

/** Starts a session in garage-gym with `text` and these files attached. */
const startWith = async (request: Requester, text: string, files: readonly TestFile[]) =>
  postWithFiles(request, "/api/workspaces/garage-gym/sessions", { text, model: FAKE_MODEL }, files);

const ownerMessage = (events: readonly SessionEvent[]) => {
  const message = events.find((event) => event.type === "owner-message");
  if (message?.type !== "owner-message") throw new Error("no owner message");
  return message;
};

describe("attaching photos and PDFs to a message", () => {
  it("records each attachment with the owner's message, and serves it back", async () => {
    const request = await start();

    const started = await startWith(request, "Will a 50 mm bar sit in these?", [PHOTO]);
    expect(started.status).toBe(201);
    const session = SessionSummary.parse(await started.json());
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const { attachments } = ownerMessage(events);
    expect(attachments).toEqual([
      {
        id: expect.any(String),
        name: "IMG_2041.jpg",
        kind: "photo",
        mediaType: "image/png",
        size: PHOTO.bytes.length,
      },
    ]);
    const served = await request(`/api/sessions/${session.id}/attachments/${attachments?.[0]?.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array(PHOTO.bytes));
  });

  it("lets the fake say what it was given to look at, when a message scripts it", async () => {
    const request = await start();
    const started = await startWith(request, "please look", [PHOTO, MANUAL]);
    const session = SessionSummary.parse(await started.json());

    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const answer = events.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");
    expect(answer).toBe(
      "I see IMG_2041.jpg (a photo) and rack-manual.pdf (a PDF). You said: please look",
    );
  });

  it("sends a message's attachments again when Carry on sends it to another provider", async () => {
    const request = await asOwner(
      testWorker({
        root,
        providers: [
          createFakeProvider({ delayMs: 0 }),
          createFakeProvider({ delayMs: 0, second: true }),
        ],
      }),
    );
    const started = await postWithFiles(
      request,
      "/api/workspaces/garage-gym/sessions",
      { text: "please look, then please hit Fake two's limit", model: FAKE_TWO_MODEL },
      [PHOTO],
    );
    const session = SessionSummary.parse(await started.json());
    const failed = await followSession(request, { sessionId: session.id, until: "turn-failed" });

    await postJson(request, `/api/sessions/${session.id}/carry-on`, {
      turn: ownerMessage(failed).seq,
    });
    const carried = await followSession(request, {
      sessionId: session.id,
      after: failed.length,
      until: "turn-completed",
    });

    expect(ownerMessage(carried).attachments).toEqual(ownerMessage(failed).attachments);
    const answer = carried.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");
    expect(answer).toMatch(/^I see IMG_2041.jpg \(a photo\)\. /);
  });

  it("takes attachments on a later message too", async () => {
    const request = await start();
    const session = await startSession(request, "Where should the rack go?");
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const sent = await postWithFiles(
      request,
      `/api/sessions/${session.id}/messages`,
      { text: "And this manual?", model: FAKE_MODEL },
      [MANUAL],
    );
    expect(sent.status).toBe(202);
    const events = await followSession(request, {
      sessionId: session.id,
      until: (event) => event.type === "owner-message" && event.text === "And this manual?",
    });

    expect(events.at(-1)).toMatchObject({
      attachments: [{ name: "rack-manual.pdf", kind: "pdf", mediaType: "application/pdf" }],
    });
  });

  it("refuses what can't go, saying why, and starts nothing", async () => {
    const request = await start();
    const refusals = await Promise.all(
      [
        [{ name: "garage-tour.mov", type: "video/quicktime", bytes: new Uint8Array([1, 2, 3]) }],
        // Bigger than Claude takes, though the browser always shrinks a photo well under it.
        [{ ...PHOTO, name: "huge.png", bytes: new Uint8Array(4 * 1024 * 1024) }],
        [{ ...MANUAL, name: "huge.pdf", bytes: new Uint8Array(20 * 1024 * 1024 + 1) }],
        [{ name: "not-a-photo.jpg", type: "image/jpeg", bytes: new TextEncoder().encode("hi") }],
        Array.from({ length: 6 }, (_, n) => ({ ...PHOTO, name: `photo-${n}.png` })),
        [{ name: "scan.pdf", type: "application/pdf", bytes: pdfOf([]) }],
      ].map(async (files) => {
        const response = await startWith(request, "Look at these", files);
        return { status: response.status, error: await errorOf(response) };
      }),
    );

    expect(refusals).toEqual([
      { status: 400, error: "garage-tour.mov can't be attached: only photos and PDFs." },
      { status: 400, error: "huge.png is over 3.75 MB, the largest photo every model takes." },
      { status: 400, error: "huge.pdf is over 20 MB." },
      { status: 400, error: "not-a-photo.jpg isn't the kind of file its name says." },
      { status: 400, error: "Only 5 photos or PDFs go with a message." },
      {
        status: 400,
        error:
          "scan.pdf has no text a model can read: it's probably a scan. Send a photo of the page instead.",
      },
    ]);
    const list = await request("/api/workspaces/garage-gym/sessions");
    expect(await list.json()).toEqual({ sessions: [], running: 0 });
  });

  it("deletes its attachments with the session", async () => {
    const request = await start();
    const started = await startWith(request, "Look", [PHOTO, MANUAL]);
    const session = SessionSummary.parse(await started.json());
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const [photo] = ownerMessage(events).attachments ?? [];

    const deleted = await request(`/api/sessions/${session.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    });
    expect(deleted.status).toBe(204);

    expect((await request(`/api/sessions/${session.id}/attachments/${photo?.id}`)).status).toBe(
      404,
    );
    expect(await readdir(join(root, "data", "sessions"))).toEqual([]);
  });
});
