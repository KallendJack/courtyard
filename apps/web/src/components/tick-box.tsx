import { Check } from "lucide-react";

/**
 * A tick box (ADR 0012): heather with a white tick when ticked, an empty box when not. Put a
 * `<label htmlFor={id}>` around what it ticks, so tapping those words ticks it too, and name it
 * with the short part of them (`labelledBy`) when the rest describes it (`describedBy`).
 */
export function TickBox(props: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy?: string;
  describedBy?: string;
}) {
  return (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        aria-labelledby={props.labelledBy}
        aria-describedby={props.describedBy}
        className="peer size-4 cursor-pointer appearance-none rounded-sm border-[1.5px] border-placeholder bg-field transition-colors outline-none checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  );
}
