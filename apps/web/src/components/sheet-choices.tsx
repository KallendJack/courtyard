import type { SkillIcon, SkillName, SkillSummary } from "@courtyard/contract";
import { Book, ChevronDown, ChevronRight, Flame, UserRound } from "lucide-react";
import { useId, useState } from "react";
import { classes } from "@/lib/classes";
import { CapsLabel } from "./caps-label.tsx";
import { FrameButton, modelMark } from "./frame-button.tsx";
import { nameOf, usable, whyUnusable } from "./skill-list.tsx";

/**
 * What a Handheld sheet (handheld-sheet.tsx, #194, #201) offers to pick from: a workspace's skills
 * (Paper board Handheld · 28), and the models by provider with a row of efforts under them (· 29).
 * Their classes are in handheld-frame.css, loaded with the frame, and apply inside their own roots
 * only.
 */

/**
 * A skill's mark, as the skill gives it: the flame (Grilling, as Grill this plan has), a person
 * (Get to know), else the book every skill has elsewhere.
 */
function SkillMark(props: { icon: SkillIcon | undefined }) {
  if (props.icon === "flame") return <Flame aria-hidden strokeWidth={1.8} />;
  if (props.icon === "person") return <UserRound aria-hidden strokeWidth={1.6} />;
  return <Book aria-hidden strokeWidth={1.6} />;
}

/**
 * A workspace's skills to pick one from: each its mark, its name and one line of what it's for.
 * Those it can't use come last, greyed after a line, saying why.
 */
export function SheetSkills(props: {
  skills: readonly SkillSummary[];
  /** The skill the message already starts, if any. */
  picked: SkillName | undefined;
  pick: (name: SkillName) => void;
}) {
  const firstUnusable = props.skills.findIndex((skill) => !usable(skill));
  return (
    <div data-handheld="" className="contents">
      <ul aria-label="Skills" className="flex flex-col gap-1.5">
        {props.skills.map((skill, index) => {
          const why = skill.kind === "unusable" ? whyUnusable(skill) : undefined;
          const picked = skill.name === props.picked;
          return (
            <li
              key={`${skill.source}:${skill.name}`}
              className={classes(index === firstUnusable && index > 0 && "mt-1.5 border-t pt-3")}
            >
              <FrameButton
                look="choice"
                lit={picked}
                disabled={why !== undefined}
                aria-pressed={picked}
                onClick={() => usable(skill) && props.pick(skill.name)}
              >
                <SkillMark icon={skill.icon} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={classes(
                      "truncate text-[15px]/5 font-bold",
                      why === undefined ? "text-foreground" : "text-placeholder",
                    )}
                  >
                    {nameOf(skill)}
                  </span>
                  <span
                    className={classes(
                      "truncate text-[12px]/4",
                      why?.broken ? "text-destructive-text" : "text-muted-foreground",
                    )}
                  >
                    {why?.text ?? skill.description}
                  </span>
                </span>
              </FrameButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The model a message goes with, as a line at the foot of the Skills sheet (board 28): its mark,
 * its full name, a few words under it ("Claude · default effort"), and Change, which opens the
 * Model sheet.
 */
export function SheetModelLine(props: { name: string; detail: string; change: () => void }) {
  return (
    <div data-handheld="" className="contents">
      <FrameButton look="line" aria-haspopup="dialog" onClick={props.change}>
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-[12px]/4 font-extrabold text-foreground ring-1 ring-input ring-inset"
        >
          {modelMark(props.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-sm/4.5 font-extrabold wrap-anywhere text-foreground">
            {props.name}
          </span>
          <span className="text-[12px]/4 text-muted-foreground">{props.detail}</span>
        </span>
        <span className="text-[12px]/4 font-bold text-foreground/85">Change</span>
        <ChevronRight aria-hidden strokeWidth={1.6} />
      </FrameButton>
    </div>
  );
}

/** A model to pick: its full name, and a line under it when there's something to say. */
export type SheetModel<T extends string> = {
  readonly value: T;
  readonly name: string;
  readonly note?: string;
};

/** How many of a provider's models show before the rest fold away. */
const SHOWN = 3;

/**
 * The models to pick one from (board 29): under each provider's name in capitals, one row each,
 * its full name never cut short, the chosen one ringed in violet with its radio mark filled.
 * Beyond a provider's first few, the rest fold under "4 more Codex models", unless that would fold
 * only one; the chosen one never folds. Radio buttons, so the keyboard and screen readers treat
 * them as one.
 */
export function SheetModels<T extends string>(props: {
  providers: readonly { readonly name: string; readonly models: readonly SheetModel<T>[] }[];
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <div data-handheld="" className="contents">
      <div role="radiogroup" aria-label="Model" className="flex flex-col gap-1.5">
        {props.providers.map((provider) => (
          <ProviderModels
            key={provider.name}
            radio={name}
            provider={provider}
            value={props.value}
            onChange={props.onChange}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderModels<T extends string>(props: {
  radio: string;
  provider: { readonly name: string; readonly models: readonly SheetModel<T>[] };
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  const { provider } = props;
  const heading = useId();
  const [unfolded, setUnfolded] = useState(false);
  const shown =
    unfolded || provider.models.length <= SHOWN + 1
      ? provider.models
      : provider.models.filter((model, index) => index < SHOWN || model.value === props.value);
  const more = provider.models.length - shown.length;
  return (
    <fieldset aria-labelledby={heading} className="flex min-w-0 flex-col gap-0.5">
      <span className="px-1 py-1.5">
        <CapsLabel tone="muted" heading={{ id: heading }}>
          {provider.name}
        </CapsLabel>
      </span>
      {shown.map((model) => {
        const chosen = model.value === props.value;
        return (
          <label
            key={model.value}
            className={classes(
              "flex cursor-pointer items-center gap-3 rounded-bubble px-3 py-2.5 select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              chosen ? "bg-muted ring-[1.5px] ring-primary ring-inset" : "active:bg-accent",
            )}
          >
            <input
              type="radio"
              name={props.radio}
              value={model.value}
              checked={chosen}
              onChange={() => props.onChange(model.value)}
              className="sr-only"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-[15px]/4.75 font-extrabold wrap-anywhere text-foreground">
                {model.name}
              </span>
              {model.note !== undefined && (
                <span className="text-[12px]/4 text-muted-foreground">{model.note}</span>
              )}
            </span>
            <span
              aria-hidden
              className={classes(
                "flex size-4.5 shrink-0 items-center justify-center rounded-full",
                chosen ? "bg-primary" : "ring-[1.5px] ring-foreground/20 ring-inset",
              )}
            >
              {chosen && <span className="size-1.75 rounded-full bg-primary-foreground" />}
            </span>
          </label>
        );
      })}
      {more > 0 && (
        <FrameButton look="more" aria-expanded={false} onClick={() => setUnfolded(true)}>
          {more} more {provider.name} {more === 1 ? "model" : "models"}
          <ChevronDown aria-hidden strokeWidth={1.6} />
        </FrameButton>
      )}
    </fieldset>
  );
}

/**
 * One choice of a few, as a segmented row of tiles under a label in capitals, the chosen one lit,
 * on one line: each a word or so ("XHigh"), with its full name (`name`, "Extra high") for screen
 * readers. Radio buttons, so the keyboard and screen readers treat it as one.
 */
export function SheetChoices<T extends string>(props: {
  label: string;
  options: readonly { readonly value: T; readonly label: string; readonly name?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  const heading = useId();
  return (
    <div data-handheld="" className="contents">
      <div className="flex flex-col gap-2">
        <span className="px-1">
          <CapsLabel tone="muted" heading={{ id: heading }}>
            {props.label}
          </CapsLabel>
        </span>
        <div
          role="radiogroup"
          aria-labelledby={heading}
          className="flex gap-1 rounded-bubble bg-surface p-1"
        >
          {props.options.map((option) => {
            const chosen = option.value === props.value;
            return (
              <label
                key={option.value}
                className={classes(
                  "flex h-10 min-w-0 flex-1 basis-0 cursor-pointer items-center justify-center rounded-md text-[12px]/4 whitespace-nowrap select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  chosen
                    ? "bg-foreground font-extrabold text-card"
                    : "font-bold text-foreground active:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={chosen}
                  onChange={() => props.onChange(option.value)}
                  {...(option.name === undefined ? {} : { "aria-label": option.name })}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
