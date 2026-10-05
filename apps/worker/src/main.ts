import { serve } from "@hono/node-server";
import { createWorker } from "./worker.ts";

const worker = createWorker({ env: process.env });

if (!worker.ok) {
  console.error(worker.error);
  process.exit(1);
}

const { app, port } = worker.value;
serve({ fetch: app.fetch, port }, () => {
  console.log(`Courtyard worker listening on port ${port}`);
});
