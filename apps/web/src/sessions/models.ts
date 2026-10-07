import type { Effort, ProviderList } from "@courtyard/contract";

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
          efforts: model.efforts,
          defaultEffort: model.defaultEffort,
        }))
      : [],
  );

/** One model on offer, with the levels of effort it takes. */
export type OfferedModel = ReturnType<typeof availableModels>[number];

/** How an effort reads in a picker: "High effort", or "Default effort (Medium)". */
export const effortLabel = (model: OfferedModel, effort: Effort | undefined) => {
  const named = (level: Effort | undefined) =>
    model.efforts.find((known) => known.id === level)?.label;
  if (effort !== undefined) return `${named(effort) ?? effort} effort`;
  const usual = named(model.defaultEffort);
  return usual === undefined ? "Default effort" : `Default effort (${usual})`;
};

/**
 * The first model on offer whose provider saves to context: the one Get to know and Tidy use, as
 * the owner doesn't pick one for them. `undefined` when there's none.
 */
export const firstSavingModel = (providers: ProviderList["providers"]) =>
  availableModels(
    providers.filter((provider) => provider.available && provider.capabilities.savesContext),
  )[0]?.ref;
