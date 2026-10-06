import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseOwnerContext, type ReadOwnerContext } from "../context-file/index.ts";
import { hasCode, readTextFile } from "../files.ts";
import { err, ok, type Result } from "../result.ts";
import type { WorkspaceError } from "../workspaces/index.ts";

/** Why the owner context couldn't be read or started: there's one already, or storage. */
export type OwnerContextError = Extract<WorkspaceError, { kind: "conflict" | "storage" }>;

/** The owner context lives at the top of the context folder, outside every workspace (ADR 0010). */
export const OWNER_FILE = "OWNER.md";
const ownerFile = (contextDir: string) => join(contextDir, OWNER_FILE);

/** The owner context, or `null` when the owner hasn't started one. */
export const readOwnerContext = async (
  contextDir: string,
): Promise<Result<ReadOwnerContext | null, OwnerContextError>> => {
  const text = await readTextFile(ownerFile(contextDir));
  if (!text.ok) return err({ kind: "storage", message: "OWNER.md can't be read." });
  return ok(text.value === undefined ? null : parseOwnerContext(text.value));
};

/** A new owner context: a line on what goes where, then both sections, empty (docs/ai-conduct.md). */
const STARTER = [
  "# Owner context",
  "",
  "Shared with every workspace. Under About me, write one line for each fact, plan or idea that's true across your whole life. Under How to answer me, write one line for each way you like answers.",
  "",
  "## About me",
  "",
  "### Facts",
  "",
  "### Plans",
  "",
  "### Ideas",
  "",
  "## How to answer me",
  "",
].join("\n");

/** Starts the owner context from the starter, never replacing one that's there. */
export const startOwnerContext = async (
  contextDir: string,
): Promise<Result<ReadOwnerContext, OwnerContextError>> => {
  try {
    await writeFile(ownerFile(contextDir), STARTER, { flag: "wx" });
  } catch (error) {
    return hasCode(error, "EEXIST")
      ? err({ kind: "conflict", message: "There's already an owner context." })
      : err({ kind: "storage", message: "OWNER.md can't be saved." });
  }
  return ok(parseOwnerContext(STARTER));
};
