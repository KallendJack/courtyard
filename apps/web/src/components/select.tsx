import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { classes } from "@/lib/classes";

const LOOKS = {
  /** Small and quiet, in a row of controls (the composer's model and effort). */
  pill: {
    box: "rounded-full bg-background py-1.5 pr-7 pl-3 text-xs font-medium text-muted-foreground field-sizing-content",
    chevron: "right-2.5 size-3.5",
  },
  /** Full width, named by a label above it (in a sheet). */
  field: {
    box: "w-full rounded-md border bg-field py-2.5 pr-10 pl-3.5 text-base text-foreground",
    chevron: "right-3.5 size-4",
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
  disabled?: boolean;
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
        disabled={props.disabled}
        // Only a value among the options can be picked, so this is one of them.
        onChange={(event) => {
          const picked = props.options.find((option) => option.value === event.target.value);
          if (picked) props.onChange(picked.value);
        }}
        className={classes(
          "min-w-0 appearance-none truncate outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
          look.box,
        )}
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
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {props.label}
      </label>
      {picker}
    </div>
  );
}
