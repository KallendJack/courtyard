import { z } from "zod";
import { Attachment } from "./attachment.ts";
import { DocumentSlug } from "./documents.ts";
import { ChangeId, Effort, ModelRef, PlacedLine } from "./session.ts";
import { SkillName, SkillSource } from "./skill-name.ts";

// A session's events (ADR 0006) and what they carry. Apart from `session.ts`, whose summaries the
// home page needs, so only the session page loads these.

/** Why a turn ended without an answer. */
export const FailureReason = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rate-limited"), resetAt: z.iso.datetime().optional() }),
  z.object({ kind: z.literal("provider-unavailable"), message: z.string() }),
  z.object({ kind: z.literal("unknown"), message: z.string() }),
  /** The worker stopped while the turn was running. */
  z.object({ kind: z.literal("interrupted") }),
]);
export type FailureReason = z.infer<typeof FailureReason>;

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
  }),
  z.object({ ...eventBase, type: z.literal("text-delta"), text: z.string() }),
  z.object({ ...eventBase, type: z.literal("activity"), activity: Activity }),
  z.object({ ...eventBase, type: z.literal("turn-completed") }),
  /** The owner stopped the turn; whatever was written before stays. */
  z.object({ ...eventBase, type: z.literal("turn-stopped") }),
  z.object({ ...eventBase, type: z.literal("turn-failed"), reason: FailureReason }),
  /** A save the model made during the turn, already in the context file. */
  z.object({
    ...eventBase,
    type: z.literal("context-saved"),
    save: Save,
    /** The change it was committed as, so Recent changes can find it (absent before #50). */
    change: ChangeId.optional(),
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
    change: ChangeId.optional(),
    answer: z.number().int().positive().optional(),
  }),
  /** The owner undid the document save numbered `save`, whenever and from wherever they did it. */
  z.object({ ...eventBase, type: z.literal("document-undone"), save: z.number().int().positive() }),
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
]);
export type SessionEvent = z.infer<typeof SessionEvent>;

/** Whether an event ends its turn: completed, stopped by the owner, or failed. */
export const endsTurn = (event: SessionEvent) =>
  event.type === "turn-completed" || event.type === "turn-stopped" || event.type === "turn-failed";
