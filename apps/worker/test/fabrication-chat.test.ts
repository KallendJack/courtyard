import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BuildChat,
  BuildChatSent,
  BuildOpened,
  ProviderList,
  SessionList,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  asOwner,
  errorOf,
  FAKE_MODEL,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  savingProvider,
  testWorker,
} from "./testing.ts";

// What the Fabrication app's Build page reads from Fabrication's API (#698, ADR 0037): the Build
// where it is, for the way back to its project, and its chat, which Courtyard backs with the
// project's sessions. The Build's own numbers are in fabrication.test.ts.

let root: string;
let contextDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "garage", "builds"), { recursive: true });
  await writeFile(join(contextDir, "garage", "CONTEXT.md"), "# Garage\n");
  await writeFile(
    join(contextDir, "garage", "builds", "workbench.json"),
    JSON.stringify({ name: "Workbench", template: "framed-bench", parameters: goldenBench }),
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** The garage's project, whose second step makes the workbench. */
const withProject = async () => {
  await mkdir(join(contextDir, "garage", "projects"), { recursive: true });
  await writeFile(
    join(contextDir, "garage", "projects", "split-the-garage.md"),
    [
      "---",
      "name: Split the garage",
      "status: active",
      "---",
      "",
      "## Steps",
      "",
      "- [you can do this] Measure the back wall",
      "- [you can do this] Build the workbench · a weekend [build: workbench]",
      "",
    ].join("\n"),
  );
};

/** A worker whose one model is the fake, which answers "You said: …". */
const fakeWorker = () => testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] });

const CHAT = "/api/fabrication/workspaces/garage/builds/workbench/chat";

const chatOf = async (request: Requester) => BuildChat.parse(await (await request(CHAT)).json());

/** Says something in the Build's chat, and waits for the answer. */
const say = async (request: Requester, text: string, model = FAKE_MODEL) => {
  const sent = await postJson(request, CHAT, { text, model });
  expect(sent.status).toBe(202);
  const { session } = BuildChatSent.parse(await sent.json());
  let asked = false;
  await followSession(request, {
    sessionId: session,
    until: (event) => {
      if (event.type === "owner-message" && event.text === text) asked = true;
      return asked && event.type === "turn-completed";
    },
  });
  return session;
};

describe("a Build opened in Fabrication", () => {
  it("says where it is: its workspace, and the project whose step makes it", async () => {
    await withProject();
    const request = await asOwner(fakeWorker());

    const opened = BuildOpened.parse(
      await (await request("/api/fabrication/workspaces/garage/builds/workbench")).json(),
    );

    expect(opened.place).toEqual({
      workspace: { id: "garage", name: "Garage" },
      project: { slug: "split-the-garage", name: "Split the garage" },
    });
    expect(opened.derived.parts.find((part) => part.label === "B")?.does).toMatch(
      /^Front and back/,
    );
  });

  it("has no project when no step makes it", async () => {
    const request = await asOwner(fakeWorker());

    const opened = BuildOpened.parse(
      await (await request("/api/fabrication/workspaces/garage/builds/workbench")).json(),
    );

    expect(opened.place.project).toBeNull();
  });

  it("offers the models the chat can send to", async () => {
    const request = await asOwner(fakeWorker());

    const models = ProviderList.parse(await (await request("/api/fabrication/models")).json());

    expect(models.providers.map(({ id }) => id)).toContain("fake");
  });
});

describe("a Build's chat", () => {
  it("is empty until the owner says something", async () => {
    await withProject();
    const request = await asOwner(fakeWorker());

    expect(await chatOf(request)).toEqual({ session: null, answering: false, entries: [] });
  });

  it("starts a session that belongs to the Build's project, and carries on in it", async () => {
    await withProject();
    const request = await asOwner(fakeWorker());

    const session = await say(request, "Do the washers come with them?");
    const again = await say(request, "And the nuts?");

    expect(again).toBe(session);
    const listed = SessionList.parse(
      await (await request("/api/workspaces/garage/sessions")).json(),
    );
    expect(listed.sessions.map(({ id, project }) => ({ id, project }))).toEqual([
      { id: session, project: "split-the-garage" },
    ]);
    const chat = await chatOf(request);
    expect(chat).toMatchObject({ session, answering: false, model: FAKE_MODEL });
    expect(chat.entries.map(({ from, ...rest }) => [from, "text" in rest ? rest.text : ""])).toEqual(
      [
        ["owner", "Do the washers come with them?"],
        ["model", "You said: Do the washers come with them?"],
        ["owner", "And the nuts?"],
        ["model", "You said: And the nuts?"],
      ],
    );
  });

  it("is the project's latest session, one started from the project in Courtyard too", async () => {
    await withProject();
    const request = await asOwner(fakeWorker());
    const started = await postJson(request, "/api/workspaces/garage/sessions", {
      text: "Carry on with the garage.",
      model: FAKE_MODEL,
      project: "split-the-garage",
    });
    const carried = SessionSummary.parse(await started.json());
    await followSession(request, { sessionId: carried.id, until: "turn-completed" });

    expect((await chatOf(request)).session).toBe(carried.id);
  });

  it("with no project, is the session that saved the Build, its saves shown as changes", async () => {
    await rm(join(contextDir, "garage", "builds", "workbench.json"));
    const saver = savingProvider([
      [
        {
          call: "save_build",
          input: { name: "Workbench", template: "framed-bench", parameters: goldenBench },
        },
      ],
      [{ call: "save_build", input: { build: "B1", parameters: { height: { value: 850 } } } }],
    ]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
    const started = await postJson(request, "/api/workspaces/garage/sessions", {
      text: "A bench for the garage.",
      model: SAVING_MODEL,
    });
    const { id } = SessionSummary.parse(await started.json());
    await followSession(request, { sessionId: id, until: "turn-completed" });
    await say(request, "Make it 850 high.", SAVING_MODEL);

    const chat = await chatOf(request);
    expect(chat.session).toBe(id);
    expect(chat.entries.filter(({ from }) => from !== "model")).toEqual([
      { seq: expect.any(Number), from: "owner", text: "A bench for the garage." },
      { seq: expect.any(Number), from: "build", did: "started", changed: [], undone: false },
      { seq: expect.any(Number), from: "owner", text: "Make it 850 high." },
      { seq: expect.any(Number), from: "build", did: "changed", changed: ["height"], undone: false },
    ]);
  });

  it("refuses a message to a Build that isn't there", async () => {
    const request = await asOwner(fakeWorker());

    const sent = await postJson(request, "/api/fabrication/workspaces/garage/builds/shelves/chat", {
      text: "Hello",
      model: FAKE_MODEL,
    });

    expect(sent.status).toBe(404);
    expect(await errorOf(sent)).toBe("No such Build.");
  });
});
