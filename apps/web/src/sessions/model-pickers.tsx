import { type Effort, type ModelRef, type ProviderList, takesEffort } from "@courtyard/contract";
import { useState } from "react";
import { effortLabel, type OfferedModel, unavailableModel } from "./models.ts";

/** A model's key, as the pickers' values name it. */
export const modelKey = (model: ModelRef) => `${model.provider}/${model.model}`;

/**
 * The model and effort a message goes with. Until the owner picks, they follow the session's last
 * message (once its events have replayed), else the first model that isn't at its usage limit, at
 * its default effort. A session's model whose provider is listed but unavailable stays chosen, and
 * `unavailable` says nothing can be sent to it: only the owner switches model (#299). A model
 * change keeps the effort if the new model takes it, and goes back to Default if not.
 */
export const useModelChoice = (choice: {
  providers: ProviderList["providers"];
  models: readonly OfferedModel[];
  followModel: ModelRef | undefined;
  followEffort: Effort | undefined;
}) => {
  const { models } = choice;
  const [chosenKey, setChosenKey] = useState<string>();
  /** Set once the owner picks an effort, or a model (which settles the effort too). */
  const [chosenEffort, setChosenEffort] = useState<{ effort: Effort | undefined }>();

  const followedKey = choice.followModel ? modelKey(choice.followModel) : undefined;
  const following = chosenKey === undefined && models.some((m) => modelKey(m.ref) === followedKey);
  const kept =
    chosenKey === undefined && !following && choice.followModel
      ? unavailableModel(choice.providers, choice.followModel)
      : undefined;
  const wantedKey = chosenKey ?? (following ? followedKey : undefined);
  const model =
    kept ??
    models.find((m) => modelKey(m.ref) === wantedKey) ??
    models.find((m) => m.limit === undefined) ??
    models[0];
  const wanted = chosenEffort ? chosenEffort.effort : following ? choice.followEffort : undefined;
  const effort = model !== undefined && takesEffort(model, wanted) ? wanted : undefined;

  return {
    model,
    effort,
    unavailable: kept !== undefined,
    pickModel: (key: string) => {
      const picked = models.find((m) => modelKey(m.ref) === key);
      setChosenKey(key);
      const kept = picked !== undefined && takesEffort(picked, effort);
      setChosenEffort({ effort: kept ? effort : undefined });
    },
    pickEffort: (picked: Effort | undefined) => setChosenEffort({ effort: picked }),
  };
};

export type ModelChoice = ReturnType<typeof useModelChoice>;

/** The model and its effort in a few words, as the Reply box shows them, quietly (#251). */
export const choiceSummary = ({ model, effort }: ModelChoice) =>
  model === undefined
    ? "No models available"
    : model.efforts.length === 0
      ? model.label
      : `${model.label} · ${effortLabel(model, effort)}`;

/** The model alone, as the Handheld frame's Model button shows it (#193). */
export const modelName = ({ model }: ModelChoice) =>
  model === undefined ? "No models" : model.name;
