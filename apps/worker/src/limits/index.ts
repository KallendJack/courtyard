import type { FailureReason, ModelInfo, ProviderId, UsageLimit } from "@courtyard/contract";
import type { Provider } from "../providers/index.ts";
import type { Result } from "../result.ts";

/**
 * How long a limit with no reset time is kept: long enough that new sessions don't walk into it,
 * short enough that a provider is never left out for good on a guess.
 */
const UNKNOWN_RESET_KEPT_MS = 60 * 60 * 1000;

/**
 * Remembers each provider's usage limit, in the worker's memory, and reports it on the provider's
 * models (spec, Overflow). A limit is heard from a turn or one-off question that failed on it, and
 * kept until its reset time (an hour, when it has none), or until the provider next answers. A
 * provider that reports its own limit (Codex, from its status) keeps it until its reset time too.
 * Nothing ever switches model because of a limit: it's only shown, and new sessions avoid it.
 */
export const rememberingLimits = (
  providers: readonly Provider[],
  now: () => number,
): Provider[] => {
  const limits = new Map<ProviderId, { limit: UsageLimit; until: number }>();

  const limitOf = (provider: ProviderId) => {
    const kept = limits.get(provider);
    if (kept === undefined || kept.until > now()) return kept?.limit;
    limits.delete(provider);
    return undefined;
  };

  /** Remembers how a turn or a one-off question went: a usage limit is kept, an answer clears it. */
  const remember = <T>(provider: ProviderId, outcome: Result<T, FailureReason>) => {
    if (outcome.ok) limits.delete(provider);
    else if (outcome.error.kind === "rate-limited") {
      const { resetAt } = outcome.error;
      limits.set(
        provider,
        resetAt === undefined
          ? { limit: {}, until: now() + UNKNOWN_RESET_KEPT_MS }
          : { limit: { resetAt }, until: Date.parse(resetAt) },
      );
    }
    return outcome;
  };

  /** A model as listed: with the limit it's at, its provider's own word first while it holds. */
  const withLimit = (model: ModelInfo, remembered: UsageLimit | undefined): ModelInfo => {
    const { limit: reported, ...rest } = model;
    const holds = reported?.resetAt === undefined || Date.parse(reported.resetAt) > now();
    const limit = reported !== undefined && holds ? reported : remembered;
    return limit === undefined ? rest : { ...rest, limit };
  };

  return providers.map(
    (provider): Provider => ({
      ...provider,
      status: async () => {
        const status = await provider.status();
        if (!status.available) return status;
        const remembered = limitOf(provider.id);
        return { ...status, models: status.models.map((model) => withLimit(model, remembered)) };
      },
      runTurn: async (input) => {
        const outcome = await provider.runTurn(input);
        // A turn the owner stopped says nothing about a limit either way.
        return input.signal.aborted ? outcome : remember(provider.id, outcome);
      },
      answerOnce: async (input) => remember(provider.id, await provider.answerOnce(input)),
    }),
  );
};
