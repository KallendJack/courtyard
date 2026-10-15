import type { PaperFile } from "@courtyard/contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";

/**
 * The owner's Paper files, as connecting Paper from a code workspace's page asks for them (#308):
 * listing them to pick from, and making one named after the workspace. Passed in to the worker like
 * GitHub, so tests use an in-memory fake; `createPaperFiles` is the one real one, which asks Paper's
 * own MCP server on the worker machine, as a session's turn does (ADR 0023).
 */
export type PaperFiles = {
  /** The owner's Paper files, most recently changed first, or why they can't be listed. */
  readonly list: (command: string) => Promise<Result<readonly PaperFile[], string>>;
  /** Makes a Paper file called `name`, or says why it couldn't. */
  readonly create: (command: string, name: string) => Promise<Result<PaperFile, string>>;
};

/** What the owner is told when Paper can't be asked: it's their desktop app, so it may be closed. */
export const PAPER_NOT_OPEN =
  "Paper couldn't be reached. Open Paper on the worker machine, then try again.";

/** How long one ask of Paper may take, starting its server included. */
const ASK_TIMEOUT_MS = 20_000;
/** The most files listed: as many as Paper lists at once. */
const MOST_FILES = 200;

/** `list_resources`'s answer, as far as Courtyard reads it. */
const Resources = z.object({
  resources: z.array(z.looseObject({ id: z.string(), name: z.string(), type: z.string() })),
});

/** A file's id, as Paper's are: 26 letters and digits. */
const FILE_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;
const Made = z.looseObject({ id: z.string().optional(), fileId: z.string().optional() });

/** The text a tool's answer carries, joined. */
const textOf = (answer: unknown) =>
  z
    .object({ content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })) })
    .safeParse(answer)
    .data?.content.flatMap((part) => (part.text === undefined ? [] : [part.text]))
    .join("\n") ?? "";

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

/** Calls one of Paper's tools through its MCP server, started from `command`, then stops it. */
const callPaper = async (
  command: string,
  tool: { name: string; arguments: Record<string, unknown> },
): Promise<Result<string, string>> => {
  const transport = new StdioClientTransport({ command, args: ["mcp"], stderr: "ignore" });
  const client = new Client({ name: "courtyard", version: "1" });
  const timeout = AbortSignal.timeout(ASK_TIMEOUT_MS);
  try {
    await client.connect(transport, { signal: timeout });
    const answer = await client.callTool(tool, undefined, { signal: timeout });
    if (answer.isError === true) return err(PAPER_NOT_OPEN);
    return ok(textOf(answer));
  } catch {
    return err(PAPER_NOT_OPEN);
  } finally {
    await client.close().catch(() => undefined);
  }
};

export const createPaperFiles = (): PaperFiles => ({
  list: async (command) => {
    const answer = await callPaper(command, {
      name: "list_resources",
      arguments: { limit: MOST_FILES },
    });
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
    const answer = await callPaper(command, { name: "create_file", arguments: { name } });
    if (!answer.ok) return answer;
    const id = madeIn(answer.value);
    return id === undefined ? err("Paper didn't say which file it made.") : ok({ id, name });
  },
});
