import { useId } from "react";
import { classes } from "@/lib/classes";

/**
 * One choice of a few, shown side by side as pills in a track: a set of radio buttons, so the
 * keyboard and screen readers treat it as one. Safe on the first load (ADR 0012).
 */
export function SegmentedChoice<T extends string>(props: {
  /** What's being chosen, for screen readers: "Section", say. */
  label: string;
  /** Each choice, and how many there are of it when that helps choose (Things' "Have 5"). */
  options: readonly { readonly value: T; readonly label: string; readonly count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex w-fit gap-0.5 rounded-full bg-muted p-0.5">
      <legend className="sr-only">{props.label}</legend>
      {props.options.map((option) => {
        const chosen = option.value === props.value;
        return (
          <label
            key={option.value}
            className={classes(
              "cursor-pointer rounded-full px-3.5 py-1.5 text-[13px]/4 font-semibold transition-colors select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50 md:px-3 md:py-1",
              chosen
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
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
