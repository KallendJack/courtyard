import { SUGGESTED_REPLIES, SUGGESTED_REPLY_MAX_CHARACTERS } from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../result.ts";

/** Why the worker won't show a model's suggested replies (docs/ai-conduct.md, Suggested replies). */
export type RepliesRefusal =
  | { readonly kind: "malformed" }
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "not-short" }
  | { readonly kind: "repeated" }
  /** The answer already has its replies: one set per answer. */
  | { readonly kind: "already" }
  | { readonly kind: "stopped" };

const Input = z.object({ replies: z.array(z.string()) });

/** Compared without case or spacing, so "Not yet" and "not  yet" are the same reply. */
const sameness = (reply: string) => reply.toLowerCase().replace(/\s+/g, " ");

/**
 * A model's suggested replies as the chat shows them, each trimmed: two or three, each a few
 * words on one line, all different. Or why not, for the model to put right.
 */
export const checkReplies = (input: unknown): Result<string[], RepliesRefusal> => {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return err({ kind: "malformed" });
  const replies = parsed.data.replies.map((reply) => reply.trim());
  const { atLeast, atMost } = SUGGESTED_REPLIES;
  if (replies.length < atLeast || replies.length > atMost) {
    return err({ kind: "count", count: replies.length });
  }
  const short = (reply: string) =>
    reply !== "" && !/[\r\n]/.test(reply) && reply.length <= SUGGESTED_REPLY_MAX_CHARACTERS;
  if (!replies.every(short)) return err({ kind: "not-short" });
  if (new Set(replies.map(sameness)).size < replies.length) return err({ kind: "repeated" });
  return ok(replies);
};

/**
 * The suggest replies tool for one turn: checks each call's replies and records the first set
 * accepted, refusing any after it, and any once the turn is stopped.
 */
export const createTurnReplies = (turn: {
  /** Whether the turn is stopped, or can't record any more. */
  stopped: () => boolean;
  record: (replies: readonly string[]) => Promise<void>;
}) => {
  let suggested = false;
  return async (input: unknown): Promise<Result<readonly string[], RepliesRefusal>> => {
    if (turn.stopped()) return err({ kind: "stopped" });
    if (suggested) return err({ kind: "already" });
    const checked = checkReplies(input);
    if (!checked.ok) return checked;
    suggested = true;
    await turn.record(checked.value);
    return checked;
  };
};
