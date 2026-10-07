import type {
  Activity,
  Capabilities,
  Effort,
  FailureReason,
  ModelId,
  ModelInfo,
  ModelRef,
  ProviderId,
  ProviderStatus,
} from "@courtyard/contract";
import type { z } from "zod";
import type { Result } from "../result.ts";

export type { Activity };

/** What a model is told for one turn, built by the prompts module (docs/ai-conduct.md). */
export type Framing = {
  /** Who the model is helping, what it may do, and the workspace's context file. */
  readonly instructions: string;
  /** What was said earlier in the session, then the owner's new message. */
  readonly message: string;
  /** The owner's new message on its own, for a provider that needs only that (the fake). */
  readonly newMessage: string;
  /** The save tool to offer, or `null` when this turn has none (ADR 0013). */
  readonly saveTool: SaveTool | null;
};

/** The save tool as a model is told about it: its name, what it's for, and each input. */
export type SaveTool = {
  readonly name: string;
  readonly description: string;
  /** Each input by name, with what it means as its description. */
  readonly input: Readonly<Record<string, z.ZodType>>;
};

/** What the worker made of a save: whether it saved, and what to tell the model. */
export type SaveReply = { readonly saved: boolean; readonly reply: string };

export type TurnInput = {
  /** The model to answer with, one of the provider's own. */
  readonly model: ModelId;
  /** One of the levels of effort the model takes, or `undefined` for the model's default. */
  readonly effort: Effort | undefined;
  /** The workspace's folder on the worker machine: the only place a model may look. */
  readonly folder: string;
  /** Delivered as given: a provider never writes prompt text of its own. */
  readonly framing: Framing;
  /** Hands over the next piece of the answer as it's written. */
  readonly emit: (text: string) => Promise<void>;
  /** Says what the model is doing, such as reading a file. */
  readonly report: (activity: Activity) => Promise<void>;
  /**
   * Hands a save to the worker, its input exactly as the model sent it. The worker checks it,
   * writes it, and says what to tell the model. Only for a framing with a save tool.
   */
  readonly save: (input: unknown) => Promise<SaveReply>;
  /** Aborted when the owner stops the turn: the provider stops working as soon as it can. */
  readonly signal: AbortSignal;
};

/**
 * A one-off question outside any session, answered once in the shape `schema` describes, such as
 * a tidy's proposed changes. No tools, no files: the model has only what it's told.
 */
export type OneOffInput = {
  /** What it's for, so the fake can script its answer. */
  readonly purpose: "tidy";
  readonly model: ModelId;
  /** Built by the prompts module, and delivered as given. */
  readonly instructions: string;
  readonly message: string;
  /** The answer's shape. The provider asks for it; the caller still checks what comes back. */
  readonly schema: z.ZodType;
  readonly signal: AbortSignal;
};

/**
 * A source of models: the one seam in the worker (AGENTS.md). Claude, Codex and the scripted fake
 * each sit behind it. A turn's failure is returned, never thrown.
 */
export type Provider = {
  readonly id: ProviderId;
  /** What its models can do, which decides what a turn tells them they may do. */
  readonly capabilities: Capabilities;
  readonly status: () => Promise<ProviderStatus>;
  readonly runTurn: (input: TurnInput) => Promise<Result<null, FailureReason>>;
  /** Answers a one-off question: the answer unparsed, or why there's none. */
  readonly answerOnce: (input: OneOffInput) => Promise<Result<unknown, FailureReason>>;
};

/**
 * The provider offering this model right now, and what it says of the model (its levels of
 * effort, say), or `undefined` when none is.
 */
export const offerFor = async (
  providers: readonly Provider[],
  ref: ModelRef,
): Promise<{ provider: Provider; model: ModelInfo } | undefined> => {
  const provider = providers.find((p) => p.id === ref.provider);
  if (!provider) return undefined;
  const status = await provider.status();
  const model = status.available ? status.models.find((m) => m.id === ref.model) : undefined;
  return model === undefined ? undefined : { provider, model };
};

export { createClaudeProvider } from "./claude.ts";
export { createCodexProvider } from "./codex.ts";
export { createFakeProvider } from "./fake.ts";
