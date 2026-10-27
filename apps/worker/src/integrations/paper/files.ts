import type { PaperFile } from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";
import { exportBoards, type PaperPage } from "./boards.ts";
import { PAPER_NOT_OPEN, withPaper } from "./client.ts";

export { PAPER_NOT_OPEN };

/**
 * The owner's Paper files, as connecting Paper from a code workspace's page asks for them (#308):
 * listing them to pick from, and making one named after the workspace; and a file's boards with
 * their pictures, for its Designs tab (#522). Passed in to the worker like GitHub, so tests use an
 * in-memory fake; `createPaperFiles` is the one real one, which asks Paper's own MCP server on the
 * worker machine, as a session's turn does (ADR 0023).
 */
export type PaperFiles = {
  /** The owner's Paper files, most recently changed first, or why they can't be listed. */
  readonly list: (command: string) => Promise<Result<readonly PaperFile[], string>>;
  /** Makes a Paper file called `name`, or says why it couldn't. */
  readonly create: (command: string, name: string) => Promise<Result<PaperFile, string>>;
  /**
   * The boards on a file's pages that `wanted` names, each with its picture, or why they couldn't
   * be exported.
   */
  readonly boards: (
    command: string,
    file: { readonly fileId: string; readonly wanted: (page: string) => boolean },
  ) => Promise<Result<readonly PaperPage[], string>>;
};

/** The most files listed: as many as Paper lists at once. */
const MOST_FILES = 200;

/** `list_resources`'s answer, as far as Courtyard reads it. */
const Resources = z.object({
  resources: z.array(z.looseObject({ id: z.string(), name: z.string(), type: z.string() })),
});

/** A file's id, as Paper's are: 26 letters and digits. */
const FILE_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;
const Made = z.looseObject({ id: z.string().optional(), fileId: z.string().optional() });

/** The id of the file `create_file`'s answer says it made: from its JSON, or else its text. */
const madeIn = (text: string) => {
  try {
    const made = Made.safeParse(JSON.parse(text));
    const id = made.data?.fileId ?? made.data?.id;
    if (id !== undefined) return id;
  } catch {
    // Not JSON: the id is somewhere in its words.
  }
  return FILE_ID.exec(text)?.[0];
};

/** Calls one of Paper's tools through its MCP server, started from `command`: its text, joined. */
const callPaper = (command: string, tool: string, args: Record<string, unknown>) =>
  withPaper(command, async (ask) => {
    const answer = await ask(tool, args);
    return answer.ok ? ok(answer.value.texts.join("\n")) : answer;
  });

export const createPaperFiles = (): PaperFiles => ({
  list: async (command) => {
    const answer = await callPaper(command, "list_resources", { limit: MOST_FILES });
    if (!answer.ok) return answer;
    try {
      const listed = Resources.safeParse(JSON.parse(answer.value));
      if (!listed.success) return err("Paper's list of files couldn't be read.");
      return ok(
        listed.data.resources
          .filter((resource) => resource.type === "file")
          .map((resource) => ({ id: resource.id, name: resource.name })),
      );
    } catch {
      return err("Paper's list of files couldn't be read.");
    }
  },
  create: async (command, name) => {
    const answer = await callPaper(command, "create_file", { name });
    if (!answer.ok) return answer;
    const id = madeIn(answer.value);
    return id === undefined ? err("Paper didn't say which file it made.") : ok({ id, name });
  },
  boards: (command, file) => withPaper(command, (ask) => exportBoards(ask, file)),
});
