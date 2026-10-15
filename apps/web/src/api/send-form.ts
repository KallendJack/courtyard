import type { z } from "zod";
import { type FromWorker, readResponse } from "./worker.ts";

// Beside `worker.ts` rather than in it: only pages that send files use it (a message's attachments,
// a Thing's photo), so none of it is on the first load.

/**
 * Sends a multipart form to the worker's API (a POST unless `method` says) and reads the answer
 * with `schema`, as `sendJson` does for JSON.
 */
export const sendForm = async <T>(request: {
  path: string;
  method?: "POST" | "PUT";
  form: FormData;
  schema: z.ZodType<T>;
}): Promise<FromWorker<T>> => {
  try {
    const response = await fetch(`/api${request.path}`, {
      method: request.method ?? "POST",
      body: request.form,
    });
    return await readResponse({ response, schema: request.schema, unauthorised: "logged-out" });
  } catch {
    return { kind: "offline" };
  }
};
