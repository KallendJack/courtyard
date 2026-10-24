import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One choice of a list, as a row (Paper, "Tablet · Connect Paper"): a radio, its tick filled violet
 * and the row ringed once it's chosen (AGENTS.md: violet is chosen), with a note at its end ("Same
 * name") or a line under its label ("Ends when its PR opens", #428). An icon can stand in for the
 * empty tick (Make a new file's +). Safe on the first load (ADR 0012).
 */
export function RadioRow(props: {
  /** The radio group's name, which the rows of one list share. */
  name: string;
  label: string;
  chosen: boolean;
  note?: string | undefined;
  /** A line under its label, saying more of what it means. */
  detail?: string | undefined;
  /** In place of the empty tick while it isn't chosen. */
  icon?: ReactNode;
  onChoose: () => void;
}) {
  return (
    <label
      className={classes(
        "flex min-h-10.5 shrink-0 cursor-pointer items-center gap-2.5 rounded-row px-3 select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        props.detail !== undefined && "py-2",
        props.chosen ? "border-stroke border-primary-text bg-primary/12" : "bg-surface",
      )}
    >
      <input
        type="radio"
        name={props.name}
        checked={props.chosen}
        onChange={props.onChoose}
        className="sr-only"
      />
      {props.chosen ? (
        <span
          aria-hidden
          className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      ) : props.icon !== undefined ? (
        <span
          aria-hidden
          className="flex size-4.5 shrink-0 items-center justify-center text-foreground/75 [&_svg]:size-4.5"
        >
          {props.icon}
        </span>
      ) : (
        <span
          aria-hidden
          className="size-4.5 shrink-0 rounded-full border-stroke border-placeholder"
        />
      )}
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span
          className={classes(
            "truncate text-sm/4.5",
            props.chosen ? "font-bold text-foreground" : "font-semibold text-foreground/85",
          )}
        >
          {props.label}
        </span>
        {props.detail !== undefined && (
          <span className="text-meta text-muted-foreground">{props.detail}</span>
        )}
      </span>
      {props.note !== undefined && (
        <span className="shrink-0 text-meta font-semibold text-primary-text">{props.note}</span>
      )}
    </label>
  );
}
