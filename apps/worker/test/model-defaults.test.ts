import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effort, ModelId, type ModelInfo, ProviderList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import type { Provider } from "../src/providers/index.ts";
import {
  asOwner,
  errorOf,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  sendJson,
  setUpOwner,
  startSession,
  testWorker,
} from "./testing.ts";

// A default model and effort for each provider (#247): one global default each, which a new
// session, a switch of provider and Carry on use.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await removeTestFolder(root);
});

const level = (id: string, label: string) => ({ id: Effort.parse(id), label });

const model = (id: string, name: string): ModelInfo => ({
  id: ModelId.parse(id),
  label: `Two · ${name}`,
  name,
  efforts: [level("low", "Low"), level("medium", "Medium"), level("high", "High")],
  defaultEffort: Effort.parse("low"),
});

/**
 * A provider of two models, as Codex is: Sol listed first at its own Low, and Astra, which it
 * starts on at High. `models` is what it offers now, so a test can take one away.
 */
const twoModels = () => {
  const offered = { models: [model("sol", "Sol"), model("astra", "Astra")] };
  const fake = createFakeProvider({ delayMs: 0, second: true });
  const provider: Provider = {
    ...fake,
    startingDefault: { model: ModelId.parse("astra"), effort: Effort.parse("high") },
    status: async () => {
      const status = await fake.status();
      return status.available ? { ...status, models: offered.models } : status;
    },
  };
  return { provider, offered };
};

const start = async (providers: readonly Provider[]) => asOwner(testWorker({ root, providers }));

const defaultsIn = async (request: Requester) => {
  const { providers } = ProviderList.parse(await (await request("/api/providers")).json());
  return Object.fromEntries(
    providers.map((provider) => [provider.id, provider.available ? provider.default : undefined]),
  );
};

describe("the provider list", () => {
  it("says each provider's default: the one it starts on, or else its first model at its own effort", async () => {
    const request = await start([createFakeProvider({ delayMs: 0 }), twoModels().provider]);

    expect(await defaultsIn(request)).toEqual({
      fake: { model: "echo" },
      "fake-two": { model: "astra", effort: "high" },
    });
  });

  it("says the default the owner made, which the worker keeps after a restart", async () => {
    const providers = () => [createFakeProvider({ delayMs: 0 }), twoModels().provider];
    const app = testWorker({ root, providers: providers() });
    const cookie = await setUpOwner(app);

    const saved = await sendJson(
      requesterFor(app, cookie),
      "/api/providers/fake-two/default",
      "PUT",
      { model: "sol", effort: "medium" },
    );

    expect(saved.status).toBe(200);
    const restarted = requesterFor(testWorker({ root, providers: providers() }), cookie);
    expect(await defaultsIn(restarted)).toEqual({
      fake: { model: "echo" },
      "fake-two": { model: "sol", effort: "medium" },
    });
  });

  it("falls back to the first model at its own effort when the default's model is gone", async () => {
    const two = twoModels();
    const request = await start([two.provider]);

    two.offered.models = [model("sol", "Sol"), model("nova", "Nova")];

    expect(await defaultsIn(request)).toEqual({ "fake-two": { model: "sol" } });
  });

  it("falls back to the first model not at its usage limit when the default's model is at one", async () => {
    const two = twoModels();
    const request = await start([two.provider]);

    two.offered.models = [
      model("sol", "Sol"),
      { ...model("astra", "Astra"), limit: {} },
      model("nova", "Nova"),
    ];

    expect(await defaultsIn(request)).toEqual({ "fake-two": { model: "sol" } });
  });
});

describe("a new session with no model named", () => {
  it("starts on the first provider's default, at its effort", async () => {
    const request = await start([twoModels().provider, createFakeProvider({ delayMs: 0 })]);

    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where should the rack go?",
    });

    const { id } = SessionSummary.parse(await response.json());
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(events.find((event) => event.type === "owner-message")).toMatchObject({
      model: { provider: "fake-two", model: "astra" },
      effort: "high",
    });
  });
});

describe("Carry on", () => {
  it("goes to the other provider's default, at its effort", async () => {
    const request = await start([createFakeProvider({ delayMs: 0 }), twoModels().provider]);
    const session = await startSession(request, "please hit Fake's limit");
    const failed = await followSession(request, { sessionId: session.id, until: "turn-failed" });
    const turn = failed.find((event) => event.type === "owner-message")?.seq ?? 0;

    const response = await postJson(request, `/api/sessions/${session.id}/carry-on`, { turn });

    expect(response.status).toBe(202);
    const carried = await followSession(request, {
      sessionId: session.id,
      after: failed.length,
      until: "turn-completed",
    });
    expect(carried.find((event) => event.type === "owner-message")).toMatchObject({
      model: { provider: "fake-two", model: "astra" },
      effort: "high",
    });
  });
});

describe("a provider whose every model is at its usage limit", () => {
  it("keeps its default, as there's none better to fall back to", async () => {
    const two = twoModels();
    const request = await start([two.provider]);

    two.offered.models = two.offered.models.map((each) => ({ ...each, limit: {} }));

    expect(await defaultsIn(request)).toEqual({ "fake-two": { model: "astra", effort: "high" } });
  });
});

describe("Make this the default", () => {
  it("is refused for a model the provider doesn't offer", async () => {
    const request = await start([twoModels().provider]);

    const response = await sendJson(request, "/api/providers/fake-two/default", "PUT", {
      model: "nova",
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Fake two doesn't offer that model/);
  });

  it("is refused for an effort the model doesn't take", async () => {
    const request = await start([twoModels().provider]);

    const response = await sendJson(request, "/api/providers/fake-two/default", "PUT", {
      model: "astra",
      effort: "xhigh",
    });

    expect(response.status).toBe(400);
  });
});
