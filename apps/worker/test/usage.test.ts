import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageList } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import type { Provider, UsageReading } from "../src/providers/index.ts";
import {
  asOwner,
  createFakePush,
  FAKE_MODEL,
  FAKE_TWO_MODEL,
  type FakePush,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  signedOutProvider,
  startSession,
  testWorker,
} from "./testing.ts";

// Usage at a glance (#66): each provider's plan meters, read by the worker and shown as it last
// read them, and the warning before a limit, decided once by the worker.

let root: string;
let clock: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  clock = Date.parse("2026-10-08T12:00:00.000Z");
});

afterEach(async () => {
  await removeTestFolder(root);
});

const now = () => clock;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (ms: number) => new Date(ms).toISOString();

/** The fake's plan as it starts: a quiet 5-hour window and week. */
const quiet = (): UsageReading => ({
  kind: "plan",
  meters: [
    { window: "five-hour", used: 12, resetAt: at(clock + 3 * HOUR) },
    { window: "weekly", used: 31, resetAt: at(clock + 72 * HOUR) },
  ],
  models: [],
});

/** A provider whose usage readings are counted. */
const counted = (provider: Provider) => {
  let reads = 0;
  return {
    provider: {
      ...provider,
      readUsage: async () => {
        reads += 1;
        return provider.readUsage?.();
      },
    } satisfies Provider,
    reads: () => reads,
  };
};

const start = async (
  providers: readonly Provider[] = [
    createFakeProvider({ delayMs: 0, now, usage: quiet() }),
    createFakeProvider({ delayMs: 0, now, second: true }),
  ],
  push: FakePush = createFakePush(),
) => {
  const jobs: (() => Promise<void>)[] = [];
  const app = testWorker({
    root,
    providers,
    now,
    sendPush: push.send,
    repeat: (_everyMs, job) => {
      jobs.push(job);
    },
  });
  const request = requesterFor(app, await setUpOwner(app));
  // What the worker does as it starts, reading each provider's usage among it.
  for (const job of jobs) await job();
  return request;
};

const usageOf = async (request: Requester, read = false) => {
  const response = await request(`/api/usage${read ? "?read=1" : ""}`);
  expect(response.status).toBe(200);
  return UsageList.parse(await response.json());
};

/** Sends a message on the fake, and waits for its turn to complete. */
const turn = async (request: Requester, text: string) => {
  const session = await startSession(request, text, FAKE_MODEL);
  await followSession(request, { sessionId: session.id, until: "turn-completed" });
  return session.id;
};

describe("each provider's plan meters", () => {
  it("are read as the worker starts: the 5-hour and weekly windows, or no plan limits for a sign-in without them", async () => {
    const request = await start();

    await expect
      .poll(async () => (await usageOf(request)).providers)
      .toEqual([
        {
          provider: "fake",
          label: "Fake",
          usage: {
            kind: "plan",
            meters: [
              { window: "five-hour", used: 12, resetAt: at(clock + 3 * HOUR) },
              { window: "weekly", used: 31, resetAt: at(clock + 72 * HOUR) },
            ],
            models: [],
            readAt: at(clock),
          },
        },
        { provider: "fake-two", label: "Fake two", usage: { kind: "no-plan" } },
      ]);
    expect((await usageOf(request)).warnings).toEqual([]);
  });

  it("show a provider that isn't signed in as having no plan limits", async () => {
    const request = await start([signedOutProvider()]);

    expect((await usageOf(request, true)).providers).toEqual([
      { provider: "away", label: "Away", usage: { kind: "no-plan" } },
    ]);
  });

  it("are read after every turn ends, and when asked, at most once a minute per provider", async () => {
    const fake = counted(createFakeProvider({ delayMs: 0, now, usage: quiet() }));
    const request = await start([fake.provider]);
    await expect.poll(fake.reads).toBe(1);

    await usageOf(request, true);
    await turn(request, "Where should the rack go?");
    expect(fake.reads()).toBe(1);

    clock += MINUTE;
    await turn(request, "And the bench?");
    await expect.poll(fake.reads).toBe(2);
    await usageOf(request, true);
    // Asking for the meters without reading them reads nothing.
    clock += MINUTE;
    await usageOf(request);
    expect(fake.reads()).toBe(2);
    await usageOf(request, true);
    expect(fake.reads()).toBe(3);
  });

  it("keep what a turn heard when a reading fails, and show a window never heard as not known yet", async () => {
    const fake = createFakeProvider({ delayMs: 0, now, usage: "unreadable" });
    const request = await start([fake]);

    await turn(request, "use 45% of Fake's week");

    expect((await usageOf(request)).providers[0]?.usage).toEqual({
      kind: "plan",
      meters: [
        { window: "five-hour", used: null },
        { window: "weekly", used: 45 },
      ],
      models: [],
      readAt: at(clock),
    });
  });
});

describe("the warning before a limit", () => {
  it("is the provider's fullest window from 80%, with Switch to the other provider's default model", async () => {
    const request = await start();

    await turn(request, "use 82% of Fake's week");

    expect((await usageOf(request)).warnings).toEqual([
      {
        provider: "fake",
        label: "Fake",
        window: "weekly",
        used: 82,
        resetAt: at(clock + 72 * HOUR),
        switchTo: { label: "Fake two", model: FAKE_TWO_MODEL },
      },
    ]);
  });

  it("says the other provider's own window when it's past 80% too, and has no Switch once it's at its limit", async () => {
    const both = (weekly: number): UsageReading => ({
      kind: "plan",
      meters: [{ window: "weekly", used: weekly, resetAt: at(clock + 72 * HOUR) }],
      models: [],
    });
    const request = await start([
      createFakeProvider({ delayMs: 0, now, usage: both(90) }),
      createFakeProvider({ delayMs: 0, now, second: true, usage: both(84) }),
    ]);

    await expect
      .poll(async () => (await usageOf(request)).warnings.map((warning) => warning.switchTo))
      .toEqual([
        { label: "Fake two", model: FAKE_TWO_MODEL, fullest: { window: "weekly", used: 84 } },
        { label: "Fake", model: FAKE_MODEL, fullest: { window: "weekly", used: 90 } },
      ]);

    await turn(request, "use 100% of Fake's week");
    const { warnings } = await usageOf(request);
    // Fake two has nowhere left to switch to.
    expect(warnings.map(({ provider, used, switchTo }) => ({ provider, used, switchTo }))).toEqual([
      {
        provider: "fake",
        used: 100,
        switchTo: {
          label: "Fake two",
          model: FAKE_TWO_MODEL,
          fullest: { window: "weekly", used: 84 },
        },
      },
      { provider: "fake-two", used: 84, switchTo: undefined },
    ]);
  });

  it("isn't there once both providers are at their limit: the limit card says so after the turn", async () => {
    const full: UsageReading = {
      kind: "plan",
      meters: [{ window: "weekly", used: 100 }],
      models: [],
    };
    const request = await start([
      createFakeProvider({ delayMs: 0, now, usage: full }),
      createFakeProvider({ delayMs: 0, now, second: true, usage: full }),
    ]);

    await expect
      .poll(async () => (await usageOf(request)).providers.map((each) => each.usage.kind))
      .toEqual(["plan", "plan"]);
    expect((await usageOf(request)).warnings).toEqual([]);
  });

  it("has no Switch when no other provider is connected", async () => {
    const request = await start([
      createFakeProvider({ delayMs: 0, now, usage: quiet() }),
      signedOutProvider(),
    ]);

    await turn(request, "use 88% of Fake's 5-hour");

    expect((await usageOf(request)).warnings).toEqual([
      {
        provider: "fake",
        label: "Fake",
        window: "five-hour",
        used: 88,
        resetAt: at(clock + 3 * HOUR),
      },
    ]);
  });

  it("is put off by Not now until its window resets, or comes back once past 95%", async () => {
    const request = await start();
    await turn(request, "use 82% of Fake's week");

    const notNow = await postJson(request, "/api/usage/not-now", { provider: "fake" });

    expect(notNow.status).toBe(200);
    expect(UsageList.parse(await notNow.json()).warnings).toEqual([]);
    await turn(request, "use 90% of Fake's week");
    expect((await usageOf(request)).warnings).toEqual([]);

    await turn(request, "use 96% of Fake's week");
    expect((await usageOf(request)).warnings.map((warning) => warning.used)).toEqual([96]);

    // Back once: Not now again keeps it away until the window resets.
    await postJson(request, "/api/usage/not-now", { provider: "fake" });
    await turn(request, "use 97% of Fake's week");
    expect((await usageOf(request)).warnings).toEqual([]);
  });

  it("comes back after Not now once the window has reset and filled again", async () => {
    const request = await start();
    await turn(request, "use 82% of Fake's week");
    await postJson(request, "/api/usage/not-now", { provider: "fake" });

    clock += 73 * HOUR;
    await turn(request, "use 81% of Fake's week");

    expect((await usageOf(request)).warnings.map((warning) => warning.used)).toEqual([81]);
  });

  it("is put off across a restart of the worker", async () => {
    const providers = () => [
      createFakeProvider({ delayMs: 0, now, usage: quiet() }),
      createFakeProvider({ delayMs: 0, now, second: true }),
    ];
    const app = testWorker({ root, providers: providers(), now });
    const cookie = await setUpOwner(app);
    const request = requesterFor(app, cookie);
    await turn(request, "use 82% of Fake's week");
    await postJson(request, "/api/usage/not-now", { provider: "fake" });

    const restarted = requesterFor(testWorker({ root, providers: providers(), now }), cookie);
    await turn(restarted, "use 83% of Fake's week");

    expect((await usageOf(restarted)).warnings).toEqual([]);
  });

  it("is refused for a provider Courtyard doesn't know", async () => {
    const request = await asOwner(testWorker({ root, providers: [createFakeProvider()], now }));

    const response = await postJson(request, "/api/usage/not-now", { provider: "nobody" });

    expect(response.status).toBe(404);
  });
});

describe("the warning's notification", () => {
  const turnOn = (request: Requester) =>
    postJson(request, "/api/notifications/on", {
      endpoint: "https://push.example/fold",
      keys: { p256dh: "p256dh-of-fold", auth: "auth-of-fold" },
      expirationTime: null,
    });
  const usagePushes = (push: FakePush) =>
    push.sent.flatMap(({ payload }) =>
      typeof payload === "object" &&
      payload !== null &&
      "body" in payload &&
      typeof payload.body === "string" &&
      payload.body.includes("% of")
        ? [payload]
        : [],
    );

  it("is sent once when a running turn crosses 80%, opening that session", async () => {
    const push = createFakePush();
    const request = await start(undefined, push);
    await turnOn(request);

    const id = await turn(request, "use 82% of Fake's week");
    await turn(request, "use 85% of Fake's week");

    await expect
      .poll(() => usagePushes(push))
      .toEqual([{ title: expect.any(String), body: "Fake: 82% of this week used", session: id }]);
  });

  it("isn't sent for a window already past 80% when the worker read it, with no turn running", async () => {
    const push = createFakePush();
    const request = await start(
      [
        createFakeProvider({
          delayMs: 0,
          now,
          usage: { kind: "plan", meters: [{ window: "weekly", used: 86 }], models: [] },
        }),
      ],
      push,
    );
    await turnOn(request);
    await expect.poll(async () => (await usageOf(request)).warnings).toHaveLength(1);

    await turn(request, "use 87% of Fake's week");

    expect(usagePushes(push)).toEqual([]);
  });
});
