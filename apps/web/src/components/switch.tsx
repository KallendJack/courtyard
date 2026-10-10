import { classes } from "@/lib/classes";

/**
 * An on/off switch (ADR 0012): violet with its knob to the right when on, grey with it to the
 * left when off. Name it with the words beside it (`labelledBy`), and say more with the rest
 * (`describedBy`).
 */
export function Switch(props: {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  labelledBy?: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.on)}
      className={classes(
        "flex h-8 w-13 shrink-0 cursor-pointer items-center rounded-full p-0.75 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50",
        props.on ? "justify-end bg-primary" : "justify-start bg-placeholder",
      )}
    >
      <span aria-hidden className="size-6.5 shrink-0 rounded-full bg-primary-foreground" />
    </button>
  );
}
