import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createWorker } from "./worker.ts";

/**
 * How long the worker keeps an idle connection open: longer than the owner's proxy keeps one to
 * use again (Caddy's is 2 minutes). Node's own 5 seconds is shorter, so the worker would close a
 * connection the proxy still counts as open, and the proxy's next request on it fails with a 502:
 * the classic race of a reused idle connection, likelier on a busy machine (#204).
 */
const KEEP_IDLE_CONNECTIONS_MS = 125_000;

/** Serves the worker's app on `port`, and returns its HTTP server. */
export const serveWorker = (worker: { app: Hono; port: number; onListening?: () => void }) =>
  serve(
    {
      fetch: worker.app.fetch,
      port: worker.port,
      serverOptions: {
        keepAliveTimeout: KEEP_IDLE_CONNECTIONS_MS,
        // Node needs a request's headers to be allowed longer than an idle connection is kept.
        headersTimeout: KEEP_IDLE_CONNECTIONS_MS + 1000,
      },
    },
    worker.onListening,
  );

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
  serveWorker({
    app,
    port,
    onListening: () => console.log(`Courtyard worker listening on port ${port}`),
  });
};
