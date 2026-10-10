import { Effort, type SkillName, type SkillSummary } from "@courtyard/contract";
import { HandheldSheet } from "@/components/handheld-sheet";
import { SheetChoices, SheetSkills } from "@/components/sheet-choices";
import { type ModelChoice, modelKey, modelWord, shortModelName } from "./model-pickers.tsx";
import type { OfferedModel } from "./models.ts";

/** The effort row's value for a model's default: never a level's name, which can't be empty. */
const DEFAULT = "";

/**
 * The model a message goes with, and its effort, as rows of tiles at a Handheld sheet's foot
 * (#194): each model by name with a word under it, then "Default" (its usual level under it) and
 * each level the model takes.
 */
function ModelRows(props: { models: readonly OfferedModel[]; choice: ModelChoice }) {
  const { choice } = props;
  const { model } = choice;
  return (
    <>
      <SheetChoices
        label="Model"
        options={props.models.map((each) => ({
          value: modelKey(each.ref),
          label: shortModelName(each),
          word: modelWord(each),
        }))}
        value={model === undefined ? "" : modelKey(model.ref)}
        onChange={choice.pickModel}
      />
      {model !== undefined && model.efforts.length > 0 && (
        <SheetChoices
          label="Effort"
          options={[
            {
              value: DEFAULT,
              label: "Default",
              word: model.efforts.find((level) => level.id === model.defaultEffort)?.label ?? "",
            },
            ...model.efforts.map((level) => ({ value: level.id, label: level.label })),
          ]}
          value={choice.effort ?? DEFAULT}
          onChange={(value) => {
            const level = Effort.safeParse(value);
            choice.pickEffort(level.success ? level.data : undefined);
          }}
        />
      )}
    </>
  );
}

/**
 * What the Handheld frame's Skills and Model buttons open for a message box docked in it (#194):
 * Skills, a sheet of the workspace's skills with the model and effort at its foot; Model, the
 * model and effort alone. Loaded only in the frame.
 */
export default function HandheldChoices(props: {
  choosing: "model" | "skill" | undefined;
  close: () => void;
  models: readonly OfferedModel[];
  choice: ModelChoice;
  /** The workspace's name and the skills its picker lists, when it has any. */
  skills: { readonly workspaceName: string; readonly list: readonly SkillSummary[] } | undefined;
  /** The skill the message starts, if one is picked. */
  skill: SkillName | undefined;
  pick: (name: SkillName) => void;
}) {
  const rows = <ModelRows models={props.models} choice={props.choice} />;
  return (
    <>
      {props.skills !== undefined && (
        <HandheldSheet
          title="Skills"
          aside={props.skills.workspaceName}
          open={props.choosing === "skill"}
          onClose={props.close}
          foot={rows}
        >
          <SheetSkills skills={props.skills.list} picked={props.skill} pick={props.pick} />
        </HandheldSheet>
      )}
      <HandheldSheet
        title="Model"
        open={props.choosing === "model"}
        onClose={props.close}
        fits="bottom"
        foot={rows}
      />
    </>
  );
}
