import { Effort, USAGE_WARNS_AT, type UsageList } from "@courtyard/contract";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { type ModelChoice, modelKey } from "@courtyard/ui/reply/model-pickers.tsx";
import { isDefault, type OfferedModel, type ProviderDefault } from "@courtyard/ui/reply/models.ts";
import type { ReplyChoices } from "@courtyard/ui/reply/reply-choices.ts";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { saveModelDefault } from "@/api/worker-calls";
import { describeProblem } from "@/components/layout/problems";
import { HandheldSheet } from "@/components/sheets/handheld-sheet";
import {
  SheetChoices,
  SheetFold,
  SheetMakeDefault,
  type SheetModel,
  SheetModelLine,
  SheetModels,
  SheetQuickSwitch,
  SheetSkills,
} from "@/components/sheets/sheet-choices";
import { useUsage } from "../../limits/api.ts";
import { ModelMeter, PlanMeters } from "../../limits/plan-meters.tsx";
import { limitLabel } from "./limits.ts";

/** The effort row's value for a model's default: never a level's name, which can't be empty. */
const DEFAULT = "";

/** The levels whose names don't fit a tile in the effort row, as they're shortened there. */
const SHORT: Partial<Record<string, string>> = { medium: "Med", xhigh: "XHigh", minimal: "Min" };

/** An effort as the Model sheet says it, short: "Med". */
const shortEffort = (model: OfferedModel, effort: Effort | undefined) => {
  const level = model.efforts.find((known) => known.id === effort);
  return level === undefined ? undefined : (SHORT[level.id] ?? level.label);
};

/** A model and its effort in a few words, as a chip says them: "Opus 5.5 · High". */
const inWords = (model: OfferedModel, effort: Effort | undefined) => {
  const level = shortEffort(model, effort);
  return level === undefined ? model.name : `${model.name} · ${level}`;
};

/**
 * The models on offer as the Model sheet lists them (#201): by provider, each once, under its plan
 * meters (#66), and a model past the warning on its own weekly limit with that meter under it. The
 * provider's own default ("Default (recommended)") isn't a row of its own: picking the model it
 * resolves to picks it. `same` gives the row a model shows as, which differs only for that one.
 * The provider's default in Courtyard (#247) says so under it: "Claude's default · High".
 */
const listed = (
  models: readonly OfferedModel[],
  defaults: readonly ProviderDefault[],
  usage: UsageList | undefined,
) => {
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
    const asDefault = defaults.find(
      (each) =>
        each.model.ref.provider === model.ref.provider && each.model.ref.model === model.ref.model,
    );
    const notes = [
      ...(asDefault === undefined
        ? []
        : [
            [`${model.providerLabel}'s default`, shortEffort(model, asDefault.effort)]
              .filter((part) => part !== undefined)
              .join(" · "),
          ]),
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
export default function HandheldChoices(props: ReplyChoices) {
  const { choice } = props;
  const { model, defaults } = choice;
  // Read afresh while the Model sheet is open (#66), at most once a minute.
  const choosingModel = props.choosing === "model";
  const usage = useUsage({ reading: choosingModel, asking: choosingModel });
  const { providers, same } = listed(props.models, defaults, usage);
  const chosen = model === undefined ? undefined : modelKey(model.ref);
  const aside = props.skills === undefined ? {} : { aside: props.skills.workspaceName };
  /** "More models": the full list and the effort, folded shut until the owner opens it. */
  const [more, setMore] = useState(false);
  const lit = defaults.find((each) => isDefault(each, choice));
  const router = useRouter();
  const makeDefault = useAction(async () => {
    if (model === undefined) return undefined;
    const saved = await saveModelDefault(model.ref.provider, {
      model: model.ref.model,
      ...(choice.effort === undefined ? {} : { effort: choice.effort }),
    });
    if (saved.kind !== "loaded") return describeProblem(saved).body;
    // The chips, and what a new session starts on, from the worker's list.
    await router.invalidate();
    return undefined;
  });
  /** Make this the default, while the full list is open and the pick isn't its provider's default. */
  const offerDefault = more && model !== undefined && !choice.unavailable && lit === undefined;
  const effortFoot =
    more && model !== undefined && model.efforts.length > 0 ? (
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
    ) : undefined;
  const modelFoot =
    effortFoot === undefined && !offerDefault ? undefined : (
      <div className="flex flex-col gap-3">
        {effortFoot}
        {offerDefault && (
          <SheetMakeDefault
            detail={`${model.providerLabel} starts on ${inWords(model, choice.effort)} from now on`}
            busy={makeDefault.busy}
            make={() => void makeDefault.run()}
          />
        )}
        {makeDefault.error !== undefined && <FormError message={makeDefault.error} />}
      </div>
    );
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
        {...(modelFoot === undefined ? {} : { foot: modelFoot })}
      >
        {providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No models available</p>
        ) : (
          <div className="flex flex-col gap-3">
            <SheetQuickSwitch
              chips={defaults.map((each) => ({
                value: each.provider,
                name: each.label,
                choice: inWords(each.model, each.effort),
              }))}
              value={lit?.provider}
              onChange={(provider) => {
                choice.pickProvider(provider);
                props.close();
              }}
            />
            <SheetFold
              title="More models"
              detail="Every model and effort, with how much of each plan is used"
              open={more}
              onToggle={() => setMore((was) => !was)}
            />
            {more && (
              <SheetModels
                providers={providers}
                value={chosen === undefined ? undefined : (same.get(chosen) ?? chosen)}
                onChange={choice.pickModel}
              />
            )}
          </div>
        )}
      </HandheldSheet>
    </>
  );
}
