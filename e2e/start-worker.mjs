// Starts the worker for the browser tests on a fresh data folder, so every run begins as a new
// install with no owner yet.
import { rmSync } from "node:fs";

rmSync("test-results/e2e/data", { recursive: true, force: true });
await import("../apps/worker/src/main.ts");
