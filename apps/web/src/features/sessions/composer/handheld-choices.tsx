import {
  Effort,
  type SkillName,
  type SkillSummary,
  USAGE_WARNS_AT,
  type UsageList,
} from "@courtyard/contract";
import type { ReactNode } from "react";
import { HandheldSheet } from "@/components/sheets/handheld-sheet";
import {
  SheetChoices,
  type SheetModel,
  SheetModelLine,
  SheetModels,
  SheetSkills,
} from "@/components/sheets/sheet-choices";
import { useUsage } from "../../limits/api.ts";
import { ModelMeter, PlanMeters } from "../../limits/plan-meters.tsx";
import { limitLabel } from "./limits.ts";
import { type ModelChoice, modelKey } from "./model-pickers.tsx";
import type { OfferedModel } from "./models.ts";

/** The effort row's value for a model's default: never a level's name, which can't be empty. */
const DEFAULT = "";

/** The levels whose names don't fit a tile in the effort row, as they're shortened there. */
const SHORT: Partial<Record<string, string>> = { medium: "Med", xhigh: "XHigh", minimal: "Min" };

/**
 * The models on offer as the Model sheet lists them (#201): by provider, each once, under its plan
 * meters (#66), and a model past the warning on its own weekly limit with that meter under it. A
 * provider's default isn't a row of its own: the model it resolves to says it's the default, and
 * picking that row picks the default. `same` gives the row a model shows as, which differs only
 * for that one.
 */
const listed = (models: readonly OfferedModel[], usage: UsageList | undefined) => {
  type Listed = { name: string; models: SheetModel<string>[]; above?: ReactNode };
  const providers = new Map<string, Listed>();
  const usageOf = (provider: string) =>
    usage?.providers.find((each) => each.provider === provider)?.usage;
  /** A model's own weekly limit, by the family its name starts with, once past the warning. */
  const modelMeterOf = (model: OfferedModel) => {
    const plan = usageOf(model.ref.provider);
    return plan?.kind === "plan"
      ? plan.models.find(
          (meter) => meter.used >= USAGE_WARNS_AT && model.name.startsWith(meter.name),
        )
      : undefined;
  };
  const same = new Map<string, string>();
  const twinOf = (model: OfferedModel) =>
    models.find(
      (other) =>
        other.ref.provider === model.ref.provider &&
        !other.followsDefault &&
        other.name === model.name,
    );
  const twins = new Set(models.filter((m) => m.followsDefault).map(twinOf));
  for (const model of models) {
    if (twins.has(model)) continue;
    const key = modelKey(model.ref);
    const twin = model.followsDefault ? twinOf(model) : undefined;
    if (twin !== undefined) same.set(modelKey(twin.ref), key);
    const notes = [
      ...(model.followsDefault ? [`${model.providerLabel}'s default`] : []),
      ...(model.limit === undefined ? [] : [limitLabel(model.limit)]),
    ];
    const plan = usageOf(model.ref.provider);
    const provider: Listed = providers.get(model.ref.provider) ?? {
      name: model.providerLabel,
      models: [],
      ...(plan === undefined
        ? {}
        : { above: <PlanMeters label={model.providerLabel} usage={plan} /> }),
    };
    const meter = modelMeterOf(model);
    provider.models.push({
      value: key,
      name: model.name,
      ...(notes.length === 0 ? {} : { note: notes.join(" · ") }),
      ...(meter === undefined ? {} : { below: <ModelMeter meter={meter} /> }),
    });
    providers.set(model.ref.provider, provider);
  }
  return { providers: [...providers.values()], same };
};

/** The model's provider and its effort, under its name at the Skills sheet's foot. */
const detail = ({ model, effort }: ModelChoice) => {
  if (model === undefined || model.efforts.length === 0) return model?.providerLabel ?? "";
  const level = model.efforts.find((known) => known.id === effort)?.label;
  return `${model.providerLabel} · ${level === undefined ? "default" : level.toLowerCase()} effort`;
};

/**
 * What the Handheld frame's Skills and Model buttons open for a message box docked in it (#194,
 * #201): Skills, a sheet of the workspace's skills, with the model at its foot and Change, which
 * opens Model; Model, the models by provider, with the effort at its foot. Loaded only in the
 * frame.
 */
export default function HandheldChoices(props: {
  choosing: "model" | "skill" | undefined;
  close: () => void;
  /** Opens the Model sheet in place of the Skills sheet. */
  changeModel: () => void;
  models: readonly OfferedModel[];
  choice: ModelChoice;
  /** The workspace's name and the skills its picker lists, when it has any. */
  skills: { readonly workspaceName: string; readonly list: readonly SkillSummary[] } | undefined;
  /** The skill the message starts, if one is picked. */
  skill: SkillName | undefined;
  pick: (name: SkillName) => void;
}) {
  const { choice } = props;
  const { model } = choice;
  // Read afresh while the Model sheet is open (#66), at most once a minute.
  const choosingModel = props.choosing === "model";
  const usage = useUsage({ reading: choosingModel, asking: choosingModel });
  const { providers, same } = listed(props.models, usage);
  const chosen = model === undefined ? undefined : modelKey(model.ref);
  const aside = props.skills === undefined ? {} : { aside: props.skills.workspaceName };
  return (
    <>
      {props.skills !== undefined && (
        <HandheldSheet
          title="Skills"
          {...aside}
          open={props.choosing === "skill"}
          onClose={props.close}
          {...(model === undefined
            ? {}
            : {
                foot: (
                  <SheetModelLine
                    name={model.name}
                    detail={detail(choice)}
                    change={props.changeModel}
                  />
                ),
              })}
        >
          <SheetSkills skills={props.skills.list} picked={props.skill} pick={props.pick} />
        </HandheldSheet>
      )}
      <HandheldSheet
        title="Model"
        {...aside}
        open={props.choosing === "model"}
        onClose={props.close}
        {...(model === undefined || model.efforts.length === 0
          ? {}
          : {
              foot: (
                <SheetChoices
                  label="Effort"
                  options={[
                    { value: DEFAULT, label: "Default" },
                    ...model.efforts.map((level) => ({
                      value: level.id,
                      label: SHORT[level.id] ?? level.label,
                      name: level.label,
                    })),
                  ]}
                  value={choice.effort ?? DEFAULT}
                  onChange={(value) => {
                    const level = Effort.safeParse(value);
                    choice.pickEffort(level.success ? level.data : undefined);
                  }}
                />
              ),
            })}
      >
        {providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No models available</p>
        ) : (
          <SheetModels
            providers={providers}
            value={chosen === undefined ? undefined : (same.get(chosen) ?? chosen)}
            onChange={choice.pickModel}
          />
        )}
      </HandheldSheet>
    </>
  );
}
