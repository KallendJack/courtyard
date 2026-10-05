// Starts the worker for the browser tests on a fresh data folder, so every run begins as a new
// install with no owner yet, plus one long session to check that long sessions stay smooth.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LONG_SESSION_ID, LONG_SESSION_TURNS } from "./long-session.ts";

const dataDir = "test-results/e2e/data";
rmSync(dataDir, { recursive: true, force: true });

const folder = join(dataDir, "sessions", LONG_SESSION_ID);
mkdirSync(folder, { recursive: true });
const at = "2026-10-01T12:00:00.000Z";
writeFileSync(
  join(folder, "session.json"),
  JSON.stringify({
    id: LONG_SESSION_ID,
    workspaceId: "garage-gym",
    title: "A long session",
    createdAt: at,
    updatedAt: at,
  }),
);
const model = { provider: "fake", model: "echo" };
const lines = [];
let seq = 0;
for (let turn = 1; turn <= LONG_SESSION_TURNS; turn++) {
  lines.push({ seq: ++seq, at, type: "owner-message", text: `Message ${turn}`, model });
  lines.push({ seq: ++seq, at, type: "text-delta", text: `You said: Message ${turn}` });
  lines.push({ seq: ++seq, at, type: "turn-completed" });
}
writeFileSync(join(folder, "events.jsonl"), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);

await import("../apps/worker/src/main.ts");
