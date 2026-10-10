import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationsStatus } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/index.ts";
import {
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  createFakePush,
  type FakePush,
  followSession,
  loginCookie,
  postJson,
  type Requester,
  requesterFor,
  setUpOwner,
  startSession,
  testWorker,
} from "./testing.ts";

// Notifications (#173): web push, turned on per device, when a session needs an approval and when
// a turn finishes or fails. The sender is passed in, so these tests read what was sent.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  const { repo } = await codeRepo(root);
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/** The worker's public key, which a browser subscribes with. */
const publicKeyOf = async (request: Requester) => {
  const response = await request("/api/notifications");
  expect(response.status).toBe(200);
  return NotificationsStatus.parse(await response.json()).publicKey;
};

/** A browser's push subscription, as it sends it when its device turns notifications on. */
const subscription = (device: string) => ({
  endpoint: `https://push.example/${device}`,
  keys: { p256dh: `p256dh-of-${device}`, auth: `auth-of-${device}` },
  expirationTime: null,
});

const turnOn = (request: Requester, device: string) =>
  postJson(request, "/api/notifications/on", subscription(device));

const turnOff = (request: Requester, device: string) =>
  postJson(request, "/api/notifications/off", { endpoint: subscription(device).endpoint });

/**
 * A worker with the fake provider and one that codes, and the owner logged in on it; `another`
 * logs another device in.
 */
const start = async (push: FakePush, coding: ReturnType<typeof codingProvider>["provider"]) => {
  const app = testWorker({ root, sendPush: push.send, providers: [createFakeProvider(), coding] });
  const request = requesterFor(app, await setUpOwner(app));
  const another = async () =>
    requesterFor(
      app,
      loginCookie(await postJson(app.request, "/api/login", { password: "test password" })),
    );
  return { request, another };
};

/** Starts a code session that asks to run a command off the allowlist, and waits for the ask. */
const untilApproval = async (request: Requester, text: string) => {
  const started = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: CODING_MODEL,
  });
  const { id } = (await started.json()) as { id: string };
  await followSession(request, { sessionId: id, until: "approval-requested" });
  return id;
};

/** The endpoints each notification went to. */
const sentTo = (push: FakePush) => push.sent.map(({ endpoint }) => endpoint);

describe("the worker's keys", () => {
  it("are made on first run and kept in the data folder, so a restart keeps them", async () => {
    const push = createFakePush();
    const first = testWorker({ root, sendPush: push.send });
    const cookie = await setUpOwner(first);
    const key = await publicKeyOf(requesterFor(first, cookie));
    const restarted = testWorker({ root, sendPush: push.send });
    const again = await publicKeyOf(requesterFor(restarted, cookie));

    // An uncompressed P-256 public key, as browsers take it: 65 bytes.
    expect(Buffer.from(key, "base64url")).toHaveLength(65);
    expect(again).toBe(key);
  });
});

describe("a session needing an approval", () => {
  it("sends one notification to a device that turned them on: the session's title, what it needs, and the session a tap opens", async () => {
    const push = createFakePush();
    const { request } = await start(push, codingProvider([{ run: "pnpm add left-pad" }]).provider);
    expect((await turnOn(request, "fold")).status).toBe(204);

    const id = await untilApproval(request, "Talk into the message box");

    await expect.poll(() => push.sent).toHaveLength(1);
    expect(push.sent).toEqual([
      {
        endpoint: "https://push.example/fold",
        // Nothing else: it shows on a locked screen.
        payload: {
          title: "Talk into the message box",
          body: "Needs your OK to run a command",
          session: id,
        },
      },
    ]);
  });

  it("says when it's a file it wants to change, and sends nothing more once the owner stops the turn", async () => {
    const push = createFakePush();
    const { request } = await start(push, codingProvider([{ edit: "../outside.txt" }]).provider);
    await turnOn(request, "fold");

    const id = await untilApproval(request, "Tidy the notes");
    await postJson(request, `/api/sessions/${id}/stop`, { turn: 1 });
    await followSession(request, { sessionId: id, until: "turn-stopped" });

    await expect.poll(() => push.sent).toHaveLength(1);
    expect(push.sent[0]?.payload).toMatchObject({ body: "Needs your OK to change a file" });
  });
});

describe("a turn ending", () => {
  it("sends one notification when it finishes, and one when it fails", async () => {
    const push = createFakePush();
    const { request } = await start(push, codingProvider([]).provider);
    await turnOn(request, "fold");

    // The fake leaves this one's title as its first line.
    const session = await startSession(request, "no title please");
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "please fail",
      model: { provider: "fake", model: "echo" },
    });
    await followSession(request, { sessionId: session.id, until: "turn-failed" });

    await expect.poll(() => push.sent).toHaveLength(2);
    expect(push.sent.map(({ payload }) => payload)).toEqual([
      { title: "no title please", body: "Turn finished", session: session.id },
      { title: "no title please", body: "Turn failed", session: session.id },
    ]);
  });
});

describe("turning notifications on and off per device", () => {
  it("sends only to the devices that turned them on and haven't turned them off", async () => {
    const push = createFakePush();
    const { request, another } = await start(
      push,
      codingProvider([{ run: "pnpm add left-pad" }]).provider,
    );
    const phone = await another();
    const desk = await another();
    await turnOn(request, "fold");
    await turnOn(phone, "phone");
    await turnOn(desk, "desk");
    expect((await turnOff(phone, "phone")).status).toBe(204);

    await untilApproval(request, "Talk into the message box");

    await expect.poll(() => push.sent).toHaveLength(2);
    expect(sentTo(push).toSorted()).toEqual([
      "https://push.example/desk",
      "https://push.example/fold",
    ]);
  });

  it("keeps one subscription per device: turning on again replaces its last", async () => {
    const push = createFakePush();
    const { request } = await start(push, codingProvider([{ run: "pnpm add left-pad" }]).provider);
    await turnOn(request, "fold-before");
    await turnOn(request, "fold");

    await untilApproval(request, "Talk into the message box");

    await expect.poll(() => push.sent).toHaveLength(1);
    expect(sentTo(push)).toEqual(["https://push.example/fold"]);
  });

  it("sends nothing to a device once it logs out", async () => {
    const push = createFakePush();
    const { request, another } = await start(
      push,
      codingProvider([{ run: "pnpm add left-pad" }]).provider,
    );
    const lost = await another();
    await turnOn(request, "fold");
    await turnOn(lost, "lost-phone");
    await postJson(request, "/api/logout-others", {});

    await untilApproval(request, "Talk into the message box");

    await expect.poll(() => push.sent).toHaveLength(1);
    expect(sentTo(push)).toEqual(["https://push.example/fold"]);
  });

  it("forgets a device whose subscription has gone, so it isn't tried again", async () => {
    const push = createFakePush();
    const { request, another } = await start(push, codingProvider([]).provider);
    await turnOn(request, "fold");
    push.unsubscribe("https://push.example/fold");

    const session = await startSession(request, "no title please");
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    await expect.poll(() => push.refused).toHaveLength(1);
    // Another device, so the next turn's notifications can be seen going out.
    await turnOn(await another(), "desk");
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "And again",
      model: { provider: "fake", model: "echo" },
    });
    await followSession(request, {
      sessionId: session.id,
      after: first.at(-1)?.seq ?? 0,
      until: "turn-completed",
    });
    await expect.poll(() => push.sent).toHaveLength(1);

    expect(sentTo(push)).toEqual(["https://push.example/desk"]);
    expect(push.refused).toEqual(["https://push.example/fold"]);
  });

  it("refuses a subscription that isn't a browser's push subscription", async () => {
    const push = createFakePush();
    const { request } = await start(push, codingProvider([]).provider);

    const plain = await postJson(request, "/api/notifications/on", {
      ...subscription("fold"),
      endpoint: "http://push.example/fold",
    });
    const keyless = await postJson(request, "/api/notifications/on", {
      endpoint: "https://push.example/fold",
    });

    expect([plain.status, keyless.status]).toEqual([400, 400]);
  });
});
