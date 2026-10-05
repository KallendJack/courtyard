import type {
  Activity,
  FailureReason,
  ModelId,
  ProviderId,
  ProviderStatus,
} from "@courtyard/contract";
import type { Result } from "../result.ts";

export type { Activity };

/** One thing said in the session so far, as a provider sees it. */
export type SessionLine = { readonly speaker: "owner" | "model"; readonly text: string };

/** The workspace a turn runs in. */
export type TurnWorkspace = {
  readonly name: string;
  /** The workspace's folder on the worker machine: the only place a model may look. */
  readonly folder: string;
  /** The context file as written, or `null` when there isn't one yet. */
  readonly contextFile: string | null;
};

export type TurnInput = {
  /** The model to answer with, one of the provider's own. */
  readonly model: ModelId;
  /** Everything said so far, ending with the owner's new message. */
  readonly lines: readonly SessionLine[];
  readonly workspace: TurnWorkspace;
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
  readonly status: () => Promise<ProviderStatus>;
  readonly runTurn: (input: TurnInput) => Promise<Result<null, FailureReason>>;
};

export { createClaudeProvider } from "./claude.ts";
export { createFakeProvider } from "./fake.ts";
