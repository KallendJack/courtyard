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
  SignInState,
} from "@courtyard/contract";
import { z } from "zod";
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
  /**
   * Courtyard's own tools this turn offers, such as the save tool (ADR 0013) and the use skill
   * tool (ADR 0016). Every provider offers each one in its own tool format, and hands each call to
   * the worker through `callTool`, which answers it.
   */
  readonly tools: readonly TurnTool[];
  /**
   * Courtyard's file tools, or `null` when the provider reads no files. Only a provider that
   * reads files through Courtyard offers them (Codex, ADR 0015); Claude reads with Claude Code's.
   */
  readonly fileTools: FileTools | null;
};

/** One of Courtyard's own tools as a model is told about it: its name, what it's for, and each input. */
export type CourtyardTool = {
  readonly name: string;
  readonly description: string;
  /** Each input by name, with what it means as its description. */
  readonly input: Readonly<Record<string, z.ZodType>>;
};

/**
 * The name a model calls each of Courtyard's tools that a turn can offer, and the worker answers:
 * the save tool (ADR 0013), the use skill tool (ADR 0016) and the suggest replies tool (ADR 0017).
 */
export type TurnToolName = "save_to_context" | "use_skill" | "suggest_replies";

/** One of Courtyard's tools that a turn can offer. */
export type TurnTool = CourtyardTool & { readonly name: TurnToolName };

/** Courtyard's tools for looking at the workspace's files, each confined to its folder. */
export type FileTools = {
  readonly list: CourtyardTool;
  readonly read: CourtyardTool;
  readonly search: CourtyardTool;
};

/** Part of what one of Courtyard's tools gives a model: text, or an image. */
export type ToolContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly dataUrl: string };

/**
 * What one of Courtyard's tools did, as the model is told: whether it did what was asked (a save
 * saved, a file was found), and what to say.
 */
export type ToolReply = { readonly ok: boolean; readonly content: readonly ToolContent[] };

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
   * Hands a call to one of the framing's `tools` to the worker, by the tool's name, its input
   * exactly as the model sent it. The worker checks it, does it, and says what to tell the model.
   */
  readonly callTool: (call: {
    readonly name: string;
    readonly input: unknown;
  }) => Promise<ToolReply>;
  /** Aborted when the owner stops the turn: the provider stops working as soon as it can. */
  readonly signal: AbortSignal;
};

/**
 * A one-off question outside any session, answered once in the shape `schema` describes, such as
 * a tidy's proposed changes. No tools, no files: the model has only what it's told.
 */
export type OneOffInput = {
  /** What it's for, so the fake can script its answer. */
  readonly purpose: "tidy" | "title";
  readonly model: ModelId;
  /** One of the levels of effort the model takes; left out for the model's default. */
  readonly effort?: Effort;
  /** Built by the prompts module, and delivered as given. */
  readonly instructions: string;
  readonly message: string;
  /** The answer's shape. The provider asks for it; the caller still checks what comes back. */
  readonly schema: z.ZodType;
  readonly signal: AbortSignal;
};

/**
 * A provider's sign-in, for a provider whose sign-in Courtyard handles (Codex's, ADR 0015). It
 * stays in the provider's own home: Courtyard only ever sees a sign-in's link and one-time code.
 */
export type SignIn = {
  /** What the owner signs in to, by name: "ChatGPT". */
  readonly service: string;
  readonly state: () => Promise<SignInState>;
  /** Starts a sign-in to finish on any device, or says why it couldn't. */
  readonly start: () => Promise<Result<SignInState, string>>;
  /** Gives up a sign-in in progress, or forgets one that didn't finish. */
  readonly cancel: () => Promise<void>;
  readonly signOut: () => Promise<Result<null, string>>;
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
  /** Its sign-in, when Courtyard handles it; Claude's is the worker machine's own. */
  readonly signIn?: SignIn;
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

/** Every model these providers offer right now, in order, each with its provider. */
export const modelsOnOffer = async (providers: readonly Provider[]) => {
  const offers = await Promise.all(
    providers.map(async (provider) => ({ provider, status: await provider.status() })),
  );
  return offers.flatMap(({ provider, status }) =>
    status.available ? status.models.map((model) => ({ provider, model })) : [],
  );
};

/** The first model with room: on offer and not at its usage limit. */
export const firstWithRoom = <T extends { model: ModelInfo }>(offered: readonly T[]) =>
  offered.find(({ model }) => model.limit === undefined);

/**
 * The first model on offer whose provider saves to context and isn't at its usage limit (the first
 * that saves, when every one is): what Get to know and Tidy use when no model is named.
 * `undefined` when no provider that saves is available.
 */
export const firstSavingModel = async (
  providers: readonly Provider[],
): Promise<ModelRef | undefined> => {
  const offered = await modelsOnOffer(
    providers.filter((provider) => provider.capabilities.savesContext),
  );
  const chosen = firstWithRoom(offered) ?? offered[0];
  return chosen && { provider: chosen.provider.id, model: chosen.model.id };
};

/** A schema as Claude Code and Codex's app-server take it: JSON Schema without the `$schema` line. */
export const jsonSchemaOf = (schema: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
};

export { createClaudeProvider } from "./claude.ts";
export { createCodexProvider } from "./codex.ts";
export { createFakeProvider } from "./fake.ts";
