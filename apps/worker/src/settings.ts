import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "./result.ts";

/** The environment the worker reads its settings from, such as `process.env`. */
export type Environment = Record<string, string | undefined>;

const isFolder = (path: string) =>
  statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Makes the folder if it's missing, and says whether a folder is there afterwards. */
const ensureFolder = (path: string) => {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    // A file in the way, or no permission: the check below reports it.
  }
  return isFolder(path);
};

const NOT_A_PORT = "must be a port number from 1 to 65535";
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);
const required = z.string({ error: "is required" }).min(1, "is required");

const Env = z.object({
  COURTYARD_PORT: z.preprocess(
    unsetIfEmpty,
    z.coerce
      .number({ error: NOT_A_PORT })
      .int(NOT_A_PORT)
      .min(1, NOT_A_PORT)
      .max(65535, NOT_A_PORT)
      .default(8787),
  ),
  COURTYARD_CONTEXT_DIR: required.refine(isFolder, "must be an existing folder"),
  COURTYARD_DATA_DIR: required.refine(ensureFolder, "must be a folder the worker can create"),
  COURTYARD_CLAUDE_PROVIDER: z.preprocess(
    unsetIfEmpty,
    z.enum(["0", "1"], { error: "must be 1 or 0" }).default("1"),
  ),
  COURTYARD_FAKE_PROVIDER: z.preprocess(
    unsetIfEmpty,
    z.enum(["0", "1"], { error: "must be 1 or 0" }).default("0"),
  ),
  COURTYARD_WEB_DIR: z.preprocess(
    unsetIfEmpty,
    z.string().refine(isFolder, "must be an existing folder").optional(),
  ),
});

/** Where `pnpm build` puts the web app, relative to this file. */
const builtWebApp = resolve(import.meta.dirname, "../../web/dist");

export type Settings = {
  readonly port: number;
  readonly contextDir: string;
  readonly dataDir: string;
  /** The web app's built files, served on the same origin as the API. */
  readonly webDir: string;
  /** Whether to offer Claude, through the worker machine's Claude Code (on unless turned off). */
  readonly claudeProvider: boolean;
  /** Whether to offer the scripted fake provider, for trying Courtyard with no models. */
  readonly fakeProvider: boolean;
};

/**
 * Reads the worker's settings from the environment, creating the data folder if needed. The error
 * names every bad setting and never repeats a value, because a value may be a secret.
 */
export const readSettings = (env: Environment): Result<Settings, string> => {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".")} ${issue.message}`,
    );
    return err(`Courtyard can't start. Fix these settings:\n${problems.join("\n")}`);
  }
  return ok({
    port: parsed.data.COURTYARD_PORT,
    contextDir: resolve(parsed.data.COURTYARD_CONTEXT_DIR),
    dataDir: resolve(parsed.data.COURTYARD_DATA_DIR),
    webDir: resolve(parsed.data.COURTYARD_WEB_DIR ?? builtWebApp),
    claudeProvider: parsed.data.COURTYARD_CLAUDE_PROVIDER === "1",
    fakeProvider: parsed.data.COURTYARD_FAKE_PROVIDER === "1",
  });
};
