import type { ProviderList } from "@courtyard/contract";

/**
 * Every model the available providers offer, in order: the first is a new session's default. On
 * its own, so pages can pick a model without loading the composer.
 */
export const availableModels = (providers: ProviderList["providers"]) =>
  providers.flatMap((provider) =>
    provider.available
      ? provider.models.map((model) => ({
          ref: { provider: provider.id, model: model.id },
          label: model.label,
        }))
      : [],
  );

/**
 * The first model on offer whose provider saves to context: the one Get to know and Tidy use, as
 * the owner doesn't pick one for them. `undefined` when there's none.
 */
export const firstSavingModel = (providers: ProviderList["providers"]) =>
  availableModels(
    providers.filter((provider) => provider.available && provider.capabilities.savesContext),
  )[0]?.ref;
