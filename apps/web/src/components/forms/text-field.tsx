import { type ComponentProps, type KeyboardEvent, type ReactNode, useId } from "react";
import { classes } from "@/lib/classes";
import { FormError } from "./form-error.tsx";

const SIZES = {
  /** In a list row (the sidebar). */
  sm: "h-9 px-2.5 text-sm",
  /** 16px on a phone, so focusing it doesn't zoom the page; 14px from tablet width. */
  md: "h-11 px-2.5 text-base md:text-sm",
  /** Renaming a page's title, in the title's own type. */
  title: "h-12 px-3 display-title text-2xl",
} as const;

/** The box itself, whichever kind. */
const BOX =
  "w-full min-w-0 rounded-lg border border-input bg-field outline-none transition-colors placeholder:text-placeholder focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-accent disabled:opacity-50 aria-invalid:border-destructive";

/** What every field has round its box: its label, and a hint and its error under it. */
type Around = {
  label: string;
  /** For a box whose place says what it is (a title being renamed): the label is for screen readers. */
  hideLabel?: boolean;
  /** Says "Optional" beside the label, for a box the owner can leave empty. */
  optional?: boolean;
  /** A line under the box on what to put in it, which also describes it to screen readers. */
  hint?: string;
  error?: string | undefined;
};

/** A field's label, hint and error round its box, which `box` draws with the ids it's given. */
function Field(
  props: Around & {
    box: (ids: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
  },
) {
  const { label, hideLabel = false, optional = false, hint, error } = props;
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
          <span className="text-meta text-muted-foreground">Optional</span>
        </div>
      ) : (
        labelled
      )}
      {props.box({
        id,
        ...(error ? { "aria-invalid": true } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-meta text-muted-foreground">
          {hint}
        </p>
      )}
      <FormError id={errorId} message={error} />
    </div>
  );
}

/**
 * A labelled text box in the theme, with its error underneath (ADR 0012). Safe on the
 * first load. Everything else an input takes (type, value, autoComplete, a ref) passes through.
 */
export function TextField({
  label,
  hideLabel,
  optional,
  hint,
  error,
  size = "md",
  ...props
}: Omit<ComponentProps<"input">, "className" | "id" | "size"> &
  Around & {
    size?: keyof typeof SIZES;
  }) {
  return (
    <Field
      label={label}
      {...(hideLabel === undefined ? {} : { hideLabel })}
      {...(optional === undefined ? {} : { optional })}
      {...(hint === undefined ? {} : { hint })}
      error={error}
      box={(ids) => <input {...ids} className={classes(BOX, SIZES[size])} {...props} />}
    />
  );
}

/**
 * A line of text that wraps to show all of itself, growing as it does, in place of a text box
 * that would hide what doesn't fit (a repo's description filled in, #258). Still one line: Enter
 * sends the form. Safe on the first load. Everything else a textarea takes passes through.
 */
export function WrappingTextField({
  label,
  hideLabel,
  optional,
  hint,
  error,
  ...props
}: Omit<ComponentProps<"textarea">, "className" | "id" | "rows"> & Around) {
  const enter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };
  return (
    <Field
      label={label}
      {...(hideLabel === undefined ? {} : { hideLabel })}
      {...(optional === undefined ? {} : { optional })}
      {...(hint === undefined ? {} : { hint })}
      error={error}
      box={(ids) => (
        <textarea
          {...ids}
          rows={1}
          onKeyDown={enter}
          className={classes(
            BOX,
            "min-h-11 resize-none px-2.5 py-2.5 text-base field-sizing-content md:text-sm",
          )}
          {...props}
        />
      )}
    />
  );
}
