import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  followSession,
  postJson,
  quotedInGuide,
  removeTestFolder,
  SAVING_MODEL,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Grilling, Courtyard's house skill (docs/ai-conduct.md, Grilling). Grill this plan, the flame
// beside each Plan line, went with the Plans section (#603).

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  await writeFile(
    join(root, "context", "garage-gym", "CONTEXT.md"),
    "# Garage gym\n\n## Facts\n\n- A single garage.\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

const PLAN = "Move the squat rack to the back wall before the rubber mats go down in November";

describe("Grilling", () => {
  it("starts Courtyard's Grilling when the owner picks it, written as the guide words it", async () => {
    const saver = savingProvider([[]]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));

    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: PLAN,
      skill: "grilling",
      model: SAVING_MODEL,
    });
    const { id } = SessionSummary.parse(await response.json());
    await followSession(request, { sessionId: id, until: "turn-completed" });

    const instructions = saver.framings[0]?.instructions;
    expect(instructions).toContain(
      `description: ${await quotedInGuide("Stress-tests a plan or an idea")}\n`,
    );
    expect(instructions).toContain(`\n${await quotedInGuide("# Grilling")}\n</skill>`);
  });

  it("has no Grill this plan any more: the Plans section went with projects (#603)", async () => {
    const request = await asOwner(testWorker({ root, providers: [savingProvider([]).provider] }));

    const response = await postJson(request, "/api/workspaces/garage-gym/grill", { plan: PLAN });

    expect(response.status).toBe(404);
  });
});
