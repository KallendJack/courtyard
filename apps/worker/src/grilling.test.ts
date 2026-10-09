import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  errorOf,
  followSession,
  postJson,
  quotedInGuide,
  SAVING_MODEL,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Grilling, Courtyard's house skill, and Grill this plan (docs/ai-conduct.md, Grilling).

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  await writeFile(
    join(root, "context", "garage-gym", "CONTEXT.md"),
    `# Garage gym\n\n## Plans\n\n- ${PLAN}\n`,
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const PLAN = "Move the squat rack to the back wall before the rubber mats go down in November";

describe("Grill this plan", () => {
  it("starts a new session on the plan with the Grilling tag, titled after it, on a model that saves", async () => {
    const saver = savingProvider([[]]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));

    const response = await postJson(request, "/api/workspaces/garage-gym/grill", { plan: PLAN });

    expect(response.status).toBe(201);
    const session = SessionSummary.parse(await response.json());
    expect(session.title).toBe("Move the squat rack to the back wall before the rubber mats…");
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect(events[0]).toMatchObject({
      type: "owner-message",
      text: PLAN,
      skill: "grilling",
      model: SAVING_MODEL,
    });
    expect(saver.framings[0]?.instructions).toContain(
      "The owner started the grilling skill with their new message",
    );
  });

  it("starts Courtyard's Grilling, written as the guide words it", async () => {
    const saver = savingProvider([[]]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));

    const response = await postJson(request, "/api/workspaces/garage-gym/grill", { plan: PLAN });
    const { id } = SessionSummary.parse(await response.json());
    await followSession(request, { sessionId: id, until: "turn-completed" });

    const instructions = saver.framings[0]?.instructions;
    expect(instructions).toContain(`description: ${await quotedInGuide("Stress-tests a plan or an idea")}\n`);
    expect(instructions).toContain(`\n${await quotedInGuide("# Grilling")}\n</skill>`);
  });

  it("grills only a plan the workspace's context file has", async () => {
    const request = await asOwner(testWorker({ root, providers: [savingProvider([]).provider] }));

    const response = await postJson(request, "/api/workspaces/garage-gym/grill", {
      plan: "Buy a second-hand barbell",
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe(
      "That plan isn't in the context file any more. Reload the page to see it as it is now.",
    );
  });

  it("isn't offered in a code workspace, whose models can't save to its context file", async () => {
    await writeFile(
      join(root, "context", "garage-gym", "workspace.json"),
      '{ "mode": "code", "repoPath": "/path/to/repo" }',
    );
    const request = await asOwner(testWorker({ root, providers: [savingProvider([]).provider] }));

    const response = await postJson(request, "/api/workspaces/garage-gym/grill", { plan: PLAN });

    expect(response.status).toBe(409);
  });
});
