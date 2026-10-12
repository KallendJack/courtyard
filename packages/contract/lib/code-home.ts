import { z } from "zod";
import { Effort, ModelRef } from "./session.ts";

// A code workspace's Home (#301) and its connections (#308): what its page asks for besides its
// sessions and pull requests. Only that page parses these, so they stay off the first load.

/**
 * Where a code workspace stands with GitHub (#99): connected, on its repository, as `owner/name`;
 * Courtyard not signed in to GitHub (or with no GitHub App set up), naming the repository when its
 * remote is on GitHub; or its remote not on GitHub at all.
 */
export const GitHubLink = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connected"), repo: z.string() }),
  z.object({ kind: z.literal("signed-out"), repo: z.string().optional() }),
  z.object({ kind: z.literal("not-on-github") }),
]);
export type GitHubLink = z.infer<typeof GitHubLink>;

/**
 * A code workspace's one Paper file (ADR 0023), by its id, with its name when Courtyard knows it
 * (connected from the page, #308); or none.
 */
export const PaperLink = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connected"), fileId: z.string(), name: z.string().optional() }),
  z.object({ kind: z.literal("none") }),
]);
export type PaperLink = z.infer<typeof PaperLink>;

/** A code workspace's connections (#308), as its connections line and sheet show them. */
export const WorkspaceConnections = z.object({ github: GitHubLink, paper: PaperLink });
export type WorkspaceConnections = z.infer<typeof WorkspaceConnections>;

/** The longest name a new Paper file can be given: a workspace's longest. */
const PAPER_FILE_NAME_MAX_LENGTH = 60;

/** One of the owner's Paper files, by its id and its name in Paper. */
export const PaperFile = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
});
export type PaperFile = z.infer<typeof PaperFile>;

/** The owner's Paper files, most recently changed first, for the Connections sheet to pick from. */
export const PaperFileList = z.object({ files: z.array(PaperFile) });
export type PaperFileList = z.infer<typeof PaperFileList>;

/** Connecting Paper from the Connections sheet (#308): a file picked, or a new one made. */
export const PaperConnecting = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), file: PaperFile }),
  z.object({
    kind: z.literal("new"),
    name: z.string().trim().min(1).max(PAPER_FILE_NAME_MAX_LENGTH),
  }),
]);
export type PaperConnecting = z.infer<typeof PaperConnecting>;

/**
 * One issue Next up offers (#301): a `ready-for-agent` issue nobody has claimed, by its number,
 * title and address on GitHub, with its milestone's title when it's in one.
 */
export const NextUpIssue = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url({ protocol: /^https$/ }),
  milestone: z.string().nullable(),
});
export type NextUpIssue = z.infer<typeof NextUpIssue>;

/** A code workspace's Next up (#301): its unclaimed ready issues, in milestone order. */
export const NextUp = z.object({ issues: z.array(NextUpIssue) });
export type NextUp = z.infer<typeof NextUp>;

/** Build (#298): a new code session on this model builds the issue, and claims it on GitHub. */
export const BuildIssue = z.object({ model: ModelRef, effort: Effort.optional() });
export type BuildIssue = z.infer<typeof BuildIssue>;
