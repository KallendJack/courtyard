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
