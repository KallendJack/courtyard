import { resolve } from "node:path";
import { err, ok, type Result } from "@courtyard/contract";
import { z } from "zod";

const required = z.string({ error: "is required" }).min(1, "is required");
const port = z.coerce
  .number({ error: "must be a port number from 1 to 65535" })
  .int("must be a port number from 1 to 65535")
  .min(1, "must be a port number from 1 to 65535")
  .max(65535, "must be a port number from 1 to 65535");
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);

const Env = z.object({
  COURTYARD_PORT: z.preprocess(unsetIfEmpty, port.default(8787)),
  COURTYARD_CONTEXT_DIR: required,
  COURTYARD_DATA_DIR: required,
  COURTYARD_WEB_DIR: z.preprocess(unsetIfEmpty, z.string().optional()),
});

/** Where `pnpm build` puts the web app, relative to this file. */
const builtWebApp = resolve(import.meta.dirname, "../../web/dist");

export type Settings = {
  readonly port: number;
  readonly contextDir: string;
  readonly dataDir: string;
  /** The web app's built files, served on the same origin as the API. */
  readonly webDir: string;
};

/**
 * Reads the worker's settings from the environment. The error names every bad setting and never
 * repeats a value, because a value may be a secret.
 */
export const readSettings = (env: Record<string, string | undefined>): Result<Settings, string> => {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".")} ${issue.message}`,
    );
    return err(`Courtyard can't start. Fix these settings:\n${problems.join("\n")}`);
  }
  return ok({
    port: parsed.data.COURTYARD_PORT,
    contextDir: parsed.data.COURTYARD_CONTEXT_DIR,
    dataDir: parsed.data.COURTYARD_DATA_DIR,
    webDir: resolve(parsed.data.COURTYARD_WEB_DIR ?? builtWebApp),
  });
};
