import type { Effort, ModelRef, ProviderList } from "@courtyard/contract";

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
          /** The usage limit it's at, if any: it's still offered, labelled. */
          limit: model.limit,
        }))
      : [],
  );

/** One model on offer, with the levels of effort it takes. */
export type OfferedModel = ReturnType<typeof availableModels>[number];

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
