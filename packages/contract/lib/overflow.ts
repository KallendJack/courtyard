import {
  defaultOf,
  type Effort,
  type ModelRef,
  type ProviderId,
  type ProviderStatus,
} from "./session.ts";

/**
 * What the owner can do after one provider hits its usage limit (spec, Overflow): carry on with
 * another provider's default model, sign in to one first, or wait, as every other one is at its
 * limit too. `none` when there's no other provider to turn to.
 */
export type Overflow =
  | {
      readonly kind: "carry-on";
      /** The provider carried on with, by name: "Codex". */
      readonly label: string;
      /** Its default model, which Carry on sends the message to. */
      readonly model: ModelRef;
      /** Its default's effort (#247), none for the model's own. */
      readonly effort: Effort | undefined;
    }
  | { readonly kind: "sign-in"; readonly label: string }
  | {
      readonly kind: "at-limit";
      /** Each other provider at its limit, and when it resets, when it says. */
      readonly others: readonly { readonly label: string; readonly resetAt: string | undefined }[];
    }
  | { readonly kind: "none" };

/**
 * Where a session can go after `limited` hits its usage limit: the first other provider (in the
 * worker's order) that's available with its default (#247) not at a limit; else one that only
 * needs signing in; else the others at their limit. Never chosen for the owner: the web app offers
 * it, and the worker checks it again when the owner takes it.
 */
export const overflowFrom = (
  providers: readonly ProviderStatus[],
  limited: ProviderId,
): Overflow => {
  const others = providers.filter((provider) => provider.id !== limited);
  const defaultIn = (provider: ProviderStatus) =>
    provider.available ? defaultOf(provider) : undefined;
  for (const provider of others) {
    const chosen = defaultIn(provider);
    if (chosen !== undefined && chosen.model.limit === undefined) {
      return {
        kind: "carry-on",
        label: provider.label,
        model: { provider: provider.id, model: chosen.model.id },
        effort: chosen.effort,
      };
    }
  }
  const signedOut = others.find((provider) => !provider.available && provider.signedOut);
  if (signedOut) return { kind: "sign-in", label: signedOut.label };
  const atLimit = others.flatMap((provider) => {
    const limit = defaultIn(provider)?.model.limit;
    return limit ? [{ label: provider.label, resetAt: limit.resetAt }] : [];
  });
  return atLimit.length > 0 ? { kind: "at-limit", others: atLimit } : { kind: "none" };
};
