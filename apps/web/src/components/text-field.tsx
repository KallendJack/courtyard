import { type ComponentProps, useId } from "react";
import { classes } from "@/lib/classes";
import { FormError } from "./form-error.tsx";

const SIZES = {
  /** In a list row (the sidebar). */
  sm: "h-9 px-2.5 text-sm",
  /** 16px on a phone, so focusing it doesn't zoom the page; 14px from tablet width. */
  md: "h-11 px-2.5 text-base md:text-sm",
  /** Renaming a page's title, in the title's own type. */
  title: "h-12 px-3 font-display text-2xl font-medium tracking-[-0.02em]",
} as const;

/**
 * A labelled text box in the Moorland theme, with its error underneath (ADR 0012). Safe on the
 * first load. Everything else an input takes (type, value, autoComplete, a ref) passes through.
 */
export function TextField({
  label,
  hideLabel = false,
  optional = false,
  hint,
  error,
  size = "md",
  ...props
}: Omit<ComponentProps<"input">, "className" | "id" | "size"> & {
  label: string;
  /** For a box whose place says what it is (a title being renamed): the label is for screen readers. */
  hideLabel?: boolean;
  /** Says "Optional" beside the label, for a box the owner can leave empty. */
  optional?: boolean;
  /** A line under the box on what to put in it, which also describes it to screen readers. */
  hint?: string;
  error?: string | undefined;
  size?: keyof typeof SIZES;
}) {
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ");
  const labelled = (
    <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-medium"}>
      {label}
    </label>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {optional ? (
        <div className="flex items-baseline gap-2">
          {labelled}
          <span className="text-xs text-muted-foreground">Optional</span>
        </div>
      ) : (
        labelled
      )}
      <input
        id={id}
        {...(error ? { "aria-invalid": true } : {})}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        className={classes(
          "w-full min-w-0 rounded-lg border border-input bg-field outline-none transition-colors placeholder:text-placeholder focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-accent disabled:opacity-50 aria-invalid:border-destructive",
          SIZES[size],
        )}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FormError id={errorId} message={error} />
    </div>
  );
}
