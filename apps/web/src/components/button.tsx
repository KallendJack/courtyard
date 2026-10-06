import type { ComponentProps, ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * Courtyard's buttons (ADR 0012). Classes are joined with `classes`, not merged, so these are safe
 * on the first load; they take options rather than classes to override. Since nothing merges them,
 * no two classes here may set the same thing: each variant sets its own border colour, say.
 */
const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const VARIANTS = {
  /** The main action. */
  primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
  /** Any other action, such as Cancel. */
  outline: "border-border bg-background text-foreground hover:bg-muted",
  /** Archiving, deleting, logging out. */
  destructive:
    "border-transparent bg-destructive/10 text-destructive-text hover:bg-destructive/20 focus-visible:ring-destructive/20",
} as const;

const SIZES = {
  /** Beside text or in a box (a notice, a form in a list). */
  sm: "h-8 px-4 text-sm",
  md: "h-9 px-5 text-sm",
  /** A form's only action on its own page (logging in). */
  lg: "h-11 px-5 text-sm",
} as const;

/** A pill button: the main action filled, the others outlined. */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  narrowIcon,
  type = "button",
  children,
  ...props
}: Omit<ComponentProps<"button">, "className"> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  fullWidth?: boolean;
  /** On a narrow screen, only this icon shows, in a round button; the label stays for screen readers. */
  narrowIcon?: ReactNode;
}) {
  const collapses = narrowIcon !== undefined;
  return (
    <button
      type={type}
      className={classes(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        collapses && "max-md:size-9 max-md:px-0",
      )}
      {...props}
    >
      {collapses ? (
        <>
          <span aria-hidden className="contents md:hidden">
            {narrowIcon}
          </span>
          <span className="inline-flex items-center gap-1.5 max-md:sr-only">{children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

const ICON_SIZES = {
  /** Around a colour dot. */
  xs: "size-5",
  /** In a list row. */
  sm: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
  md: "size-9 [&_svg:not([class*='size-'])]:size-[18px]",
} as const;

/** A quiet button that's only an icon, named for screen readers (and on hover) by `label`. */
export function IconButton({
  label,
  icon,
  size = "md",
  square = false,
  expanded,
  active = false,
  hint,
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "className" | "children" | "aria-label" | "title"> & {
  label: string;
  icon: ReactNode;
  size?: keyof typeof ICON_SIZES;
  /** Rounded square rather than round, to match the sidebar's rows. */
  square?: boolean;
  /** For a button that opens or shows something: whether it's open, for screen readers. */
  expanded?: boolean;
  /** Shown pressed, while what it opened is open on the page (a confirm step, say). */
  active?: boolean;
  /** Added to the hover text, such as a keyboard shortcut. */
  hint?: string;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={hint === undefined ? label : `${label} (${hint})`}
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
      className={classes(
        "inline-flex shrink-0 items-center justify-center transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:shrink-0",
        square ? "rounded-md" : "rounded-full",
        active ? "bg-muted text-foreground" : "text-muted-foreground",
        ICON_SIZES[size],
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
