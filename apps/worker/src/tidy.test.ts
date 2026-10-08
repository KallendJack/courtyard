import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelId,
  OwnerContextDetail,
  ProviderId,
  RecentChanges,
  type TidyChange,
  TidyProposal,
  WorkspaceDetail,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import { ok } from "./result.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  FAKE_MODEL,
  followSession,
  postJson,
  type Requester,
  startSession,
  testWorker,
} from "./testing.ts";

let root: string;
const contextDir = () => join(root, "context");
const contextFile = () => join(contextDir(), "garage-gym", "CONTEXT.md");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A messy file, marked for the fake: each marker says what it proposes for the line. */
const MESSY = [
  "# Garage gym",
  "",
  "## Facts",
  "",
  "- Double garage (merge)",
  "- The garage is 5.4 m by 5.1 m (merge)",
  "- Rubber flooring went down in Sep 2026",
  "",
  "## Plans",
  "",
  "- Gym on Monday and Thursday evenings, after work, usually around 7pm (long)",
  "- Get a quote for rubber flooring (stale)",
  "",
  "## Ideas",
  "",
  "- A rowing machine (adds)",
  "",
].join("\n");

const start = async (providers: Provider[] = [createFakeProvider({ delayMs: 0 })]) =>
  asOwner(testWorker({ root, providers }));

const propose = async (request: Requester, path = "/api/workspaces/garage-gym/tidy") => {
  const response = await postJson(request, path, { model: FAKE_MODEL });
  expect(response.status).toBe(200);
  return TidyProposal.parse(await response.json());
};

const save = (request: Requester, id: string, keep: number[]) =>
  postJson(request, `/api/tidies/${id}/save`, { keep });

const changeOf = (proposal: TidyProposal, kind: TidyChange["kind"]) => {
  const index = proposal.changes.findIndex((change) => change.kind === kind);
  expect(index).not.toBe(-1);
  return index;
};

/** The workspace's context file as the app reads it. */
const fileNow = async (request: Requester) => {
  const detail = WorkspaceDetail.parse(await (await request("/api/workspaces/garage-gym")).json());
  if (detail.contextFile === null) throw new Error("no context file");
  return detail.contextFile;
};

describe("proposing a tidy", () => {
  it("proposes the changes the model makes, each with the lines it takes out and puts in", async () => {
    await writeFile(contextFile(), MESSY);
    const request = await start();

    const proposal = await propose(request);

    expect(proposal.characters).toBe(MESSY.length);
    expect(proposal.changes).toContainEqual({
      kind: "merge",
      lines: [
        { place: "workspace", section: "facts", line: "Double garage (merge)" },
        { place: "workspace", section: "facts", line: "The garage is 5.4 m by 5.1 m (merge)" },
      ],
      text: "Double garage, The garage is 5.4 m by 5.1 m",
      shortensBy: expect.any(Number),
    });
    expect(proposal.changes).toContainEqual({
      kind: "remove",
      lines: [
        { place: "workspace", section: "plans", line: "Get a quote for rubber flooring (stale)" },
      ],
      why: "It's stale.",
      shortensBy: "- Get a quote for rubber flooring (stale)\n".length,
    });
    expect(proposal.changes.every((change) => change.shortensBy > 0)).toBe(true);
  });

  it("drops a change that adds something new", async () => {
    await writeFile(contextFile(), MESSY);
    const request = await start();

    const proposal = await propose(request);

    expect(proposal.changes.map((change) => change.kind).sort()).toEqual([
      "merge",
      "remove",
      "shorten",
    ]);
    expect(JSON.stringify(proposal)).not.toContain("sauna");
  });

  it("proposes nothing, without asking a model, for a file with no lines", async () => {
    const request = await start([scripted({ changes: [] }).provider]);

    const response = await postJson(request, "/api/workspaces/garage-gym/tidy", {
      model: SCRIPTED_MODEL,
    });

    expect(TidyProposal.parse(await response.json()).changes).toEqual([]);
  });

  it("tidies the owner context, by its own labels", async () => {
    const owner =
      "# About the owner\n\n## About me\n\n### Facts\n\n- Lives in Leeds\n- Moved here in 2019 (stale)\n\n## How to answer me\n\n- Short answers, with the reasons left out unless I ask for them (long)\n";
    await writeFile(join(contextDir(), "OWNER.md"), owner);
    const request = await start();

    const proposal = await propose(request, "/api/owner-context/tidy");
    expect(proposal.changes).toHaveLength(2);
    expect(await save(request, proposal.id, [0, 1])).toHaveProperty("status", 204);

    const { ownerContext } = OwnerContextDetail.parse(
      await (await request("/api/owner-context")).json(),
    );
    expect(ownerContext?.facts).toEqual(["Lives in Leeds"]);
    expect(ownerContext?.answers).toEqual([
      "Short answers, with the reasons left out unless I ask for them",
    ]);
  });
});

/** The model a scripted provider offers. */
const SCRIPTED_MODEL = { provider: "scripted", model: "one" };

/** A provider whose tidy is `answer`, and which keeps what each tidy was told. */
const scripted = (answer: unknown) => {
  const told: { instructions: string; message: string }[] = [];
  const id = ProviderId.parse("scripted");
  const capabilities = { readsFiles: false, codes: false, usesTools: false, savesContext: true };
  const provider: Provider = {
    ...createFakeProvider({ delayMs: 0 }),
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Scripted",
      available: true,
      models: [{ id: ModelId.parse("one"), label: "One", efforts: [] }],
      capabilities,
    }),
    answerOnce: async ({ instructions, message }) => {
      told.push({ instructions, message });
      return ok(answer);
    },
  };
  return { provider, told };
};

describe("checking what a model proposes", () => {
  const FILE = [
    "## Facts",
    "",
    "- Double garage",
    "- The garage is 5.4 m by 5.1 m",
    "- Lives in Leeds with a partner",
    "- Does drive, but rarely and only locally",
    "- Can eat dairy now, since the tests in May",
    "",
    "## Plans",
    "",
    "- Gym on Mondays and Thursdays",
    "",
  ].join("\n");

  const proposed = async (changes: unknown[]) => {
    await writeFile(contextFile(), FILE);
    const request = await start([scripted({ changes }).provider]);
    const response = await postJson(request, "/api/workspaces/garage-gym/tidy", {
      model: SCRIPTED_MODEL,
    });
    return TidyProposal.parse(await response.json()).changes;
  };

  it("keeps a merge whose words all come from its lines, a word's other form, and a removal with why", async () => {
    const changes = await proposed([
      { kind: "merge", labels: ["[F1]", "F2"], text: "Double garage, 5.4 m by 5.1 m" },
      { kind: "shorten", labels: ["P1"], text: "Gym on Monday and Thursday" },
      { kind: "remove", labels: ["f3"], why: "Moved." },
    ]);

    expect(changes.map((change) => change.kind)).toEqual(["merge", "shorten", "remove"]);
  });

  it.each([
    ["a label the file hasn't got", { kind: "remove", labels: ["F9"], why: "Gone." }],
    ["a removal without why", { kind: "remove", labels: ["F1"] }],
    ["a new place", { kind: "shorten", labels: ["F3"], text: "Lives in Inverness, alone" }],
    ["a meaning turned round", { kind: "shorten", labels: ["F4"], text: "Doesn't drive" }],
    ["can turned into can't", { kind: "shorten", labels: ["F5"], text: "Can't eat dairy" }],
    [
      "a merge no shorter than its lines",
      {
        kind: "merge",
        labels: ["F1", "F2"],
        text: "Double garage, the garage is 5.4 m by 5.1 m and the garage is 5.4 m by 5.1 m",
      },
    ],
    ["a merge across sections", { kind: "merge", labels: ["F1", "P1"], text: "Double garage" }],
    ["a merge of one line", { kind: "merge", labels: ["F1"], text: "Double garage" }],
    ["a shorten that's no shorter", { kind: "shorten", labels: ["F1"], text: "Double garage" }],
    ["a number changed", { kind: "shorten", labels: ["F2"], text: "The garage is 5.5 m by 5.1 m" }],
    ["a new word", { kind: "shorten", labels: ["P1"], text: "Gym on Fridays" }],
    ["a line too long", { kind: "merge", labels: ["F1", "F2"], text: "garage ".repeat(40) }],
    ["an answer of the wrong shape", { kind: "rewrite", labels: ["F1"] }],
  ])("drops %s", async (_, change) => {
    expect(await proposed([change])).toEqual([]);
  });

  it("drops a change to a line another change already takes", async () => {
    const changes = await proposed([
      { kind: "remove", labels: ["F1"], why: "Repeated." },
      { kind: "merge", labels: ["F1", "F2"], text: "Double garage, 5.4 m by 5.1 m" },
    ]);

    expect(changes.map((change) => change.kind)).toEqual(["remove"]);
  });

  it("with no model named, asks the first model that saves to context and isn't at its usage limit", async () => {
    const asked: string[] = [];
    const watched = (provider: Provider): Provider => ({
      ...provider,
      answerOnce: (input) => {
        asked.push(provider.id);
        return provider.answerOnce(input);
      },
    });
    const request = await start([
      watched(createFakeProvider({ delayMs: 0 })),
      watched(createFakeProvider({ delayMs: 0, second: true })),
    ]);
    const limited = await startSession(request, "please hit Fake's limit");
    await followSession(request, { sessionId: limited.id, until: "turn-failed" });
    await writeFile(contextFile(), MESSY);

    const response = await postJson(request, "/api/workspaces/garage-gym/tidy", {});

    expect(response.status).toBe(200);
    expect(asked).toEqual(["fake-two"]);
  });

  it("refuses a model that isn't available", async () => {
    await writeFile(contextFile(), FILE);
    const request = await start();

    const response = await postJson(request, "/api/workspaces/garage-gym/tidy", {
      model: { provider: "fake", model: "nope" },
    });

    expect(response.status).toBe(400);
  });
});

describe("saving a tidy", () => {
  it("saves only the ticked changes, as one change", async () => {
    await writeFile(contextFile(), MESSY);
    const request = await start();
    const proposal = await propose(request);
    const merge = changeOf(proposal, "merge");
    const remove = changeOf(proposal, "remove");

    expect(await save(request, proposal.id, [merge, remove])).toHaveProperty("status", 204);

    const file = await fileNow(request);
    expect(file.facts).toEqual([
      "Double garage, The garage is 5.4 m by 5.1 m",
      "Rubber flooring went down in Sep 2026",
    ]);
    // The unticked shorten stays as it was.
    expect(file.plans).toEqual([
      "Gym on Monday and Thursday evenings, after work, usually around 7pm (long)",
    ]);
    const [last] = await changesIn(contextDir());
    expect(last?.title).toBe("Tidy: 2 changes");
    expect(last?.trailers).toContain("Courtyard-Change: tidy");
    expect(last?.trailers).toContain("Courtyard-Place: workspace/garage-gym");
  });

  it("refuses when the file changed since the tidy was proposed, and saves nothing", async () => {
    await writeFile(contextFile(), MESSY);
    const request = await start();
    const proposal = await propose(request);
    const edited = `${MESSY}- A pull-up bar\n`;
    await writeFile(contextFile(), edited);

    const response = await save(request, proposal.id, [0, 1, 2]);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/changed since the tidy was proposed/);
    expect(await readFile(contextFile(), "utf8")).toBe(edited);
  });

  it("can't be saved twice, nor once another tidy of the file is saved", async () => {
    await writeFile(contextFile(), MESSY);
    const request = await start();
    const first = await propose(request);
    const second = await propose(request);

    expect(await save(request, second.id, [0])).toHaveProperty("status", 204);
    expect(await save(request, second.id, [0])).toHaveProperty("status", 404);
    expect(await save(request, first.id, [0])).toHaveProperty("status", 409);
  });
});

describe("a tidy in Recent changes", () => {
  it("is listed with Undo, which reverses the whole tidy", async () => {
    await writeFile(contextFile(), MESSY);
    const request = await start();
    const before = await fileNow(request);
    const proposal = await propose(request);
    await save(request, proposal.id, [0, 1, 2]);

    const listed = RecentChanges.parse(
      await (await request("/api/workspaces/garage-gym/changes")).json(),
    );
    const [tidy] = listed.changes;
    expect(tidy).toMatchObject({ kind: "tidy", undo: "available" });
    expect(tidy?.removed).toHaveLength(4);
    expect(tidy?.added).toHaveLength(2);

    const undone = await postJson(request, `/api/changes/${tidy?.id}/undo`, {});
    expect(undone.status).toBe(204);

    const after = await fileNow(request);
    expect(after.facts.toSorted()).toEqual(before.facts.toSorted());
    expect(after.plans.toSorted()).toEqual(before.plans.toSorted());
    expect(after.ideas).toEqual(before.ideas);
  });
});
