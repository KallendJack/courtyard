import { useId } from "react";
import { classes } from "@/lib/classes";

/** How the choices look: pills in a track, or apart, the chosen one in violet (the PRs list's Open / Merged, #240). */
const LOOKS = {
  track: {
    set: "gap-0.5 rounded-full bg-muted p-0.5",
    choice: "px-3.5 py-1.5 md:px-3 md:py-1",
    chosen: "bg-card text-foreground shadow-xs",
    other: "text-muted-foreground hover:text-foreground",
  },
  apart: {
    set: "gap-2",
    choice: "flex h-8 items-center border px-3",
    chosen: "border-primary/35 bg-primary/12 text-primary-text",
    other: "border-input text-foreground hover:bg-muted",
  },
} as const;

/**
 * One choice of a few, shown side by side as pills: a set of radio buttons, so the keyboard and
 * screen readers treat it as one. Safe on the first load (ADR 0012).
 */
export function SegmentedChoice<T extends string>(props: {
  /** What's being chosen, for screen readers: "Section", say. */
  label: string;
  /** Each choice, and how many there are of it when that helps choose (Things' "Have 5"). */
  options: readonly { readonly value: T; readonly label: string; readonly count?: number }[];
  value: T;
  onChange: (value: T) => void;
  /** In a track (the default), or apart. */
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
              "cursor-pointer rounded-full text-meta/4 font-semibold transition-colors select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
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
            {option.label}
            {option.count !== undefined && (
              <span className="font-normal text-muted-foreground"> {option.count}</span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
