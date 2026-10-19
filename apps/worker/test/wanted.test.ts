import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockedShops, ModelId, WantedList } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Framing, type Provider } from "../src/providers/index.ts";
import {
  asOwner,
  changesIn,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  savingProvider,
  testWorker,
} from "./testing.ts";

// The wanted list (#245): the Things wanted or to replace, each with up to three picks chosen for
// value, their prices checked on the web by a short background turn.

let root: string;
let contextDir: string;
const thingsDir = () => join(contextDir, "mountain-biking", "things");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(thingsDir(), { recursive: true });
  await writeFile(
    join(contextDir, "mountain-biking", "CONTEXT.md"),
    "# Mountain biking\n\n## Facts\n\n- Rides on Sundays.\n",
  );
  await writeFile(join(thingsDir(), "lights.md"), "---\nname: Lights\nstatus: want\n---\n");
  await writeFile(join(thingsDir(), "chain.md"), "---\nname: Chain\nstatus: replace\n---\n");
  await writeFile(join(thingsDir(), "helmet.md"), "---\nname: Helmet\nstatus: have\n---\n");
});

afterEach(async () => {
  await removeTestFolder(root);
});

const owner = () => asOwner(testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }));

const wanted = async (request: Requester) =>
  WantedList.parse(await (await request("/api/workspaces/mountain-biking/wanted")).json());

describe("the wanted list", () => {
  it("lists the Things wanted or to replace, in list order, none with picks yet", async () => {
    const request = await owner();

    expect(await wanted(request)).toEqual({
      rows: [
        { thing: "chain", name: "Chain", status: "replace", picks: [], finding: false },
        { thing: "lights", name: "Lights", status: "want", picks: [], finding: false },
      ],
      checking: false,
    });
  });
});

/** The time the tests' worker reads, which a test can move on. */
let clock = Date.parse("2026-10-19T09:00:00.000Z");

/** A fake whose turns wait until the test lets them go, telling the test what each was told. */
const heldFake = () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const framings: Framing[] = [];
  const heard: { model: string; effort: string | undefined }[] = [];
  const provider = createFakeProvider({
    delayMs: 0,
    beforeReply: () => gate,
    framed: (framing) => framings.push(framing),
    heard: (turn) => heard.push(turn),
  });
  return { provider, release, framings, heard };
};

const withFake = (provider: Provider) =>
  asOwner(testWorker({ root, providers: [provider], now: () => clock }));

const findPicks = (request: Requester, slug: string) =>
  postJson(request, `/api/workspaces/mountain-biking/wanted/${slug}/find`, {});

const rowOf = async (request: Requester, slug: string) =>
  (await wanted(request)).rows.find((row) => row.thing === slug);

describe("Find picks", () => {
  it("finds a Thing's picks in a short turn on its provider's cheap model, with web search", async () => {
    const fake = heldFake();
    const request = await withFake(fake.provider);

    expect((await findPicks(request, "lights")).status).toBe(202);
    await expect.poll(() => fake.framings.length).toBe(1);
    expect(await rowOf(request, "lights")).toMatchObject({ picks: [], finding: true });
    const [framing] = fake.framings;
    expect(fake.heard).toEqual([{ model: "echo", effort: "low" }]);
    expect(framing?.webSearch).toEqual({ ownerLinks: [] });
    expect(framing?.tools.map((tool) => tool.name)).toEqual(["save_picks"]);
    expect(framing?.newMessage).toContain("[W1] Lights, to get");
    fake.release();

    await expect.poll(async () => (await rowOf(request, "lights"))?.finding).toBe(false);
    const at = new Date(clock).toISOString();
    expect((await rowOf(request, "lights"))?.picks).toEqual([
      {
        kind: "best-value",
        product: "Lights, best value",
        why: "Does the job well for the money",
        pence: 5500,
        usualPence: 7200,
        shop: "Tredz",
        url: "https://tredz.example/lights",
        checkedAt: at,
      },
      {
        kind: "cheapest",
        product: "Lights, cheapest",
        why: "Does the job, no more",
        pence: 3800,
        shop: "Halfords",
        url: "https://halfords.example/lights",
        checkedAt: at,
      },
      {
        kind: "stretch",
        product: "Lights, worth stretching for",
        why: "Lasts twice as long",
        pence: 15_000,
        shop: "Wiggle",
        url: "https://wiggle.example/lights",
        checkedAt: at,
      },
    ]);
  });

  it("refuses picks that don't fit, saying why, and keeps those that do", async () => {
    await writeFile(
      join(contextDir, "mountain-biking", "workspace.json"),
      JSON.stringify({
        blockedShops: [{ shop: "Tredz", since: "2026-10-13T09:00:00.000Z", said: "not from Tredz" }],
      }),
    );
    const pick = (fields: Record<string, unknown>) => ({
      kind: "best-value",
      product: "Magicshine Allty 1000",
      why: "Bright enough for trails",
      price: 55,
      shop: "Halfords",
      url: "https://halfords.example/allty",
      ...fields,
    });
    const savePicks = (thing: string, picks: unknown[]) => ({
      call: "save_picks",
      input: { thing, picks },
    });
    const saver = savingProvider([
      [
        savePicks("W9", [pick({})]),
        savePicks("W1", [pick({ shop: "tredz" })]),
        savePicks("W1", [pick({ kind: "cheapest" })]),
        savePicks("W1", [pick({ url: "http://halfords.example/allty" })]),
        savePicks("W1", [pick({ usual_price: 50 })]),
        savePicks("W1", [pick({}), pick({ product: "Another" })]),
        savePicks("[W1]", [pick({ size: "1000 lumens", usual_price: 72.5 })]),
      ],
    ]);
    const provider = {
      ...saver.provider,
      errand: { model: ModelId.parse("one") },
      capabilities: { ...saver.provider.capabilities, searchesWeb: true },
    };
    const request = await withFake(provider);

    expect((await findPicks(request, "lights")).status).toBe(202);
    await expect.poll(async () => (await rowOf(request, "lights"))?.finding).toBe(false);

    expect(saver.replies[0]).toEqual([
      {
        ok: false,
        reply:
          "There's no Thing labelled W9 on this list: the Things are in your message.\n\nPut it right and send this Thing's picks again.",
      },
      {
        ok: false,
        reply:
          "The owner blocked Tredz: pick from another shop.\n\nPut it right and send this Thing's picks again.",
      },
      {
        ok: false,
        reply:
          "A Thing's picks always have a best-value one: the one you'd buy.\n\nPut it right and send this Thing's picks again.",
      },
      {
        ok: false,
        reply:
          "That best-value pick's page, an address starting https://, doesn't fit.\n\nPut it right and send this Thing's picks again.",
      },
      {
        ok: false,
        reply:
          "Give a usual price only for a sale, when it's more than the price today.\n\nPut it right and send this Thing's picks again.",
      },
      {
        ok: false,
        reply:
          "That input doesn't fit this tool: it takes a Thing's label and up to three picks, one of each kind.\n\nPut it right and send this Thing's picks again.",
      },
      { ok: true, reply: "Saved 1 pick for [W1] Lights." },
    ]);
    expect(saver.framings[0]?.newMessage).toContain(
      "Leave out these shops, which the owner blocked: Tredz.",
    );
    expect((await rowOf(request, "lights"))?.picks).toEqual([
      {
        kind: "best-value",
        product: "Magicshine Allty 1000",
        why: "Bright enough for trails",
        pence: 5500,
        usualPence: 7250,
        shop: "Halfords",
        url: "https://halfords.example/allty",
        size: "1000 lumens",
        checkedAt: new Date(clock).toISOString(),
      },
    ]);
  });

  it("is refused for a Thing that isn't wanted, or isn't there", async () => {
    const request = await owner();

    expect((await findPicks(request, "helmet")).status).toBe(404);
    expect((await findPicks(request, "pump")).status).toBe(404);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lights' picks, their prices checked `daysAgo` days before the clock. */
const keepPicks = async (daysAgo: number) => {
  await mkdir(join(root, "data", "wanted"), { recursive: true });
  const checkedAt = new Date(clock - daysAgo * DAY_MS).toISOString();
  await writeFile(
    join(root, "data", "wanted", "mountain-biking.json"),
    JSON.stringify({
      picks: {
        lights: [
          {
            kind: "best-value",
            product: "Magicshine Allty 1000",
            why: "Bright enough for trails",
            pence: 5500,
            shop: "Tredz",
            url: "https://tredz.example/allty",
            checkedAt,
          },
        ],
      },
    }),
  );
};

const blockedShops = async (request: Requester) =>
  BlockedShops.parse(
    await (await request("/api/workspaces/mountain-biking/blocked-shops")).json(),
  );

describe("blocked shops", () => {
  it("are blocked by a model when the owner says not to use one, and its picks found again elsewhere", async () => {
    await keepPicks(1);
    const saver = savingProvider([
      [
        { call: "block_shop", input: { shop: "Tredz", said: "not from Tredz" } },
        { call: "block_shop", input: { shop: "tredz" } },
      ],
    ]);
    // The fake, second, runs the price check: the saver has no errand model.
    const fake = heldFake();
    const both = await asOwner(
      testWorker({ root, providers: [saver.provider, fake.provider], now: () => clock }),
    );

    const started = await postJson(both, "/api/workspaces/mountain-biking/sessions", {
      text: "Not from Tredz",
      model: SAVING_MODEL,
    });
    const { id } = (await started.json()) as { id: string };
    await followSession(both, { sessionId: id, until: "turn-completed" });

    expect(saver.replies[0]).toEqual([
      { ok: true, reply: "Blocked Tredz: picks and price checks leave it out from now on." },
      { ok: true, reply: "Tredz is blocked already." },
    ]);
    expect(await blockedShops(both)).toEqual({
      shops: [{ shop: "Tredz", since: new Date(clock).toISOString(), said: "not from Tredz" }],
    });
    expect((await changesIn(contextDir))[0]?.title).toBe("Block shop: Tredz");
    expect(await rowOf(both, "lights")).toMatchObject({ finding: true });
    expect(fake.framings[0]?.newMessage).toContain(
      "Leave out these shops, which the owner blocked: Tredz.",
    );
    fake.release();
    await expect.poll(async () => (await rowOf(both, "lights"))?.finding).toBe(false);
    expect((await rowOf(both, "lights"))?.picks[0]).toMatchObject({
      kind: "best-value",
      shop: "Halfords",
    });
  });

  it("are unblocked by the owner, as a change with Undo", async () => {
    await writeFile(
      join(contextDir, "mountain-biking", "workspace.json"),
      JSON.stringify({
        blockedShops: [
          { shop: "Tredz", since: "2026-10-13T09:00:00.000Z", said: "not from Tredz" },
          { shop: "Chain Reaction Cycles", since: "2026-10-02T09:00:00.000Z" },
        ],
      }),
    );
    const request = await owner();

    const unblocked = await postJson(
      request,
      "/api/workspaces/mountain-biking/blocked-shops/unblock",
      { shop: "Tredz" },
    );

    expect(unblocked.status).toBe(200);
    expect(BlockedShops.parse(await unblocked.json())).toEqual({
      shops: [{ shop: "Chain Reaction Cycles", since: "2026-10-02T09:00:00.000Z" }],
    });
    expect(await blockedShops(request)).toEqual({
      shops: [{ shop: "Chain Reaction Cycles", since: "2026-10-02T09:00:00.000Z" }],
    });
    expect((await changesIn(contextDir))[0]?.title).toBe("Unblock shop: Tredz");
  });
});

describe("opening the wanted list", () => {
  it("checks prices over a week old again, quietly, showing it's checking meanwhile", async () => {
    await keepPicks(8);
    const fake = heldFake();
    const request = await withFake(fake.provider);

    expect((await wanted(request)).checking).toBe(true);
    expect(fake.framings[0]?.newMessage).toContain(
      "[W1] Lights, to get, picks now: best-value Magicshine Allty 1000 £55 at Tredz (https://tredz.example/allty)",
    );
    expect(fake.framings[0]?.newMessage).not.toContain("Chain");
    fake.release();

    await expect.poll(async () => (await wanted(request)).checking).toBe(false);
    expect((await rowOf(request, "lights"))?.picks[0]?.checkedAt).toBe(
      new Date(clock).toISOString(),
    );
  });

  it("leaves prices checked in the past week as they are", async () => {
    await keepPicks(6);
    const fake = heldFake();
    const request = await withFake(fake.provider);

    expect((await wanted(request)).checking).toBe(false);
    expect(fake.framings).toEqual([]);
  });

  it("checks at most once a day, however often it's opened", async () => {
    await keepPicks(8);
    // A check that saves nothing leaves the prices as old as they were.
    const saver = savingProvider([[], []]);
    const provider = {
      ...saver.provider,
      errand: { model: ModelId.parse("one") },
      capabilities: { ...saver.provider.capabilities, searchesWeb: true },
    };
    const request = await withFake(provider);

    await wanted(request);
    await expect.poll(async () => (await wanted(request)).checking).toBe(false);
    await wanted(request);
    expect(saver.framings).toHaveLength(1);

    clock += DAY_MS;
    await wanted(request);
    await expect.poll(() => saver.framings.length).toBe(2);
  });
});
