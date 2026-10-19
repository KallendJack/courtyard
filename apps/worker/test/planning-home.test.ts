import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanningHome, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  errorOf,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  savingProvider,
  sendJson,
  testWorker,
} from "./testing.ts";

// A planning workspace's Home (#208): the view it shows, kept by the worker from the workspace's
// Things, with the owner's last question above it and the next steps under it.

let root: string;
let contextDir: string;
const thingsDir = () => join(contextDir, "mountain-biking", "things");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "mountain-biking"), { recursive: true });
  await writeFile(
    join(contextDir, "mountain-biking", "CONTEXT.md"),
    "# Mountain biking\n\n## Facts\n\n- Rides on Sundays.\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A Thing's file, last changed `minutesAgo` before 1 October 2026, so views are told apart by when. */
const thing = async (slug: string, text: string, minutesAgo: number) => {
  await mkdir(thingsDir(), { recursive: true });
  const path = join(thingsDir(), `${slug}.md`);
  await writeFile(path, text);
  const when = new Date(Date.UTC(2026, 9, 1) - minutesAgo * 60_000);
  await utimes(path, when, when);
};

/** The bike with its photo and three parts, and lights wanted for the garage. */
const withKit = async () => {
  await thing(
    "whyte-t-140",
    "---\nname: Whyte T-140\nstatus: have\nbrand: Whyte\nphoto: photos/whyte-t-140.jpg\n---\n",
    30,
  );
  await thing(
    "chain",
    "---\nname: Chain\nstatus: replace\nbrand: KMC X11\npart of: whyte-t-140\nneeds: It's stretched\npin: 48, 55\n---\n",
    20,
  );
  await thing(
    "fork",
    "---\nname: Fork\nstatus: have\nsize: 120 mm\npart of: whyte-t-140\npin: 20, 40\n---\n",
    25,
  );
  await thing(
    "rear-tyre",
    "---\nname: Rear tyre\nstatus: have\npart of: whyte-t-140\nneeds: Pump it up before Saturday\n---\n",
    25,
  );
  await thing("lights", "---\nname: Lights\nstatus: want\nprice: about £40\n---\n", 10);
};

const home = async (request: Requester) => {
  const response = await request("/api/workspaces/mountain-biking/home");
  expect(response.status).toBe(200);
  return PlanningHome.parse(await response.json());
};

const pick = (request: Requester, view: string) =>
  sendJson(request, "/api/workspaces/mountain-biking/home/showing", "PUT", { view });

describe("a planning workspace's Home (#208)", () => {
  it("has no view, photo or question before the workspace has anything for them", async () => {
    const request = await asOwner(testWorker({ root }));

    expect(await home(request)).toEqual({
      views: [],
      showing: null,
      picked: false,
      photo: null,
      question: null,
    });
  });

  it("shows a Thing's photo with its parts pinned, flagged only when they need something, and the wanted list", async () => {
    await withKit();
    const request = await asOwner(testWorker({ root }));

    const { views, photo } = await home(request);

    expect(photo).toBe("whyte-t-140");
    expect(views).toEqual([
      {
        kind: "picture",
        id: "picture:whyte-t-140",
        title: "Whyte T-140",
        thing: "whyte-t-140",
        changedAt: "2026-09-30T23:40:00.000Z",
        parts: [
          {
            thing: "chain",
            name: "Chain",
            status: "replace",
            needs: "It's stretched",
            pin: { x: 48, y: 55 },
            flagged: true,
          },
          {
            thing: "rear-tyre",
            name: "Rear tyre",
            status: "have",
            needs: "Pump it up before Saturday",
            pin: null,
            flagged: true,
          },
          { thing: "fork", name: "Fork", status: "have", pin: { x: 20, y: 40 }, flagged: false },
        ],
      },
      {
        kind: "wanted",
        id: "wanted",
        title: "Wanted",
        changedAt: "2026-09-30T23:50:00.000Z",
        items: [
          { thing: "lights", name: "Lights", status: "want", price: "about £40" },
          { thing: "chain", name: "Chain", status: "replace", needs: "It's stretched" },
        ],
      },
    ]);
  });

  it("shows the view last changed, until the owner picks one, whose pick then sticks", async () => {
    await withKit();
    const request = await asOwner(testWorker({ root }));
    expect(await home(request)).toMatchObject({ showing: "wanted", picked: false });

    const picked = await pick(request, "picture:whyte-t-140");
    await thing("pump", "---\nname: Pump\nstatus: want\n---\n", 1);

    expect(picked.status).toBe(200);
    expect(await home(request)).toMatchObject({ showing: "picture:whyte-t-140", picked: true });
  });

  it("refuses a view that isn't there, and goes back to the last changed once a picked one goes", async () => {
    await withKit();
    const request = await asOwner(testWorker({ root }));

    const refused = await pick(request, "picture:lights");
    await pick(request, "wanted");
    await thing("lights", "---\nname: Lights\nstatus: have\n---\n", 5);
    await thing("chain", "---\nname: Chain\nstatus: have\npart of: whyte-t-140\n---\n", 5);

    expect([refused.status, await errorOf(refused)]).toEqual([
      404,
      "That view isn't on this workspace's Home any more.",
    ]);
    expect(await home(request)).toMatchObject({
      views: [{ id: "picture:whyte-t-140" }],
      showing: "picture:whyte-t-140",
      picked: false,
    });
  });

  it("puts the owner's last question above the view, with the next steps its answer suggested", async () => {
    const saver = savingProvider([
      [
        {
          call: "suggest_replies",
          input: { replies: ["Find a chain under £30", "Which lights?"] },
        },
      ],
    ]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
    const started = await postJson(request, "/api/workspaces/mountain-biking/sessions", {
      text: "Is the bike ready for Saturday?",
      model: SAVING_MODEL,
    });
    const session = SessionSummary.parse(await started.json());
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    expect((await home(request)).question).toEqual({
      session: session.id,
      text: "Is the bike ready for Saturday?",
      at: expect.any(String),
      nextSteps: ["Find a chain under £30", "Which lights?"],
      answering: false,
      // A reply from Home carries on with the model it was asked with (#481).
      model: SAVING_MODEL,
    });
  });

  it("keeps the next steps back while the answer is still being written", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const saver = savingProvider([
      [
        { call: "suggest_replies", input: { replies: ["Find a chain under £30", "Which lights?"] } },
        async () => {
          holding();
          await gate;
        },
      ],
    ]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
    const started = await postJson(request, "/api/workspaces/mountain-biking/sessions", {
      text: "Is the bike ready for Saturday?",
      model: SAVING_MODEL,
    });
    const session = SessionSummary.parse(await started.json());
    await held;

    const whileAnswering = (await home(request)).question;
    release();
    expect(whileAnswering).toMatchObject({ answering: true, nextSteps: [] });
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect((await home(request)).question).toMatchObject({
      answering: false,
      nextSteps: ["Find a chain under £30", "Which lights?"],
    });
  });

  it("is only a planning workspace's", async () => {
    await mkdir(join(contextDir, "site"), { recursive: true });
    await writeFile(
      join(contextDir, "site", "workspace.json"),
      JSON.stringify({ mode: "code", repoPath: "/path/to/repo" }),
    );
    const request = await asOwner(testWorker({ root }));

    const response = await request("/api/workspaces/site/home");

    expect(response.status).toBe(409);
  });
});
