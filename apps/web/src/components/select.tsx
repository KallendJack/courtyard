import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { classes } from "@/lib/classes";

/** A small pill's shape in a row of controls, without its colours or side padding. */
export const PILL_SHAPE =
  "rounded-full py-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** A pill's quiet colours: the composer's pickers, and a chip that isn't open. */
export const PILL_QUIET = "bg-background font-medium text-muted-foreground";

/** A small quiet pill in a row of controls: the composer's pickers, and the chip that opens them. */
export const PILL = classes(PILL_SHAPE, PILL_QUIET, "pl-3");

const LOOKS = {
  /** Small and quiet, in a row of controls (the composer's model and effort), sized to its choice. */
  pill: { box: classes(PILL, "pr-7 field-sizing-content"), chevron: "right-2.5 size-3.5" },
  /** Full width, named by a label above it (in a sheet): a TextField's look. */
  field: {
    box: "h-11 w-full rounded-lg border border-input bg-field pr-10 pl-2.5 text-base outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-accent md:text-sm",
    chevron: "right-3 size-4",
  },
} as const;

/**
 * A choice of several, as the browser's own picker, so a phone shows its own list (ADR 0012).
 * Safe on the first load.
 */
export function Select<T extends string>(props: {
  /** What's being chosen: shown above a field, and read out for a pill. */
  label: string;
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
  onChange: (value: T) => void;
  look: keyof typeof LOOKS;
  /** Only from tablet width up: on a narrow screen something else offers the choice. */
  wideOnly?: boolean;
  /** A warning about the choice, under a field (a model at its usage limit). */
  warning?: string;
}) {
  const id = useId();
  const look = LOOKS[props.look];
  const picker = (
    <span
      className={classes(
        "relative min-w-0",
        props.look === "pill" ? "inline-flex max-w-56" : "flex",
        props.wideOnly && "max-md:hidden",
      )}
    >
      <select
        id={id}
        {...(props.look === "pill" ? { "aria-label": props.label } : {})}
        value={props.value}
        // The option picked, as its own value rather than the plain string the browser gives.
        onChange={(event) => {
          const picked = props.options.find((option) => option.value === event.target.value);
          if (picked) props.onChange(picked.value);
        }}
        className={classes("min-w-0 appearance-none truncate", look.box)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className={classes(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          look.chevron,
        )}
      />
    </span>
  );
  if (props.look === "pill") return picker;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      {picker}
      {props.warning && <p className="text-xs text-destructive-text">{props.warning}</p>}
    </div>
  );
}
