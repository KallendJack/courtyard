import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check } from "lucide-react";

/**
 * A tick box (ADR 0012): violet with a white tick when ticked, an empty box when not. Put a
 * `<label htmlFor={id}>` around what it ticks, so tapping those words ticks it too, and name it
 * with the short part of them (`labelledBy`) when the rest describes it (`describedBy`). `big` for
 * a row of its own to tick, as the move review's are (#603).
 */
export function TickBox(props: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy?: string;
  describedBy?: string;
  big?: boolean;
}) {
  return (
    <span className={classes("relative inline-flex shrink-0", props.big ? "size-5.5" : "size-4")}>
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        aria-labelledby={props.labelledBy}
        aria-describedby={props.describedBy}
        className="peer size-full cursor-pointer appearance-none rounded-sm border-stroke border-placeholder bg-field transition-colors outline-none checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className={classes(
          "pointer-events-none absolute inset-0 m-auto text-primary-foreground opacity-0 peer-checked:opacity-100",
          props.big ? "size-3.5" : "size-3",
        )}
      />
    </span>
  );
}
