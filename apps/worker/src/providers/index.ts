import type { FailureReason, ProviderId, ProviderStatus } from "@courtyard/contract";
import type { Result } from "../result.ts";

/** One line of a session's conversation so far, as a provider sees it. */
export type ConversationLine = { readonly role: "owner" | "model"; readonly text: string };

export type TurnInput = {
  /** The model to answer with, one of the provider's own. */
  readonly model: string;
  /** Everything said so far, ending with the owner's new message. */
  readonly conversation: readonly ConversationLine[];
  /** Hands over the next piece of the answer as it's written. */
  readonly emit: (text: string) => Promise<void>;
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
