import { z } from "zod";
import { LiveVersion, MainBuild } from "./live.ts";
import { Effort, ModelRef, SessionId } from "./session.ts";

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
 * One issue Next up offers (#301), by its number, title and address on GitHub, with its
 * milestone's title when it's in one: a `ready-for-agent` issue nobody has claimed (`ready`), or
 * one on its milestone's Build order line that needs grilling first (#363), not `ready`. A ready
 * one blocked by an open issue (#377) has its title as `after` (Next up says "After …"; it may be in
 * another repository, so only its title), and isn't built until that closes.
 */
export const NextUpIssue = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url({ protocol: /^https$/ }),
  milestone: z.string().nullable(),
  ready: z.boolean(),
  after: z.string().nullable(),
});
export type NextUpIssue = z.infer<typeof NextUpIssue>;

/**
 * Whether Next up offers an issue to build now (#377): ready, and blocked by no open issue. Decided
 * here once, for the worker's Build and Lead and the page's Build alike.
 */
export const buildable = (issue: NextUpIssue) => issue.ready && issue.after === null;

/**
 * A code workspace's Next up (#301): its unclaimed ready issues and those on a Build order line
 * that need grilling first (#363), in milestone order.
 */
export const NextUp = z.object({ issues: z.array(NextUpIssue) });
export type NextUp = z.infer<typeof NextUp>;

/**
 * A code workspace's main (#301's Main row): its newest commit on the default branch, and that
 * commit's build as #249's bar shows it (`null` when GitHub can't be asked or it has no checks).
 * `liveCopy` says the repository is the one this Courtyard's live copy runs from, the only one
 * Home offers Update on.
 */
export const WorkspaceMain = z.object({
  newest: LiveVersion,
  build: MainBuild.nullable(),
  liveCopy: z.boolean(),
});
export type WorkspaceMain = z.infer<typeof WorkspaceMain>;

/**
 * Build (#298): a new code session on this model builds the issue, and claims it on GitHub. Grill
 * (#363) takes the same: a new code session on this model grills an issue that isn't ready.
 */
export const BuildIssue = z.object({ model: ModelRef, effort: Effort.optional() });
export type BuildIssue = z.infer<typeof BuildIssue>;

/**
 * Run the build order (#347): the Lead starts, or wakes, on this model, and its builders start on
 * the model its own conversation last used. With Allow all for builders (#428), off unless the
 * owner turns it on, each builder it starts for the next `ALLOW_ALL_MOST_HOURS` allows all until
 * its pull request opens; `false` turns it off, and a wake that leaves it out keeps it as it was.
 */
export const LeadRun = BuildIssue.extend({ allowAll: z.boolean().optional() });
export type LeadRun = z.infer<typeof LeadRun>;

/** How many builders the Lead runs at once (#347): 2 unless the owner says, 1 to 3. */
export const LEAD_BUILDERS = { atLeast: 1, byDefault: 2, atMost: 3 } as const;

/** A builder the Lead started (#347): its session, its title, and the issue it builds. */
export const LeadBuilder = z.object({
  session: SessionId,
  title: z.string(),
  issue: z.number().int().positive(),
});
export type LeadBuilder = z.infer<typeof LeadBuilder>;

/** A builder's pull request that's ready to merge (#347): checks passed, no conflict. */
export const LeadReady = LeadBuilder.extend({ pullRequest: z.number().int().positive() });
export type LeadReady = z.infer<typeof LeadReady>;

/**
 * A code workspace's Lead (#347), as its Home's Running row and its chat's strip show it: not
 * started yet; running the build order (`why` saying what it waits for while it holds itself back:
 * a red main, the machine busy with the owner's own sessions, a decision only they can make);
 * paused by the owner; or resting, with nothing ready to build (`why` says so). Its builders still
 * building, the next issues it starts, and the pull requests ready to merge.
 */
export const LeadStatus = z.object({
  state: z.enum(["not-started", "running", "paused", "resting"]),
  session: SessionId.optional(),
  why: z.string().optional(),
  builders: z.number().int().min(LEAD_BUILDERS.atLeast).max(LEAD_BUILDERS.atMost),
  building: z.array(LeadBuilder),
  next: z.array(NextUpIssue),
  ready: z.array(LeadReady),
  /** Until when the builders it starts allow all (#428), while that's still ahead. */
  buildersAllowedAll: z.iso.datetime().optional(),
});
export type LeadStatus = z.infer<typeof LeadStatus>;
