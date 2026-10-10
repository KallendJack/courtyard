import { Effort, type ModelRef, takesEffort } from "@courtyard/contract";
import { useState } from "react";
import { Select } from "@/components/select";
import { limitLabel } from "./limits.ts";
import { effortLabel, type OfferedModel } from "./models.ts";

/** A model's key, as the pickers' values name it. */
export const modelKey = (model: ModelRef) => `${model.provider}/${model.model}`;

/** The effort picker's value for a model's default: never a level's name, which can't be empty. */
const DEFAULT = "";

/**
 * The model and effort a message goes with. Until the owner picks, they follow the session's last
 * message (once its events have replayed), else the first model that isn't at its usage limit, at
 * its default effort. A model change
 * keeps the effort if the new model takes it, and goes back to Default if not.
 */
export const useModelChoice = (choice: {
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
  const wantedKey = chosenKey ?? (following ? followedKey : undefined);
  const model =
    models.find((m) => modelKey(m.ref) === wantedKey) ??
    models.find((m) => m.limit === undefined) ??
    models[0];
  const wanted = chosenEffort ? chosenEffort.effort : following ? choice.followEffort : undefined;
  const effort = model !== undefined && takesEffort(model, wanted) ? wanted : undefined;

  return {
    model,
    effort,
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

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The model and its effort in a few words, as the chip on a phone shows them. */
export const choiceSummary = ({ model, effort }: ModelChoice) =>
  model === undefined
    ? "No models available"
    : model.efforts.length === 0
      ? model.label
      : `${model.label} · ${effortLabel(model, effort)}`;

/** The model alone, as the Handheld frame's Model button shows it (#193). */
export const modelName = ({ model }: ModelChoice) =>
  model === undefined ? "No models" : model.name;

/**
 * A word under a model's name in the Handheld frame's Model row (#194), to tell models apart: its
 * usage limit if it's at one, "default" for its provider's default, else whose it is ("Claude").
 */
export const modelWord = (model: OfferedModel) =>
  model.limit !== undefined
    ? limitLabel(model.limit)
    : model.followsDefault
      ? "default"
      : model.providerLabel;

/**
 * The model picker, and beside it the effort picker for a model that takes levels of effort:
 * "Default effort" first, then each level.
 */
export function ModelPickers(props: {
  models: readonly OfferedModel[];
  choice: ModelChoice;
  look: "pill" | "field";
  /** Only from tablet width up, where there's room beside the message box. */
  wideOnly?: boolean;
}) {
  const { models, choice, look } = props;
  const { model } = choice;
  const wideOnly = props.wideOnly === true;
  return (
    <>
      <Select
        label="Model"
        look={look}
        wideOnly={wideOnly}
        value={model ? modelKey(model.ref) : ""}
        options={
          models.length === 0
            ? [{ value: "", label: "No models available" }]
            : models.map((m) => ({
                value: modelKey(m.ref),
                label: m.limit ? `${m.label} · ${limitLabel(m.limit)}` : m.label,
              }))
        }
        onChange={choice.pickModel}
        {...(model?.limit ? { warning: capitalised(limitLabel(model.limit)) } : {})}
      />
      {model && model.efforts.length > 0 && (
        <Select
          label="Effort"
          look={look}
          wideOnly={wideOnly}
          value={choice.effort ?? DEFAULT}
          options={[
            { value: DEFAULT, label: effortLabel(model, undefined) },
            ...model.efforts.map((level) => ({
              value: level.id,
              label: effortLabel(model, level.id),
            })),
          ]}
          onChange={(value) => {
            const level = Effort.safeParse(value);
            choice.pickEffort(level.success ? level.data : undefined);
          }}
        />
      )}
    </>
  );
}
