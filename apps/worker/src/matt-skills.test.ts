import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillList, type SkillSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  followSession,
  loginCookie,
  mattSkillsIn,
  postJson,
  type Requester,
  RUNNING_MODEL,
  requesterFor,
  runningProvider,
  testWorker,
  writeHouseSkills,
  writeMattPlugin,
} from "./testing.ts";

// Matt Pocock's skills in every code workspace (#181, ADR 0023): Courtyard's pinned copy of his
// plugin, fetched at the version matt.json names and loaded only when it matches its checksum.

let root: string;
const houseDir = () => join(root, "house");
const pluginDir = () => join(root, "matt-plugin");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  const { repo } = await codeRepo(root);
  await codeWorkspace(root, "side-project", repo);
  await writeHouseSkills(houseDir(), [
    { name: "grilling", workspaces: ["planning", "code"] },
    { name: "get-to-know", workspaces: ["planning"], start: "owner" },
  ]);
  await writeMattPlugin(pluginDir());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const skillsOf = async (request: Requester, workspace: string) => {
  const response = await request(`/api/workspaces/${workspace}/skills`);
  expect(response.status).toBe(200);
  return SkillList.parse(await response.json()).skills;
};

/** Starts a session in the code workspace and follows its first turn to its end: its events. */
const codeTurn = async (request: Requester, text: string, model: object = RUNNING_MODEL) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return followSession(request, {
    sessionId: id,
    until: (event) => event.type === "turn-completed" || event.type === "turn-failed",
  });
};

const named = (skills: readonly SkillSummary[]) =>
  skills.map((skill) => [skill.name, skill.source, skill.kind]);

describe("Matt Pocock's skills", () => {
  it("are every code workspace's, from the pinned copy, his grilling replacing the house one", async () => {
    const matt = await mattSkillsIn(pluginDir());
    const request = await asOwner(testWorker({ root, houseSkills: houseDir(), mattSkills: matt }));

    const skills = await skillsOf(request, "side-project");

    expect(named(skills)).toEqual([
      ["grilling", "matt", "usable"],
      ["implement", "matt", "usable"],
      ["tdd", "matt", "usable"],
      ["to-tickets", "matt", "usable"],
    ]);
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    // The picker lists the ones the owner starts; the model loads the rest itself.
    expect(byName.get("implement")).toMatchObject({ ownerOnly: true, inPicker: true });
    expect(byName.get("tdd")).toMatchObject({ ownerOnly: false, inPicker: false });
    expect(byName.get("grilling")).toMatchObject({ replacesHouse: true, inPicker: false });
  });

  it("never reach a planning workspace", async () => {
    const matt = await mattSkillsIn(pluginDir());
    const request = await asOwner(testWorker({ root, houseSkills: houseDir(), mattSkills: matt }));

    expect(named(await skillsOf(request, "garage-gym"))).toEqual([
      ["get-to-know", "house", "usable"],
      ["grilling", "house", "usable"],
    ]);
  });

  it("aren't loaded when the copy fetched doesn't match matt.json's checksum, saying why", async () => {
    const matt = await mattSkillsIn(pluginDir(), { checksum: `sha256-${"0".repeat(64)}` });
    const request = await asOwner(testWorker({ root, houseSkills: houseDir(), mattSkills: matt }));

    const skills = await skillsOf(request, "side-project");

    // The house grilling stays, since nothing replaces it.
    expect(named(skills)).toEqual([
      ["grilling", "house", "usable"],
      ["mattpocock-skills", "matt", "unusable"],
    ]);
    expect(skills.at(-1)).toMatchObject({
      problem: {
        kind: "broken",
        reason: "the copy fetched doesn't match the checksum in matt.json, so it isn't loaded",
      },
    });
    expect(await readdir(join(root, "data", "matt-skills"))).toEqual([]);
  });

  it("are fetched once and kept in the data folder, and fetched again when the pin moves on", async () => {
    const first = await mattSkillsIn(pluginDir());
    await skillsOf(
      await asOwner(testWorker({ root, houseSkills: houseDir(), mattSkills: first })),
      "side-project",
    );
    /** The worker started again on the data folder, with Matt's skills as given. */
    const restarted = async (mattSkills: Awaited<ReturnType<typeof mattSkillsIn>>) => {
      const app = testWorker({ root, houseSkills: houseDir(), mattSkills });
      const login = await app.request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "test password" }),
      });
      return requesterFor(app, loginCookie(login));
    };
    // The worker starts again on the same pin, then on a newer release.
    const again = await mattSkillsIn(pluginDir());
    await skillsOf(await restarted(again), "side-project");
    await writeMattPlugin(pluginDir(), { version: "1.4.0" });
    const newer = await mattSkillsIn(pluginDir(), { version: "1.4.0" });
    await skillsOf(await restarted(newer), "side-project");

    expect([first.fetches, again.fetches, newer.fetches]).toEqual([["1.3.1"], [], ["1.4.0"]]);
    expect(await readdir(join(root, "data", "matt-skills"))).toEqual(["1.4.0"]);
  });

  it("go to a code turn's provider as the copy's folder and the skills to turn on, never in Courtyard's own list", async () => {
    const matt = await mattSkillsIn(pluginDir());
    const { provider, plugins, framings } = runningProvider([]);
    const request = await asOwner(
      testWorker({ root, houseSkills: houseDir(), mattSkills: matt, providers: [provider] }),
    );

    await codeTurn(request, "Hello");

    expect(plugins).toEqual([
      {
        folder: join(root, "data", "matt-skills", "1.3.1"),
        name: "mattpocock-skills",
        skills: ["grilling", "implement", "tdd", "to-tickets"],
      },
    ]);
    // Claude loads them itself, so the turn doesn't offer them through the use skill tool.
    expect(framings[0]?.instructions).not.toContain("What tdd does.");
  });

  it("start from a message that begins with one's name, as /implement 157", async () => {
    const matt = await mattSkillsIn(pluginDir());
    const { provider, framings } = runningProvider([]);
    const request = await asOwner(
      testWorker({ root, houseSkills: houseDir(), mattSkills: matt, providers: [provider] }),
    );

    const started = await codeTurn(request, "/implement 157");
    const other = await codeTurn(request, "/deploy now, or /implement");

    const skillOf = (events: typeof started) =>
      events.find((event) => event.type === "owner-message")?.skill;
    expect([skillOf(started), skillOf(other)]).toEqual(["implement", undefined]);
    expect(framings[0]?.instructions).toContain('Call the Skill tool with "tdd".');
  });

  it("go to no code turn when they aren't loaded", async () => {
    const matt = await mattSkillsIn(pluginDir(), { checksum: `sha256-${"0".repeat(64)}` });
    const { provider, plugins } = runningProvider([]);
    const request = await asOwner(
      testWorker({ root, houseSkills: houseDir(), mattSkills: matt, providers: [provider] }),
    );

    await codeTurn(request, "Hello");

    expect(plugins).toEqual([null]);
  });

  it("refuse a release whose plugin.json would run anything besides skills", async () => {
    await writeMattPlugin(pluginDir(), { extra: { hooks: "./hooks/hooks.json" } });
    const matt = await mattSkillsIn(pluginDir(), { checksum: `sha256-${"1".repeat(64)}` });
    const request = await asOwner(testWorker({ root, houseSkills: houseDir(), mattSkills: matt }));

    expect((await skillsOf(request, "side-project")).at(-1)).toMatchObject({
      name: "mattpocock-skills",
      problem: { kind: "broken", reason: "its plugin.json isn't one Courtyard keeps" },
    });
  });
});
