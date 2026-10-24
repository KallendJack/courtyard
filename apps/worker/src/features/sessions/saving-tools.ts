import type { Result } from "../../lib/result.ts";
import type { ToolReply } from "../../providers/index.ts";

/**
 * One of a turn's saving tools as the model calls it (saves, documents, Things, projects, Builds):
 * nothing more is saved once the turn is stopped (one already saving finishes), each save is
 * recorded in the session as it's made, and a refused one can be put right once, after which the
 * model carries on without it.
 */
export const savingTool = <Done, Refusal>(tool: {
  readonly stopped: () => boolean;
  readonly run: (input: unknown) => Promise<Result<Done, Refusal>>;
  readonly record: (done: Done) => Promise<void>;
  /** What the model is told, the second refusal in a row being final. */
  readonly reply: (done: Result<Done, Refusal>, retrying: boolean) => ToolReply;
  readonly stoppedReply: () => ToolReply;
}) => {
  /** Whether the last save was refused, so this one is its retry. */
  let retrying = false;
  return async (input: unknown): Promise<ToolReply> => {
    if (tool.stopped()) return tool.stoppedReply();
    const done = await tool.run(input);
    if (done.ok) await tool.record(done.value);
    const reply = tool.reply(done, retrying);
    retrying = !done.ok && !retrying;
    return reply;
  };
};
