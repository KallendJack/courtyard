// Starts the worker for the browser tests on a fresh data folder, so every run begins as a new
// install with no owner yet, plus one long session to check that long sessions stay smooth.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionEvent, SessionSummary } from "../packages/contract/index.ts";
import { LONG_SESSION_ID, LONG_SESSION_TURNS } from "./long-session.ts";

const dataDir = process.env.COURTYARD_DATA_DIR;
if (!dataDir)
  throw new Error("COURTYARD_DATA_DIR isn't set: start the browser tests with Playwright");
rmSync(dataDir, { recursive: true, force: true });

// The long session, written in the worker's own formats: parsing each record with the contract's
// schemas means a format change fails here, by name, rather than as a blank page in a test.
const folder = join(dataDir, "sessions", LONG_SESSION_ID);
mkdirSync(folder, { recursive: true });
const at = "2026-10-01T12:00:00.000Z";
const session = SessionSummary.omit({ busy: true }).parse({
  id: LONG_SESSION_ID,
  workspaceId: "garage-gym",
  title: "A long session",
  createdAt: at,
  updatedAt: at,
});
writeFileSync(join(folder, "session.json"), JSON.stringify(session));

const model = { provider: "fake", model: "echo" };
const events = [];
let seq = 0;
for (let turn = 1; turn <= LONG_SESSION_TURNS; turn++) {
  events.push({ seq: ++seq, at, type: "owner-message", text: `Message ${turn}`, model });
  events.push({ seq: ++seq, at, type: "text-delta", text: `You said: Message ${turn}` });
  events.push({ seq: ++seq, at, type: "turn-completed" });
}
const lines = events.map((event) => JSON.stringify(SessionEvent.parse(event)));
writeFileSync(join(folder, "events.jsonl"), `${lines.join("\n")}\n`);

await import("../apps/worker/src/main.ts");
