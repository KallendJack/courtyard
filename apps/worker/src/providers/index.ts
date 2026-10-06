import type {
  Activity,
  Capabilities,
  FailureReason,
  ModelId,
  ProviderId,
  ProviderStatus,
} from "@courtyard/contract";
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
};

export type TurnInput = {
  /** The model to answer with, one of the provider's own. */
  readonly model: ModelId;
  /** The workspace's folder on the worker machine: the only place a model may look. */
  readonly folder: string;
  /** Delivered as given: a provider never writes prompt text of its own. */
  readonly framing: Framing;
  /** Hands over the next piece of the answer as it's written. */
  readonly emit: (text: string) => Promise<void>;
  /** Says what the model is doing, such as reading a file. */
  readonly report: (activity: Activity) => Promise<void>;
  /** Aborted when the owner stops the turn: the provider stops working as soon as it can. */
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
};

export { createClaudeProvider } from "./claude.ts";
export { createFakeProvider } from "./fake.ts";
