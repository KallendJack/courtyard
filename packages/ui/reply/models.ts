import { defaultOf, type Effort, type ModelRef, type ProviderList } from "@courtyard/contract";

/**
 * Every model the available providers offer, in order. On its own, so pages can pick a model
 * without loading the composer.
 */
export const availableModels = (providers: ProviderList["providers"]) =>
  providers.flatMap((provider) =>
    provider.available
      ? provider.models.map((model) => ({
          ref: { provider: provider.id, model: model.id },
          label: model.label,
          /** The model alone, where there's little room: "Sonnet 5". */
          name: model.name,
          /** Whose it is: "Claude". */
          providerLabel: provider.label,
          followsDefault: model.followsDefault === true,
          efforts: model.efforts,
          defaultEffort: model.defaultEffort,
          /** The usage limit it's at, if any: it's still offered, labelled. */
          limit: model.limit,
        }))
      : [],
  );

/** One model on offer, with the levels of effort it takes. */
export type OfferedModel = ReturnType<typeof availableModels>[number];

/**
 * Each available provider's default (#247), in the worker's order: the model and effort a switch
 * to it lands on, and a new session starts on (the first not at its usage limit).
 */
export const providerDefaults = (
  providers: ProviderList["providers"],
  models: readonly OfferedModel[],
) =>
  providers.flatMap((provider) => {
    const chosen = provider.available ? defaultOf(provider) : undefined;
    const model = models.find(
      (each) => each.ref.provider === provider.id && each.ref.model === chosen?.model.id,
    );
    return model === undefined
      ? []
      : [{ provider: provider.id, label: provider.label, model, effort: chosen?.effort }];
  });

/** One provider's default, as the Model sheet's chips show it. */
export type ProviderDefault = ReturnType<typeof providerDefaults>[number];

/** Whether a model and effort are their provider's default: only then is its chip lit. */
export const isDefault = (
  provider: ProviderDefault,
  choice: { model: OfferedModel | undefined; effort: Effort | undefined },
) =>
  choice.model !== undefined &&
  choice.model.ref.provider === provider.model.ref.provider &&
  choice.model.ref.model === provider.model.ref.model &&
  choice.effort === provider.effort;

/**
 * A model whose provider is listed but can't be used now, named by its id: a session's last model,
 * kept chosen so nothing switches model by itself (#299). `undefined` for any other model.
 */
export const unavailableModel = (
  providers: ProviderList["providers"],
  ref: ModelRef,
): OfferedModel | undefined => {
  const provider = providers.find((each) => each.id === ref.provider);
  if (provider === undefined || provider.available) return undefined;
  return {
    ref,
    label: `${provider.label} · ${ref.model}`,
    name: ref.model,
    providerLabel: provider.label,
    followsDefault: false,
    efforts: [],
    defaultEffort: undefined,
    limit: undefined,
  };
};

/**
 * The model a message went to and its effort, as the line where the model changes says them:
 * "Codex · GPT-5.5, default effort". A model no longer on offer is named by its id.
 */
export const answeringWith = ({
  models,
  ref,
  effort,
}: {
  models: readonly OfferedModel[];
  ref: ModelRef;
  effort: Effort | undefined;
}) => {
  const model = models.find((m) => m.ref.provider === ref.provider && m.ref.model === ref.model);
  if (model === undefined) return `${ref.provider} · ${ref.model}`;
  if (model.efforts.length === 0) return model.label;
  const level = effort === undefined ? "default effort" : effortLabel(model, effort).toLowerCase();
  return `${model.label}, ${level}`;
};

/** How an effort reads in a picker: "High effort", or "Default effort (Medium)". */
export const effortLabel = (model: OfferedModel, effort: Effort | undefined) => {
  const named = (level: Effort | undefined) =>
    model.efforts.find((known) => known.id === level)?.label;
  if (effort !== undefined) return `${named(effort) ?? effort} effort`;
  const usual = named(model.defaultEffort);
  return usual === undefined ? "Default effort" : `Default effort (${usual})`;
};
