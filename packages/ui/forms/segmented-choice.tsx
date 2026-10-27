import { type ReactNode, useId } from "react";
import { classes } from "../lib/classes.ts";

/**
 * How the choices look: pills in a track, or apart, the chosen one in violet (the PRs list's Open
 * / Merged, #240), or a switch.
 */
const LOOKS = {
  track: {
    set: "gap-0.5 rounded-full bg-muted p-0.5",
    choice: "px-3.5 py-1.5 text-meta/4 font-semibold md:px-3 md:py-1",
    chosen: "bg-card text-foreground shadow-xs",
    other: "text-muted-foreground hover:text-foreground",
  },
  /** Apart, they wrap onto a second line where a row is too narrow for them all. */
  apart: {
    set: "flex-wrap gap-2",
    choice: "flex h-8 items-center border px-3 text-meta/4 font-semibold",
    chosen: "border-primary/35 bg-primary/12 text-primary-text",
    other: "border-input text-foreground hover:bg-muted",
  },
  /** Small chips that wrap, the chosen one filled (a planning Home's views, #481). */
  chips: {
    set: "flex-wrap gap-1.5",
    choice: "flex h-7.5 items-center px-3 text-meta",
    chosen: "bg-primary-text font-bold text-background",
    other: "border border-input bg-secondary font-semibold text-foreground/80 hover:bg-muted",
  },
  /** A slim switch in a top bar, the chosen side ringed violet (a Build's At the bench / Plan, #826). */
  slim: {
    set: "gap-0.5 rounded-full bg-secondary p-0.75",
    choice: "flex h-7.5 items-center border px-3.5 text-meta/4",
    chosen: "border-primary bg-primary/15 font-semibold text-foreground",
    other: "border-transparent font-medium text-muted-foreground hover:text-foreground",
  },
  /**
   * Pills apart, the chosen one ringed violet, each with its count after it: as the workspace's
   * tabs, smaller (the Designs tab's Live / Agreed / Drafts and Desktop / Tablet / Cover, #522).
   */
  pills: {
    set: "gap-1.5",
    choice: "flex h-8 items-center gap-1.75 px-3.25 text-meta",
    chosen: "border-stroke border-primary-text bg-primary/12 font-bold text-foreground",
    other: "bg-secondary font-semibold text-foreground/85 hover:bg-muted",
    count: {
      chosen: "text-label font-semibold tabular-nums text-primary-text",
      other: "text-label font-semibold tabular-nums text-placeholder",
    },
  },
  /** A thumb-sized switch, the chosen side filled violet (New workspace's Planning / Code, #258). */
  switch: {
    set: "gap-1 rounded-full border bg-surface p-1",
    choice: "flex h-10 items-center gap-2 px-5 text-interface [&_svg]:size-4.5 [&_svg]:shrink-0",
    chosen: "bg-primary font-bold text-primary-foreground",
    other: "font-semibold text-foreground/80 hover:text-foreground",
  },
} as const;

/**
 * One choice of a few, shown side by side as pills: a set of radio buttons, so the keyboard and
 * screen readers treat it as one. Safe on the first load (ADR 0012).
 */
export function SegmentedChoice<T extends string>(props: {
  /** What's being chosen, for screen readers: "Section", say. */
  label: string;
  /**
   * Each choice, and how many there are of it when that helps choose (Things' "Have 5"), or an
   * icon before its label.
   */
  options: readonly {
    readonly value: T;
    readonly label: string;
    readonly count?: number;
    readonly icon?: ReactNode;
  }[];
  value: T;
  onChange: (value: T) => void;
  /** In a track (the default), apart, as chips, pills, slim or a switch. */
  look?: keyof typeof LOOKS;
}) {
  const name = useId();
  const look = LOOKS[props.look ?? "track"];
  return (
    <fieldset className={classes("flex w-fit", look.set)}>
      <legend className="sr-only">{props.label}</legend>
      {props.options.map((option) => {
        const chosen = option.value === props.value;
        return (
          <label
            key={option.value}
            className={classes(
              "cursor-pointer rounded-full transition-colors select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              look.choice,
              chosen ? look.chosen : look.other,
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={chosen}
              onChange={() => props.onChange(option.value)}
              className="sr-only"
            />
            {option.icon}
            {option.label}
            {option.count !== undefined &&
              ("count" in look ? (
                <span className={chosen ? look.count.chosen : look.count.other}>
                  {option.count}
                </span>
              ) : (
                <span className="font-normal text-muted-foreground"> {option.count}</span>
              ))}
          </label>
        );
      })}
    </fieldset>
  );
}
