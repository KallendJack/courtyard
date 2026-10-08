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
/** A setting that's on (1) or off (0), and `whenUnset` when it isn't set. */
const flag = (whenUnset: "0" | "1") =>
  z.preprocess(
    unsetIfEmpty,
    z
      .enum(["0", "1"], { error: "must be 1 or 0" })
      .default(whenUnset)
      .transform((value) => value === "1"),
  );

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
  COURTYARD_CONTEXT_REMOTE: z.preprocess(unsetIfEmpty, z.string().optional()),
  COURTYARD_CLAUDE_PROVIDER: flag("1"),
  COURTYARD_CODEX_PROVIDER: flag("1"),
  COURTYARD_FAKE_PROVIDER: flag("0"),
  COURTYARD_FAKE_SIGN_IN: flag("0"),
  COURTYARD_WEB_DIR: z.preprocess(
    unsetIfEmpty,
    z.string().refine(isFolder, "must be an existing folder").optional(),
  ),
  // Both set by scripts/live/run.ps1 when it starts the live worker, never by hand.
  COURTYARD_LIVE_COPY: z.preprocess(
    unsetIfEmpty,
    z.string().refine(isFolder, "must be an existing folder").optional(),
  ),
  COURTYARD_UPDATE_TASK: z.preprocess(unsetIfEmpty, z.string().default("Courtyard update")),
});

/** Where `pnpm build` puts the web app, relative to this file. */
const builtWebApp = resolve(import.meta.dirname, "../../web/dist");

export type Settings = {
  readonly port: number;
  readonly contextDir: string;
  readonly dataDir: string;
  /** Where the context folder is backed up: any git remote, or `null` for no backup (ADR 0014). */
  readonly contextRemote: string | null;
  /** The web app's built files, served on the same origin as the API. */
  readonly webDir: string;
  /** Whether to offer Claude, through the worker machine's Claude Code (on unless turned off). */
  readonly claudeProvider: boolean;
  /**
   * Whether to offer Codex, through Courtyard's own Codex home in the data folder (on unless
   * turned off, for someone without a ChatGPT plan).
   */
  readonly codexProvider: boolean;
  /** Whether to offer the scripted fake provider, for trying Courtyard with no models. */
  readonly fakeProvider: boolean;
  /**
   * Whether the fake acts signed out, with a pretend sign-in that finishes a few seconds after it
   * starts, so signing in can be tried and tested with no real provider.
   */
  readonly fakeSignIn: boolean;
  /**
   * The live copy this worker runs from (ADR 0011), which the owner can update from the app.
   * Only the live scripts set it, so development and tests never update themselves.
   */
  readonly liveCopy: string | null;
  /** The scheduled task that updates the live copy, as install-task.ps1 named it. */
  readonly updateTask: string;
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
    contextRemote: parsed.data.COURTYARD_CONTEXT_REMOTE ?? null,
    webDir: resolve(parsed.data.COURTYARD_WEB_DIR ?? builtWebApp),
    claudeProvider: parsed.data.COURTYARD_CLAUDE_PROVIDER,
    codexProvider: parsed.data.COURTYARD_CODEX_PROVIDER,
    fakeProvider: parsed.data.COURTYARD_FAKE_PROVIDER,
    fakeSignIn: parsed.data.COURTYARD_FAKE_SIGN_IN,
    liveCopy:
      parsed.data.COURTYARD_LIVE_COPY === undefined
        ? null
        : resolve(parsed.data.COURTYARD_LIVE_COPY),
    updateTask: parsed.data.COURTYARD_UPDATE_TASK,
  });
};
