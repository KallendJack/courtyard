import { z } from "zod";
import { Attachment } from "./attachment.ts";
import { SkillName, SkillSource } from "./skill-name.ts";
import {
  CONTEXT_SECTION_NAMES,
  ContextLine,
  ContextSection,
  OwnerSection,
  WorkspaceId,
} from "./workspace.ts";

export const ProviderId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .brand<"ProviderId">();
export type ProviderId = z.infer<typeof ProviderId>;

/** A model's id within its provider, such as 'echo'. */
export const ModelId = z.string().min(1).brand<"ModelId">();
export type ModelId = z.infer<typeof ModelId>;

/** One model of one provider: what a message asks to answer it. */
export const ModelRef = z.object({ provider: ProviderId, model: ModelId });
export type ModelRef = z.infer<typeof ModelRef>;

/** One of the levels of effort a provider offers for a model, by the provider's own name, such as 'xhigh'. */
export const Effort = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .brand<"Effort">();
export type Effort = z.infer<typeof Effort>;

/** A level of effort a model takes, and its name in the provider's own words ("Extra high"). */
export const EffortInfo = z.object({ id: Effort, label: z.string() });
export type EffortInfo = z.infer<typeof EffortInfo>;

/**
 * A usage limit a model is at: it stops answering until its reset time, when the provider says
 * one. The worker remembers it until then.
 */
export const UsageLimit = z.object({ resetAt: z.iso.datetime().optional() });
export type UsageLimit = z.infer<typeof UsageLimit>;

export const ModelInfo = z.object({
  id: ModelId,
  label: z.string(),
  /** The levels of effort it takes, least first; none when it takes no effort at all. */
  efforts: z.array(EffortInfo),
  /** The level it uses when a message names none, when the provider says. */
  defaultEffort: Effort.optional(),
  /** Its usage limit, while it's at one. It's still offered: a reset time can be an estimate. */
  limit: UsageLimit.optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/** Whether a model takes this level of effort. `undefined`, its default, every model takes. */
export const takesEffort = (
  model: { readonly efforts: readonly EffortInfo[] },
  effort: Effort | undefined,
) => effort === undefined || model.efforts.some((level) => level.id === effort);

/** What a provider can do. These drive the rules, not provider names. */
export const Capabilities = z.object({
  readsFiles: z.boolean(),
  codes: z.boolean(),
  usesTools: z.boolean(),
  /** Offers the save tool, so it can save to context as it answers (ADR 0013). */
  savesContext: z.boolean(),
  /** Searches the web, and reads the pages it finds, in a planning workspace (ADR 0019). */
  searchesWeb: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const ProviderStatus = z.discriminatedUnion("available", [
  z.object({
    id: ProviderId,
    label: z.string(),
    available: z.literal(true),
    models: z.array(ModelInfo),
    capabilities: Capabilities,
  }),
  z.object({
    id: ProviderId,
    label: z.string(),
    available: z.literal(false),
    reason: z.string(),
    /** Unavailable only because it isn't signed in, which the owner can do from the home page. */
    signedOut: z.boolean().optional(),
  }),
]);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const ProviderList = z.object({ providers: z.array(ProviderStatus) });
export type ProviderList = z.infer<typeof ProviderList>;

/** One change in the context folder's history, by its git commit. */
export const ChangeId = z
  .string()
  .regex(/^[0-9a-f]{40}$/)
  .brand<"ChangeId">();
export type ChangeId = z.infer<typeof ChangeId>;

export const SessionId = z.uuid().brand<"SessionId">();
export type SessionId = z.infer<typeof SessionId>;

/** The longest message accepted. */
export const MAX_MESSAGE_LENGTH = 20_000;

/**
 * What the owner sends: a message, the model to answer it, its effort (none for the default), and
 * the skill they started with it, if any (ADR 0016).
 */
export const NewMessage = z.object({
  text: z.string().trim().min(1, "Write something first").max(MAX_MESSAGE_LENGTH),
  model: ModelRef,
  effort: Effort.optional(),
  skill: SkillName.optional(),
});
export type NewMessage = z.infer<typeof NewMessage>;

/**
 * A new session's first message. With no model named, the worker starts it on the first model
 * that isn't at its usage limit, at its default effort.
 */
export const FirstMessage = NewMessage.extend({ model: ModelRef.optional() }).refine(
  (message) => message.model !== undefined || message.effort === undefined,
  { message: "Name the model the effort is for", path: ["effort"] },
);
export type FirstMessage = z.infer<typeof FirstMessage>;

/**
 * Get to know a workspace or the owner context: a new session whose first message is the
 * worker's starter (docs/ai-conduct.md), answered by this model. With no model named, the worker
 * starts it on the first model that saves to context and isn't at its usage limit.
 */
export const GetToKnowRequest = z.object({ model: ModelRef.optional() });
export type GetToKnowRequest = z.infer<typeof GetToKnowRequest>;

/** Grill this plan: a new session grilling one of a workspace's plans, answered as Get to know is. */
export const GrillRequest = GetToKnowRequest.extend({ plan: NewMessage.shape.text });
export type GrillRequest = z.infer<typeof GrillRequest>;

export const SessionSummary = z.object({
  id: SessionId,
  workspaceId: WorkspaceId,
  /**
   * The start of the session's first message, until a model titles it after its first answer; or
   * the title the owner gave it.
   */
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Whether a turn is running right now. */
  busy: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** One session, as its page opens it. */
export const SessionDetail = SessionSummary.extend({
  /** Its workspace is archived, so the session can be read but not carried on. */
  workspaceArchived: z.boolean(),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

/** The longest title a session can be given. */
export const SESSION_TITLE_MAX_LENGTH = 60;

/** Changing a session from the app. */
export const SessionChange = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the session a title.")
    .max(SESSION_TITLE_MAX_LENGTH, `Keep the title to ${SESSION_TITLE_MAX_LENGTH} characters.`),
});
export type SessionChange = z.infer<typeof SessionChange>;

export const SessionList = z.object({ sessions: z.array(SessionSummary) });
export type SessionList = z.infer<typeof SessionList>;

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
  /** A web page it read, by its address. */
  z.object({ kind: z.literal("page-read"), url: z.string() }),
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

/** Which file a line is written in: the workspace's context file, or the owner context (ADR 0013). */
export const LinePlace = z.enum(["workspace", "owner"]);
export type LinePlace = z.infer<typeof LinePlace>;

/**
 * A line where it's written: its place and its section. Saves recorded before the owner context
 * could be saved to have no place: they're the workspace's. That default is why this is a plain
 * union rather than a discriminated one, which can't default its discriminator; the type it
 * gives is still discriminated by `place`.
 */
export const PlacedLine = z.union([
  z.object({
    place: z.literal("workspace").default("workspace"),
    section: ContextSection,
    line: z.string(),
  }),
  z.object({ place: z.literal("owner"), section: OwnerSection, line: z.string() }),
]);
export type PlacedLine = z.infer<typeof PlacedLine>;

/**
 * Where a line is, as the app names it: "Facts", or "Owner context → About me → Facts". Within the
 * owner context (its own Recent changes, say) its lines leave out "Owner context →".
 */
export const placeName = (
  placed: PlacedLine,
  options: { withinOwnerContext?: boolean } = {},
): string => {
  if (placed.place === "workspace") return CONTEXT_SECTION_NAMES[placed.section];
  const { section } = placed;
  const where =
    section === "answers" ? "How to answer me" : `About me → ${CONTEXT_SECTION_NAMES[section]}`;
  return options.withinOwnerContext ? where : `Owner context → ${where}`;
};

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

/** The owner editing a saved line from its note: its new wording, section and place. */
export const SaveEdit = z.discriminatedUnion("place", [
  z.object({ place: z.literal("workspace"), section: ContextSection, line: ContextLine }),
  z.object({ place: z.literal("owner"), section: OwnerSection, line: ContextLine }),
]);
export type SaveEdit = z.infer<typeof SaveEdit>;

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

/**
 * What a stop request names: the turn to stop, by its owner message's event number, so a stop
 * that arrives late can never stop the turn after it.
 */
export const StopRequest = z.object({ turn: z.number().int().positive() });
export type StopRequest = z.infer<typeof StopRequest>;

/** What Carry on names: the turn that hit the usage limit, by its owner message's event number. */
export const CarryOnRequest = z.object({ turn: z.number().int().positive() });
export type CarryOnRequest = z.infer<typeof CarryOnRequest>;
