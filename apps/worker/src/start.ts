import { serve } from "@hono/node-server";
import { createWorker } from "./worker.ts";

/**
 * Builds the worker from its settings and serves it, or explains what's wrong with the settings
 * and exits. The browser tests start it the same way, with a stand-in for the update script.
 */
export const startWorker = (options: Parameters<typeof createWorker>[0]) => {
  const worker = createWorker(options);
  if (!worker.ok) {
    console.error(worker.error);
    process.exit(1);
  }
  const { app, port } = worker.value;
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Courtyard worker listening on port ${port}`);
  });
};
