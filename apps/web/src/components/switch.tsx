import { LoaderCircle } from "lucide-react";
import { classes } from "@/lib/classes";
import { useBusy } from "./button.tsx";

/**
 * An on/off switch (ADR 0012): violet with its knob to the right when on, grey with it to the
 * left when off. Name it with the words beside it (`labelledBy`), and say more with the rest
 * (`describedBy`). While what it turns on or off runs (`busy`), it keeps its colour, ignores
 * taps, and a spinner turns in its knob (#330).
 */
export function Switch(props: {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  labelledBy?: string;
  describedBy?: string;
}) {
  const { working, attributes } = useBusy({
    busy: props.busy === true,
    busyLabel: undefined,
    onClick: () => props.onChange(!props.on),
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      {...attributes}
      className={classes(
        "flex h-8 w-13 shrink-0 cursor-pointer items-center rounded-full p-0.75 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50",
        props.on ? "justify-end bg-primary" : "justify-start bg-placeholder",
      )}
    >
      <span
        aria-hidden
        className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-primary [&_svg]:size-4"
      >
        {working !== undefined && <LoaderCircle className="animate-spin" />}
      </span>
    </button>
  );
}
