import { Effort, type ModelRef, takesEffort } from "@courtyard/contract";
import { useState } from "react";
import { Select } from "@/components/select";
import { limitLabel } from "./limits.ts";
import { effortLabel, type OfferedModel } from "./models.ts";

const keyOf = (model: ModelRef) => `${model.provider}/${model.model}`;

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

  const followedKey = choice.followModel ? keyOf(choice.followModel) : undefined;
  const following = chosenKey === undefined && models.some((m) => keyOf(m.ref) === followedKey);
  const modelKey = chosenKey ?? (following ? followedKey : undefined);
  const model =
    models.find((m) => keyOf(m.ref) === modelKey) ??
    models.find((m) => m.limit === undefined) ??
    models[0];
  const wanted = chosenEffort ? chosenEffort.effort : following ? choice.followEffort : undefined;
  const effort = model !== undefined && takesEffort(model, wanted) ? wanted : undefined;

  return {
    model,
    effort,
    pickModel: (key: string) => {
      const picked = models.find((m) => keyOf(m.ref) === key);
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

/**
 * The model alone, in a word or two, as the Handheld frame's Model button shows it (#193):
 * "Claude · Sonnet 5" as "Sonnet 5", and Claude Code's "Default (Opus 5.5)" as "Opus 5.5".
 */
export const modelName = ({ model }: ModelChoice) => {
  if (model === undefined) return "No models";
  const name = model.label.split(" · ").at(-1) ?? model.label;
  const inDefault = /^Default \((.+)\)$/.exec(name)?.[1];
  return inDefault ?? name.replace(/\s*\(.*\)$/, "");
};

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
        value={model ? keyOf(model.ref) : ""}
        options={
          models.length === 0
            ? [{ value: "", label: "No models available" }]
            : models.map((m) => ({
                value: keyOf(m.ref),
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
