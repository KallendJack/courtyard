import type { FailureReason, ModelInfo, ProviderId, UsageLimit } from "@courtyard/contract";
import type { Provider } from "../providers/index.ts";
import type { Result } from "../result.ts";

/**
 * Remembers each provider's usage limit, in the worker's memory, and reports it on the provider's
 * models (spec, Overflow). A limit is heard from a turn or one-off question that failed on it, and
 * kept until its reset time; one with no reset time is kept until the provider next answers. A
 * provider that reports its own limit (Codex, from its status) keeps it until its reset time too.
 * Nothing ever switches model because of a limit: it's only shown, and new sessions avoid it.
 */
export const rememberingLimits = (
  providers: readonly Provider[],
  now: () => number,
): Provider[] => {
  const limits = new Map<ProviderId, UsageLimit>();

  /** Whether a limit still holds: it has no reset time, or that time is still to come. */
  const holds = (limit: UsageLimit) =>
    limit.resetAt === undefined || Date.parse(limit.resetAt) > now();

  const limitOf = (provider: ProviderId) => {
    const limit = limits.get(provider);
    if (limit === undefined || holds(limit)) return limit;
    limits.delete(provider);
    return undefined;
  };

  /** Hears how a turn or a one-off question went: a usage limit is kept, an answer clears it. */
  const hear = <T>(provider: ProviderId, outcome: Result<T, FailureReason>) => {
    if (outcome.ok) limits.delete(provider);
    else if (outcome.error.kind === "rate-limited") {
      const { resetAt } = outcome.error;
      limits.set(provider, resetAt === undefined ? {} : { resetAt });
    }
    return outcome;
  };

  /** A model as listed: with the limit it's at, its provider's own word first. */
  const withLimit = (model: ModelInfo, remembered: UsageLimit | undefined): ModelInfo => {
    const { limit: reported, ...rest } = model;
    const limit = reported !== undefined && holds(reported) ? reported : remembered;
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
        return input.signal.aborted ? outcome : hear(provider.id, outcome);
      },
      answerOnce: async (input) => hear(provider.id, await provider.answerOnce(input)),
    }),
  );
};
