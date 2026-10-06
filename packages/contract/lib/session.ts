import { z } from "zod";
import { WorkspaceId } from "./workspace.ts";

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

export const ModelInfo = z.object({ id: ModelId, label: z.string() });
export type ModelInfo = z.infer<typeof ModelInfo>;

/** What a provider can do. These drive the rules, not provider names. */
export const Capabilities = z.object({
  readsFiles: z.boolean(),
  codes: z.boolean(),
  usesTools: z.boolean(),
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
  }),
]);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const ProviderList = z.object({ providers: z.array(ProviderStatus) });
export type ProviderList = z.infer<typeof ProviderList>;

export const SessionId = z.uuid().brand<"SessionId">();
export type SessionId = z.infer<typeof SessionId>;

/** The longest message accepted. */
export const MAX_MESSAGE_LENGTH = 20_000;

/** What the owner sends: a message and the model to answer it. */
export const NewMessage = z.object({
  text: z.string().trim().min(1, "Write something first").max(MAX_MESSAGE_LENGTH),
  model: ModelRef,
});
export type NewMessage = z.infer<typeof NewMessage>;

export const SessionSummary = z.object({
  id: SessionId,
  workspaceId: WorkspaceId,
  /** The start of the session's first message. */
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
]);
export type Activity = z.infer<typeof Activity>;

const eventBase = { seq: z.number().int().positive(), at: z.iso.datetime() };

/** One recorded thing that happened in a session, numbered from 1 with no gaps (ADR 0006). */
export const SessionEvent = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("owner-message"), text: z.string(), model: ModelRef }),
  z.object({ ...eventBase, type: z.literal("text-delta"), text: z.string() }),
  z.object({ ...eventBase, type: z.literal("activity"), activity: Activity }),
  z.object({ ...eventBase, type: z.literal("turn-completed") }),
  /** The owner stopped the turn; whatever was written before stays. */
  z.object({ ...eventBase, type: z.literal("turn-stopped") }),
  z.object({ ...eventBase, type: z.literal("turn-failed"), reason: FailureReason }),
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
