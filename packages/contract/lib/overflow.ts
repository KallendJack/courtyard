import type { ModelRef, ProviderId, ProviderStatus } from "./session.ts";

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
      /** Its default model, which Carry on sends the message to at its default effort. */
      readonly model: ModelRef;
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
 * worker's order) that's available with its default model (its first) not at a limit; else one
 * that only needs signing in; else the others at their limit. Never chosen for the owner: the web
 * app offers it, and the worker checks it again when the owner takes it.
 */
export const overflowFrom = (
  providers: readonly ProviderStatus[],
  limited: ProviderId,
): Overflow => {
  const others = providers.filter((provider) => provider.id !== limited);
  for (const provider of others) {
    const model = provider.available ? provider.models[0] : undefined;
    if (model !== undefined && model.limit === undefined) {
      return {
        kind: "carry-on",
        label: provider.label,
        model: { provider: provider.id, model: model.id },
      };
    }
  }
  const signedOut = others.find((provider) => !provider.available && provider.signedOut);
  if (signedOut) return { kind: "sign-in", label: signedOut.label };
  const atLimit = others.flatMap((provider) => {
    const limit = provider.available ? provider.models[0]?.limit : undefined;
    return limit ? [{ label: provider.label, resetAt: limit.resetAt }] : [];
  });
  return atLimit.length > 0 ? { kind: "at-limit", others: atLimit } : { kind: "none" };
};
