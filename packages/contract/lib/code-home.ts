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
 * one that needs grilling first (#363, #463), not `ready`. A ready
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
 * Why GitHub couldn't be read just now (#519), when it couldn't: what's shown is then the last
 * known, read `asOf` (`null` when none is known yet).
 */
export const GitHubUnread = z.discriminatedUnion("kind", [
  /** GitHub's hourly allowance is used up, until `backAt`. */
  z.object({
    kind: z.literal("rate-limited"),
    backAt: z.iso.datetime(),
    asOf: z.iso.datetime().nullable(),
  }),
  /** It failed some other way. */
  z.object({ kind: z.literal("unreachable"), asOf: z.iso.datetime().nullable() }),
]);
export type GitHubUnread = z.infer<typeof GitHubUnread>;

/**
 * A code workspace's Next up (#301): its unclaimed ready issues and every one that needs grilling
 * first (#363, #463), in milestone order.
 */
export const NextUp = z.object({
  issues: z.array(NextUpIssue),
  /** Why GitHub couldn't be read just now (#519): `issues` are then the last known. */
  unread: z.optional(GitHubUnread),
});
export type NextUp = z.infer<typeof NextUp>;

/**
 * Where an issue on the Roadmap stands (#532), worked out once in the worker as Next up does:
 * closed (`done`); claimed, or closed by an open pull request (`building`); needing grilling first
 * (`to-grill`); waiting on the open issue titled `after` (`blocked`); else `ready`.
 */
export const RoadmapState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("building") }),
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("to-grill") }),
  z.object({ kind: z.literal("blocked"), after: z.string() }),
  z.object({ kind: z.literal("done") }),
]);
export type RoadmapState = z.infer<typeof RoadmapState>;

/**
 * One issue on the Roadmap (#532): its state, its summary (its description's first paragraph,
 * empty when it has none), and the Paper boards its description's Boards section names.
 */
export const RoadmapIssue = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url({ protocol: /^https$/ }),
  state: RoadmapState,
  summary: z.string(),
  boards: z.array(z.string()),
});
export type RoadmapIssue = z.infer<typeof RoadmapIssue>;

/** One open milestone on the Roadmap (#532): its issues in its Build order, done ones last. */
export const RoadmapMilestone = z.object({
  title: z.string(),
  issues: z.array(RoadmapIssue),
});
export type RoadmapMilestone = z.infer<typeof RoadmapMilestone>;

/** A code workspace's Roadmap (#532): every open milestone in the roadmap's order, Later last. */
export const Roadmap = z.object({
  milestones: z.array(RoadmapMilestone),
  /** Why GitHub couldn't be read just now (#519): `milestones` are then the last known. */
  unread: z.optional(GitHubUnread),
});
export type Roadmap = z.infer<typeof Roadmap>;

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
 * the model its own conversation last used, each allowing all until its pull request opens
 * (#428, #591). It keeps going until the owner pauses it (#591).
 */
export const LeadRun = BuildIssue;
export type LeadRun = z.infer<typeof LeadRun>;

/** How many builders the Lead runs at once (#347, #591): 2 unless the owner says 1. */
export const LEAD_BUILDERS = { atLeast: 1, byDefault: 2, atMost: 2 } as const;

/** A builder the Lead started (#347): its session, its title, and the issue it builds. */
export const LeadBuilder = z.object({
  session: SessionId,
  title: z.string(),
  issue: z.number().int().positive(),
});
export type LeadBuilder = z.infer<typeof LeadBuilder>;

/**
 * Where a Lead's builder stands (#590, ADR 0031), as the worker records it as things happen, each
 * with when it began: the model working (`building`); a check running, or waiting `ahead` for its
 * place in the machine's builds lock (`checking`); waiting on the owner's answer, to its approval
 * (by event number) or to a question it asked (`waiting-on-you`); at the usage limit until
 * `resetAt` (`waiting-for-limit`); its pull request's checks running (`in-ci`); ready for the
 * owner's review (`ready-for-review`); `merged`; or `stuck`, Courtyard having given up, saying why.
 * A failing check is `building` again, as the builder fixes it.
 */
export const BuilderStatus = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("building"), since: z.iso.datetime() }),
  z.object({
    kind: z.literal("checking"),
    since: z.iso.datetime(),
    command: z.string(),
    ahead: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("waiting-on-you"),
    since: z.iso.datetime(),
    approval: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("waiting-for-limit"),
    since: z.iso.datetime(),
    resetAt: z.iso.datetime().optional(),
  }),
  z.object({
    kind: z.literal("in-ci"),
    since: z.iso.datetime(),
    pullRequest: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("ready-for-review"),
    since: z.iso.datetime(),
    pullRequest: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("merged"),
    since: z.iso.datetime(),
    pullRequest: z.number().int().positive(),
  }),
  z.object({ kind: z.literal("stuck"), since: z.iso.datetime(), reason: z.string() }),
]);
export type BuilderStatus = z.infer<typeof BuilderStatus>;

/** One of the Lead's builders with its status (#590), while the Lead keeps it. */
export const LeadBuilderStatus = LeadBuilder.extend({ status: BuilderStatus });
export type LeadBuilderStatus = z.infer<typeof LeadBuilderStatus>;

/** A builder's pull request that's ready to merge (#347): checks passed, no conflict. */
export const LeadReady = LeadBuilder.extend({ pullRequest: z.number().int().positive() });
export type LeadReady = z.infer<typeof LeadReady>;

/**
 * Merge in order, tapped (#423): the builders' pull requests the owner's screen showed ready, by
 * number. The tap is the owner's OK for those only.
 */
export const LeadMergeRequest = z.object({
  pullRequests: z.array(z.number().int().positive()).min(1),
});
export type LeadMergeRequest = z.infer<typeof LeadMergeRequest>;

/** A ready issue the Lead holds back (#423), behind the builder's issue changing the same files. */
export const LeadHeldBack = z.object({
  issue: z.number().int().positive(),
  behind: z.number().int().positive(),
});
export type LeadHeldBack = z.infer<typeof LeadHeldBack>;

/**
 * Merge in order (#423), while the Lead does it: merging, with the pull request it's on now (it
 * waits for its checks, or for its session to bring it up to date), or stopped at one, and why.
 */
export const LeadMerge = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("merging"), pullRequest: z.number().int().positive() }),
  z.object({
    kind: z.literal("stopped"),
    pullRequest: z.number().int().positive(),
    why: z.string(),
  }),
]);
export type LeadMerge = z.infer<typeof LeadMerge>;

/**
 * How many of its builders' pull requests wait for the owner's review before the Lead starts no
 * more (#591).
 */
export const LEAD_REVIEWS_AT_MOST = 4;

/**
 * One reason a running Lead starts no more builders now (#592, ADR 0031), as the Builders board
 * lists them, every one at once: `LEAD_REVIEWS_AT_MOST` of its builders' pull requests waiting for
 * the owner's review; a builder's model at its usage limit, `until` its reset; main red, so only its
 * fix starts; or the owner's own sessions using the machine's last place.
 */
export const LeadHolding = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reviews"), waiting: z.number().int().positive() }),
  z.object({ kind: z.literal("limit"), until: z.iso.datetime() }),
  z.object({ kind: z.literal("main-red") }),
  z.object({ kind: z.literal("own-sessions") }),
]);
export type LeadHolding = z.infer<typeof LeadHolding>;

/**
 * A code workspace's Lead (#347), as its Home's Builders board (#592) and its chat's strip show it: not
 * started yet; running the build order (`why` saying what it waits for while it holds itself back:
 * 4 pull requests waiting for the owner's review, a model at its usage limit, a red main, the
 * machine busy with the owner's own sessions; #591); paused by the owner; or resting, with nothing
 * ready to build in a numbered milestone (`why` says so), until something is. Its builders still
 * building, the next issues it starts, and the pull requests ready to merge.
 */
export const LeadStatus = z.object({
  state: z.enum(["not-started", "running", "paused", "resting"]),
  session: SessionId.optional(),
  why: z.string().optional(),
  builders: z.number().int().min(LEAD_BUILDERS.atLeast).max(LEAD_BUILDERS.atMost),
  building: z.array(LeadBuilder),
  /**
   * Each builder the Lead keeps, with its status as the worker recorded it (#590): one it started
   * before statuses were kept has none until something happens in it.
   */
  statuses: z.array(LeadBuilderStatus),
  next: z.array(NextUpIssue),
  ready: z.array(LeadReady),
  /**
   * Its builders' pull requests merged that it hasn't tidied up after yet (#591): a paused Lead
   * takes no turn of its own, so it does once it runs again.
   */
  toTidy: z.number().int().nonnegative(),
  /** Merge in order (#423), while it's merging or stopped. */
  merge: LeadMerge.optional(),
  /**
   * While it runs, every reason it starts no more builders now (#592), never only the first; none
   * while nothing holds it back.
   */
  holding: z.array(LeadHolding).optional(),
  /**
   * Ready issues it holds back (#423), each behind the builder's issue that changes the same
   * files: it starts once that one merges.
   */
  heldBack: z.array(LeadHeldBack).optional(),
});
export type LeadStatus = z.infer<typeof LeadStatus>;

/**
 * The hash on a code workspace's Home that puts a builder's row on its Builders board in view
 * (#593), as a notification about it opens it: `builder-<session>`.
 */
export const builderHash = (session: SessionId) => `builder-${session}`;

/** The builder whose row a Home's hash puts in view (#593), or none for any other hash. */
export const builderIn = (hash: string): SessionId | undefined => {
  const session = SessionId.safeParse(/^builder-(.+)$/.exec(hash)?.[1]);
  return session.success ? session.data : undefined;
};
