import { z } from "zod";

// The setup card (#181, #323): what a code workspace's repository has of the house standard (Matt
// Pocock's setup with the house answers), what moves it there, and the owner's choices on it.

/**
 * Where the repository's work lives when it isn't GitHub issues (#323): its own tracker, a backlog
 * or TODO file, or `.scratch/`. Move to GitHub issues is recommended, unless the repository's own
 * instructions say another tool or agent writes it (`why` says so), when Keep is.
 */
export const SetupTracker = z.object({
  path: z.string(),
  recommended: z.enum(["keep", "move"]),
  why: z.string().optional(),
});
export type SetupTracker = z.infer<typeof SetupTracker>;

/** A setup card: every line of it, each with what Courtyard found and what it recommends. */
export const SetupCard = z.object({
  /** Its own tracker, to keep or move to GitHub issues; `null` when there's nothing to decide. */
  tracker: SetupTracker.nullable(),
  /** Its glossary under another name (`CONTEXT.md`), to rename to `GLOSSARY.md` or keep. */
  glossary: z.object({ path: z.string() }).nullable(),
  /** The files under `docs/agents/` Matt's skills read that it hasn't got, by path. */
  files: z.array(z.string()),
  /** The file the Agent skills section is added to, when it has none. */
  section: z.object({ path: z.string() }).nullable(),
  /** The triage labels it has none of on GitHub, made only when its work lives there. */
  labels: z.array(z.string()),
  /** No Paper file yet, and Courtyard can make one: its name, with the four pages (optional). */
  paper: z.object({ name: z.string() }).nullable(),
});
export type SetupCard = z.infer<typeof SetupCard>;

/** What happened to the Paper line once set up (#323). */
export const SetupPaper = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("made"), name: z.string() }),
  z.object({ kind: z.literal("skipped") }),
  /** Paper couldn't make it (it isn't open, say): the rest was set up all the same. */
  z.object({ kind: z.literal("failed"), reason: z.string() }),
]);
export type SetupPaper = z.infer<typeof SetupPaper>;

/** A code workspace's setup card, as its page shows it. */
export const MattSetup = z.discriminatedUnion("state", [
  /** Something moves it to the house standard: offered as one card. */
  z.object({ state: z.literal("offered"), card: SetupCard }),
  /** Nothing to offer: it's standard already, the owner answered, or it can't be checked. */
  z.object({ state: z.literal("none") }),
  /**
   * The owner set it up: the pull request with the files, if any, the labels made, the issues
   * filed from its old tracker, and its Paper file.
   */
  z.object({
    state: z.literal("opened"),
    pullRequest: z.object({ number: z.number().int().positive(), url: z.url() }).nullable(),
    labelsMade: z.array(z.string()),
    issuesFiled: z.number().int().nonnegative(),
    paper: SetupPaper,
  }),
]);
export type MattSetup = z.infer<typeof MattSetup>;

/**
 * The owner's answer to the setup card: Not now, or Set up with a choice on each line that has
 * one. A line left out takes what the card recommends.
 */
export const MattSetupAnswer = z.discriminatedUnion("answer", [
  z.object({ answer: z.literal("not-now") }),
  z.object({
    answer: z.literal("allow"),
    tracker: z.enum(["keep", "move"]).optional(),
    glossary: z.enum(["rename", "keep"]).optional(),
    paper: z.enum(["create", "skip"]).optional(),
  }),
]);
export type MattSetupAnswer = z.infer<typeof MattSetupAnswer>;

/** How many lines a setup card has, as Needs you counts them ("4 things to set up"). */
export const setupLines = (card: SetupCard) =>
  [card.tracker, card.glossary, card.section, card.paper].filter((line) => line !== null).length +
  (card.files.length > 0 ? 1 : 0) +
  (card.labels.length > 0 ? 1 : 0);
