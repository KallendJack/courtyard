import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";

/**
 * Asking Paper's own MCP server on the worker machine, as a session's turn does (ADR 0023): its
 * server started from Paper's command, one or more of its tools called, then stopped.
 */

/** What the owner is told when Paper can't be asked: it's their desktop app, so it may be closed. */
export const PAPER_NOT_OPEN =
  "Paper couldn't be reached. Open Paper on the worker machine, then try again.";

/** How long starting Paper's server may take, and so may each tool it's asked. */
const ASK_TIMEOUT_MS = 20_000;

/** A picture a tool answered with: a screenshot of a board. */
export type PaperPicture = { readonly mediaType: string; readonly bytes: Uint8Array };

/** A tool's answer: each of its text parts, and each picture. */
export type PaperAnswer = {
  readonly texts: readonly string[];
  readonly pictures: readonly PaperPicture[];
};

/** Calls one of Paper's tools, in the one server started for this ask. */
export type AskPaper = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<Result<PaperAnswer, string>>;

const Answer = z.object({
  isError: z.boolean().optional(),
  content: z.array(
    z.looseObject({
      type: z.string(),
      text: z.string().optional(),
      data: z.string().optional(),
      mimeType: z.string().optional(),
    }),
  ),
});

/** A tool's answer as Courtyard reads it: its texts and pictures, or nothing when it failed. */
const answerOf = (raw: unknown): PaperAnswer | undefined => {
  const answer = Answer.safeParse(raw);
  if (!answer.success || answer.data.isError === true) return undefined;
  const texts: string[] = [];
  const pictures: PaperPicture[] = [];
  for (const part of answer.data.content) {
    if (part.text !== undefined) texts.push(part.text);
    if (part.type === "image" && part.data !== undefined && part.mimeType !== undefined) {
      pictures.push({ mediaType: part.mimeType, bytes: Buffer.from(part.data, "base64") });
    }
  }
  return { texts, pictures };
};

/**
 * Starts Paper's MCP server from `command`, runs `use` with a way to call its tools, then stops
 * it. Paper that can't be started or answers with an error is `PAPER_NOT_OPEN`.
 */
export const withPaper = async <T>(
  command: string,
  use: (ask: AskPaper) => Promise<Result<T, string>>,
): Promise<Result<T, string>> => {
  const transport = new StdioClientTransport({ command, args: ["mcp"], stderr: "ignore" });
  const client = new Client({ name: "courtyard", version: "1" });
  try {
    await client.connect(transport, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) });
    return await use(async (tool, args) => {
      try {
        const raw = await client.callTool({ name: tool, arguments: args }, undefined, {
          timeout: ASK_TIMEOUT_MS,
        });
        const answer = answerOf(raw);
        return answer === undefined ? err(PAPER_NOT_OPEN) : ok(answer);
      } catch {
        return err(PAPER_NOT_OPEN);
      }
    });
  } catch {
    return err(PAPER_NOT_OPEN);
  } finally {
    await client.close().catch(() => undefined);
  }
};
