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

const eventBase = { seq: z.number().int().positive(), at: z.iso.datetime() };

/** One recorded thing that happened in a session, numbered from 1 with no gaps (ADR 0006). */
export const SessionEvent = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("owner-message"), text: z.string(), model: ModelRef }),
  z.object({ ...eventBase, type: z.literal("text-delta"), text: z.string() }),
  z.object({ ...eventBase, type: z.literal("turn-completed") }),
  z.object({ ...eventBase, type: z.literal("turn-failed"), reason: FailureReason }),
]);
export type SessionEvent = z.infer<typeof SessionEvent>;
