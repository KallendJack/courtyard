import { z } from "zod";
import { AlwaysAllow, AlwaysFor, ApprovalAnswer, ApprovalAsk } from "./approval.ts";
import { Attachment, PhotoAttachment } from "./attachment.ts";
import { ChangeId } from "./change-id.ts";
import { DocumentSlug } from "./documents.ts";
import { ProjectSave } from "./projects.ts";
import { PullRequest, WorktreeKeptWhy } from "./pull-request.ts";
import { Effort, ModelRef, PlacedLine } from "./session.ts";
import { SkillName, SkillSource } from "./skill-name.ts";
import { TaskEnding, TaskId } from "./tasks.ts";
import { ThingSave } from "./things.ts";

// A session's events (ADR 0006) and what they carry. Apart from `session.ts`, whose summaries the
// home page needs, so only the session page loads these.

/** Why a turn ended without an answer. */
export const FailureReason = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rate-limited"), resetAt: z.iso.datetime().optional() }),
  z.object({ kind: z.literal("provider-unavailable"), message: z.string() }),
  z.object({ kind: z.literal("unknown"), message: z.string() }),
  /**
   * The worker stopped while the turn was running: cut off by a restart (an Update, a crash, the
   * PC restarting). Continue carries it on (#186).
   */
  z.object({ kind: z.literal("interrupted") }),
]);
export type FailureReason = z.infer<typeof FailureReason>;

/**
 * A helper a code session's model started (#117, ADR 0027): one of its provider's own sub-agents,
 * by the id its provider gave it, unique in its turn.
 */
export const HelperId = z.string().min(1).brand<"HelperId">();
export type HelperId = z.infer<typeof HelperId>;

/** What a model is doing during a turn, shown to the owner as it happens. */
export const Activity = z.discriminatedUnion("kind", [
  /** A file it read, as a path inside the workspace folder. */
  z.object({ kind: z.literal("read-file"), path: z.string() }),
  /** A skill it loaded itself, and where the skill came from (ADR 0016). */
  z.object({ kind: z.literal("skill-loaded"), name: SkillName, source: SkillSource }),
  /** One of a skill's own files it read, as a path inside the skill's folder. */
  z.object({ kind: z.literal("skill-file-read"), name: SkillName, path: z.string() }),
  /** A web search it made, by what it searched for (ADR 0019). */
  z.object({ kind: z.literal("web-searched"), query: z.string() }),
  /** A web page it read, by its address, and its site as the chat names it (its host). */
  z.object({ kind: z.literal("page-read"), url: z.string(), site: z.string() }),
  /**
   * A file it changed or added in a code session's worktree, as a path inside it (ADR 0007); or
   * outside it, once the owner allowed that (#171), by its full path.
   */
  z.object({ kind: z.literal("edited-file"), path: z.string() }),
  /** A command it ran in a code session's worktree, exactly as it ran it (ADR 0007). */
  z.object({ kind: z.literal("ran-command"), command: z.string() }),
  /**
   * A heavy check it's about to run (`pnpm verify`, say) waits in the worker's builds queue
   * (#281), with this many builds ahead of it: those running, and those waiting before it.
   */
  z.object({ kind: z.literal("waiting-for-build"), ahead: z.number().int().positive() }),
  /** It updated its task list for the work, in a code session (ADR 0025). */
  z.object({ kind: z.literal("updated-tasks") }),
  /** A check that failed on the session's pull request, which the turn is fixing (#172). */
  z.object({ kind: z.literal("check-failed"), name: z.string() }),
  /** An action of a tool connection it took (ADR 0008), by the connection's name and the action's. */
  z.object({ kind: z.literal("used-tool"), connection: z.string(), action: z.string() }),
]);
export type Activity = z.infer<typeof Activity>;

/** The most sources one answer lists. */
export const SOURCES_MAX = 20;

/**
 * A web page an answer used (ADR 0019): its site's name, its title (empty when it isn't known)
 * and its address, which is only ever a web page's.
 */
export const Source = z.object({
  site: z.string().min(1),
  title: z.string(),
  url: z.url({ protocol: /^https?$/ }),
});
export type Source = z.infer<typeof Source>;

/**
 * What one save did (ADR 0013): a line added, a line changed (and perhaps moved to another
 * section or place, as a plan becomes a fact), or a line removed.
 */
export const Save = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), saved: PlacedLine }),
  z.object({ action: z.literal("change"), saved: PlacedLine, replaced: PlacedLine }),
  z.object({ action: z.literal("remove"), replaced: PlacedLine }),
]);
export type Save = z.infer<typeof Save>;

/**
 * What one document save did (ADR 0020): a new document saved, or one updated with its whole new
 * text, by its file's name and its name then.
 */
export const DocumentSave = z.object({
  action: z.enum(["save", "update"]),
  document: z.object({ slug: DocumentSlug, name: z.string() }),
  /** For an update: what changed, in a few words, as the model said. */
  summary: z.string().optional(),
});
export type DocumentSave = z.infer<typeof DocumentSave>;

/** How many suggested replies a model offers at once, at least and at most (ADR 0017). */
export const SUGGESTED_REPLIES = { atLeast: 2, atMost: 3 } as const;

/** The longest suggested reply: a few words, on one line on a phone. */
export const SUGGESTED_REPLY_MAX_CHARACTERS = 60;

const eventBase = { seq: z.number().int().positive(), at: z.iso.datetime() };

/** One recorded thing that happened in a session, numbered from 1 with no gaps (ADR 0006). */
export const SessionEvent = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("owner-message"),
    text: z.string(),
    model: ModelRef,
    /** The effort it was sent with; none for the model's default. */
    effort: Effort.optional(),
    /** The skill the owner started with it, which stays in use for the rest of the session. */
    skill: SkillName.optional(),
    /** The photos and PDFs it carries, kept in the session's folder (#78). */
    attachments: z.array(Attachment).optional(),
    /**
     * Sent by the worker, not the owner (#172): the session's pull request's checks failed on
     * its commit `head`, and the message asks the model to fix them or say why it can't.
     */
    checksFailed: z
      .object({
        pullRequest: z.number().int().positive(),
        head: z.string(),
        checks: z.array(z.string()).min(1),
      })
      .optional(),
    /**
     * Sent by the worker, not the owner (#382): the session's pull request conflicted with its
     * base on its commit `head`, and the message asks the model to bring it up to date.
     */
    conflicted: z
      .object({
        pullRequest: z.number().int().positive(),
        head: z.string(),
      })
      .optional(),
    /** Sent from the queue (#177): the queued message, by its event number, it sends. */
    queued: z.number().int().positive().optional(),
    /**
     * Sent by the worker, not the owner, to a code workspace's Lead (#347): one of its builders'
     * pull requests merged, and the message asks it to move its boards and keep the plan current.
     */
    merged: z.object({ pullRequest: z.number().int().positive() }).optional(),
    /** The owner's tap on Run the build order, which started a code workspace's Lead (#347). */
    runsBuildOrder: z.literal(true).optional(),
    /**
     * Continue (#186): the turn numbered `turn` was cut off by a restart, and the message, the
     * worker's words, tells the model to carry on from where it was. Sent by the owner's tap, or
     * by the worker after an Update now.
     */
    continues: z.object({ turn: z.number().int().positive() }).optional(),
    /**
     * Sent by the worker, not the owner (#182): these tasks finished or failed while no turn ran,
     * and the message tells the model so.
     */
    tasksEnded: z.array(TaskId).min(1).optional(),
    /**
     * Sent by the worker, not the owner, to a Lead's builder (#590): its turn ended with no pull
     * request and no question, and the message tells it to carry on, once.
     */
    carriesOn: z.literal(true).optional(),
    /**
     * Sent by the worker, not the owner, to a Lead's builder (#610): the usage limit its last turn
     * met has reset, and the message tells it to carry on.
     */
    afterLimit: z.literal(true).optional(),
  }),
  /**
   * The model started a long command as a task (#182): it runs on after the turn, its output kept
   * in the session's folder, never here. Or the owner did, with Start preview (`preview`, #183):
   * its end tells nobody.
   */
  z.object({
    ...eventBase,
    type: z.literal("task-started"),
    task: TaskId,
    command: z.string(),
    preview: z.literal(true).optional(),
  }),
  /** A task ended, here in the conversation: passed, failed, or stopped and by what (#182). */
  z.object({ ...eventBase, type: z.literal("task-ended"), task: TaskId, ending: TaskEnding }),
  /**
   * What the worker did for a code workspace's Lead as it ran the build order (#347), in its
   * words: a builder started, a pull request ready to merge, holding back and why. Shown in the
   * Lead's chat as its own.
   */
  z.object({ ...eventBase, type: z.literal("lead-note"), text: z.string() }),
  /**
   * A message the owner sent while a turn ran (#177): it waits, in order behind any queued before
   * it, and goes as soon as the session can take a turn, unless the owner removes it first.
   */
  z.object({
    ...eventBase,
    type: z.literal("message-queued"),
    text: z.string(),
    model: ModelRef,
    effort: Effort.optional(),
    skill: SkillName.optional(),
    /** The photos and PDFs it carries, kept in the session's folder already (#78). */
    attachments: z.array(Attachment).optional(),
  }),
  /** The owner removed the queued message numbered `queued` before it went. */
  z.object({
    ...eventBase,
    type: z.literal("queued-message-removed"),
    queued: z.number().int().positive(),
  }),
  /**
   * A message the owner sent while a turn ran, on a provider that steers (#252): it went into
   * that answer where it was sent, for the model to read at its next step, and the answer carries
   * on below it. `afterApproval` when an approval waited as it was sent: it goes in once the owner
   * has answered that, and never answers it.
   */
  z.object({
    ...eventBase,
    type: z.literal("message-added"),
    text: z.string(),
    afterApproval: z.literal(true).optional(),
    /**
     * Added by the worker, not the owner (#182): this task finished or failed while the turn ran,
     * and the message tells the model so.
     */
    task: TaskId.optional(),
  }),
  /** The turn ended, stopped say, before its model read the added message numbered `added` (#252). */
  z.object({
    ...eventBase,
    type: z.literal("added-not-read"),
    added: z.number().int().positive(),
  }),
  z.object({ ...eventBase, type: z.literal("text-delta"), text: z.string() }),
  z.object({
    ...eventBase,
    type: z.literal("activity"),
    activity: Activity,
    /** The helper doing it (#117), or none for the model itself. */
    helper: HelperId.optional(),
    /** It ran without asking because the session was allowing all (#428): "ran under Allow all". */
    allowedAll: z.literal(true).optional(),
  }),
  /**
   * The model started a helper (#117, ADR 0027), named by the description the model gave it, or
   * by its type without one. Everything it does is recorded as the model's is, tagged with it.
   * One that waits for a place, as many helpers as run at once are running, says so, and is
   * recorded again without it once it has one.
   */
  z.object({
    ...eventBase,
    type: z.literal("helper-started"),
    helper: HelperId,
    name: z.string(),
    waiting: z.literal(true).optional(),
  }),
  /**
   * A helper that writes code was given a worktree and branch of its own (#395), branched from
   * the session branch, which the worker merges back when it finishes.
   */
  z.object({
    ...eventBase,
    type: z.literal("helper-branched"),
    helper: HelperId,
    branch: z.string(),
  }),
  /**
   * A helper finished, with its final report to the model. One on its own branch (#395) says
   * whether its branch merged back into the session branch, or clashed and was kept for the
   * session's model to sort.
   */
  z.object({
    ...eventBase,
    type: z.literal("helper-finished"),
    helper: HelperId,
    report: z.string(),
    merged: z.boolean().optional(),
  }),
  z.object({ ...eventBase, type: z.literal("turn-completed") }),
  /** The owner stopped the turn; whatever was written before stays. */
  z.object({ ...eventBase, type: z.literal("turn-stopped") }),
  z.object({ ...eventBase, type: z.literal("turn-failed"), reason: FailureReason }),
  /**
   * The turn, in a code session, waits for a place: as many code sessions as run at once are
   * running (`CODE_SESSIONS_AT_ONCE`), and it starts when one of theirs ends. Recorded again each
   * time it moves up (#362), with how many turns wait ahead of it (absent before #362).
   */
  z.object({
    ...eventBase,
    type: z.literal("turn-queued"),
    ahead: z.number().int().nonnegative().optional(),
  }),
  /** The turn that waited has started. */
  z.object({ ...eventBase, type: z.literal("turn-dequeued") }),
  /** A save the model made during the turn, already in the context file. */
  z.object({
    ...eventBase,
    type: z.literal("context-saved"),
    save: Save,
    /** The change it was committed as, so Recent changes can find it (absent before #50). */
    change: z.optional(ChangeId),
  }),
  /** The owner undid the save numbered `save`, whenever and from wherever they did it. */
  z.object({ ...eventBase, type: z.literal("context-undone"), save: z.number().int().positive() }),
  /**
   * The owner chose Carry on after a usage limit: the session moves to this model, at its default
   * effort, and the failed turn's message is sent to it again.
   */
  z.object({ ...eventBase, type: z.literal("model-changed"), model: ModelRef }),
  /** The owner edited the save numbered `save`: its line is now `now`. */
  z.object({
    ...eventBase,
    type: z.literal("context-edited"),
    save: z.number().int().positive(),
    now: PlacedLine,
  }),
  /**
   * A document saved: by the model during the turn, or by the owner with Save as document, from
   * the answer to their message numbered `answer`.
   */
  z.object({
    ...eventBase,
    type: z.literal("document-saved"),
    save: DocumentSave,
    /** The change it was committed as, which Undo reverses; absent when git couldn't keep it. */
    change: z.optional(ChangeId),
    answer: z.number().int().positive().optional(),
  }),
  /** The owner undid the document save numbered `save`, whenever and from wherever they did it. */
  z.object({ ...eventBase, type: z.literal("document-undone"), save: z.number().int().positive() }),
  /** A Thing the model saved during the turn: added, changed or removed (ADR 0020). */
  z.object({
    ...eventBase,
    type: z.literal("thing-saved"),
    save: ThingSave,
    /** The change it was committed as, which Undo reverses; absent when git couldn't keep it. */
    change: z.optional(ChangeId),
  }),
  /** The owner undid the Thing save numbered `save`, whenever and from wherever they did it. */
  z.object({ ...eventBase, type: z.literal("thing-undone"), save: z.number().int().positive() }),
  /** A project the model started or changed during the turn (#603). */
  z.object({
    ...eventBase,
    type: z.literal("project-saved"),
    save: ProjectSave,
    /** The change it was committed as, which Undo reverses; absent when git couldn't keep it. */
    change: z.optional(ChangeId),
  }),
  /** The owner undid the project save numbered `save`, whenever and from wherever they did it. */
  z.object({ ...eventBase, type: z.literal("project-undone"), save: z.number().int().positive() }),
  /** A model gave the session this title after its first answer, in place of the first line. */
  z.object({ ...eventBase, type: z.literal("session-titled"), title: z.string() }),
  /** Replies the model offered the owner to tap, with the answer it's writing (ADR 0017). */
  z.object({ ...eventBase, type: z.literal("suggested-replies"), replies: z.array(z.string()) }),
  /** The web pages the answer used, listed under it as its Sources (ADR 0019). */
  z.object({
    ...eventBase,
    type: z.literal("sources"),
    sources: z.array(Source).min(1).max(SOURCES_MAX),
  }),
  /**
   * A code session's model wants to do something only the owner can allow (#171): the turn waits,
   * with no time limit, until they answer or stop it.
   */
  z.object({
    ...eventBase,
    type: z.literal("approval-requested"),
    ask: ApprovalAsk,
    /** What the model said it's for, when it said. */
    why: z.string().optional(),
    /** The helper asking (#117), or none for the model itself. */
    helper: HelperId.optional(),
    /** What Allow always would allow (#185), when it's offered: never for what must always ask. */
    always: AlwaysAllow.optional(),
    /** Allow all for this task (#428) would cover it, so the card offers turning it on. */
    all: z.literal(true).optional(),
  }),
  /** The session's pull request as it is now on GitHub, each time it changes (#172). */
  z.object({ ...eventBase, type: z.literal("pull-request"), pullRequest: PullRequest }),
  /**
   * An image a tool connection gave the model, shown in the chat: a screenshot of a Paper board,
   * say (ADR 0023), kept in the session's folder. By what it shows (a node of the board), so the
   * chat can show the newest of each.
   */
  z.object({
    ...eventBase,
    type: z.literal("image-shown"),
    connection: z.string(),
    of: z.string(),
    image: PhotoAttachment,
  }),
  /** The owner answered the approval numbered `approval`, from whichever device they did it. */
  z.object({
    ...eventBase,
    type: z.literal("approval-answered"),
    approval: z.number().int().positive(),
    answer: ApprovalAnswer,
    /** Allowed always (#185): until the session ends, or in the workspace. */
    always: AlwaysFor.optional(),
    /** Allowed because the owner turned on Allow all for this task while it waited (#428). */
    allowedAll: z.literal(true).optional(),
  }),
  /**
   * The owner turned on Allow all for this task (#428), from an approval or the session's menu, or
   * the Lead started the session with it: until `until` at most, and with `task`, until the
   * session opens its pull request or ends. Whether it's on now is decided from these events.
   */
  z.object({
    ...eventBase,
    type: z.literal("allow-all-started"),
    until: z.iso.datetime(),
    task: z.boolean(),
    /** The Lead gave it, at the builder's start or from its row (#551), so its Turn off takes it. */
    byLead: z.literal(true).optional(),
  }),
  /** The owner turned Allow all for this task off (#428) before it ran out. */
  z.object({ ...eventBase, type: z.literal("allow-all-ended") }),
  // Its worktree after 3 quiet days with no pull request (#605): cleared, what GitHub lacked on
  // `wip` first, until its next turn checks the branch out again (`restored`); or kept, and why.
  z.object({ ...eventBase, type: z.literal("worktree-cleared"), wip: z.string().optional() }),
  z.object({ ...eventBase, type: z.literal("worktree-kept"), why: WorktreeKeptWhy }),
  z.object({ ...eventBase, type: z.literal("worktree-restored") }),
]);
export type SessionEvent = z.infer<typeof SessionEvent>;

/** Whether an event ends its turn: completed, stopped by the owner, or failed. */
export const endsTurn = (event: SessionEvent) =>
  event.type === "turn-completed" || event.type === "turn-stopped" || event.type === "turn-failed";

/**
 * A session's queued messages that are still waiting (#177), first first: queued, and neither
 * removed nor sent yet.
 */
export const queuedIn = (events: readonly SessionEvent[]) => {
  const gone = new Set<number>();
  for (const event of events) {
    if (event.type === "queued-message-removed") gone.add(event.queued);
    if (event.type === "owner-message" && event.queued !== undefined) gone.add(event.queued);
  }
  return events.flatMap((event) =>
    event.type === "message-queued" && !gone.has(event.seq) ? [event] : [],
  );
};

/** A session's task (#182) as its events tell it: its command, when it started, and its end, once it has one. */
export type TaskTold = {
  readonly task: TaskId;
  readonly command: string;
  readonly startedAt: string;
  readonly ended: { readonly ending: TaskEnding; readonly at: string } | undefined;
  /** The owner started it with Start preview (#183), not the model. */
  readonly preview: boolean;
};

/** A session's tasks (#182), from its events, oldest first. */
export const tasksIn = (events: readonly SessionEvent[]): TaskTold[] => {
  const tasks = new Map<TaskId, TaskTold>();
  for (const event of events) {
    if (event.type === "task-started") {
      tasks.set(event.task, {
        task: event.task,
        command: event.command,
        startedAt: event.at,
        ended: undefined,
        preview: event.preview === true,
      });
    }
    const started = event.type === "task-ended" ? tasks.get(event.task) : undefined;
    if (event.type === "task-ended" && started !== undefined) {
      tasks.set(event.task, { ...started, ended: { ending: event.ending, at: event.at } });
    }
  }
  return [...tasks.values()];
};
