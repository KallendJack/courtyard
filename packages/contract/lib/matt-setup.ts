import { z } from "zod";

/**
 * One thing a code workspace's repository is missing of Matt Pocock's setup (#181): a file his
 * setup skill writes, the Agent skills section in its AGENTS.md (or CLAUDE.md), or triage labels.
 */
export const MattSetupPiece = z.discriminatedUnion("kind", [
  /** A file under `docs/agents/`, by its path in the repository. */
  z.object({ kind: z.literal("file"), path: z.string() }),
  /** The Agent skills section, added to the file at `path`. */
  z.object({ kind: z.literal("section"), path: z.string() }),
  /** Triage labels the repository has none of on GitHub, by name. */
  z.object({ kind: z.literal("labels"), names: z.array(z.string()).min(1) }),
]);
export type MattSetupPiece = z.infer<typeof MattSetupPiece>;

/** A code workspace's setup check, as its page shows it. */
export const MattSetup = z.discriminatedUnion("state", [
  /** Something is missing: offered as one approval. */
  z.object({ state: z.literal("offered"), missing: z.array(MattSetupPiece).min(1) }),
  /** Nothing to offer: it's all there, the owner answered already, or it can't be checked. */
  z.object({ state: z.literal("none") }),
  /** The owner allowed it: the pull request adding the files, if any, and the labels made. */
  z.object({
    state: z.literal("opened"),
    pullRequest: z.object({ number: z.number().int().positive(), url: z.url() }).nullable(),
    labelsMade: z.array(z.string()),
  }),
]);
export type MattSetup = z.infer<typeof MattSetup>;

/** The owner's answer to the setup offer. */
export const MattSetupAnswer = z.object({ answer: z.enum(["allow", "not-now"]) });
export type MattSetupAnswer = z.infer<typeof MattSetupAnswer>;
