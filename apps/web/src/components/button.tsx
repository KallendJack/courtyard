import type { ComponentProps, ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * Courtyard's buttons (ADR 0012). Classes are joined with `classes`, not merged, so these are safe
 * on the first load; they take options rather than classes to override. Since nothing merges them,
 * no two classes here may set the same thing: each variant sets its own border colour, say.
 */
const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const VARIANTS = {
  /** The main action. */
  primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
  /** Any other action, such as Cancel. */
  outline:
    "border-border bg-background text-foreground hover:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
  /** Archiving, deleting, logging out. */
  destructive:
    "border-transparent bg-destructive/10 text-destructive-text hover:bg-destructive/20 focus-visible:ring-destructive/20",
  /** The one action that clears everything, once the owner has typed to confirm it (Start fresh). */
  destructiveFilled:
    "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/85 focus-visible:ring-destructive/20",
  /** A small action beside text that shouldn't draw the eye, such as Undo on a save's note. */
  quiet:
    "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
  /** A quiet action the owner most likely wants, such as Sign in in a list. */
  quietPrimary: "border-transparent bg-transparent text-primary-text hover:bg-accent",
  /** The way out of what a `Notice` says, such as Get a new code. */
  notice:
    "border-destructive-text bg-transparent text-destructive-text hover:bg-destructive/10 focus-visible:ring-destructive/20",
  /** A suggested reply under an answer, sent with a tap. */
  reply: "border-border bg-field text-primary-text hover:bg-accent",
} as const;

/** One line of bold text, at a set height. */
const ONE_LINE = "font-semibold whitespace-nowrap";

const SIZES = {
  /** A quiet action in a line of text: a full-size tap target on a phone. */
  xs: classes(ONE_LINE, "h-9 px-3 text-sm md:h-7 md:px-2"),
  /** Beside text or in a box (a notice, a form in a list). */
  sm: classes(ONE_LINE, "h-8 px-4 text-sm"),
  md: classes(ONE_LINE, "h-9 px-5 text-sm"),
  /** A form's only action on its own page (logging in). */
  lg: classes(ONE_LINE, "h-11 px-5 text-sm"),
  /** Words that wrap when they're long, as tall as they need (a suggested reply). */
  wraps: "max-w-full px-4 py-2 text-left text-sm font-medium wrap-anywhere",
} as const;

/** A Button's look, for a link that looks like one (ButtonLink). */
export const buttonLook = (look: { variant: keyof typeof VARIANTS; size: keyof typeof SIZES }) =>
  classes(BASE, VARIANTS[look.variant], SIZES[look.size]);

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
  /** On the corner of a thumbnail (removing an attachment). */
  badge: "size-5 [&_svg:not([class*='size-'])]:size-2.5",
  /** The message box's paperclip, on its disc. */
  disc: "size-7 [&_svg:not([class*='size-'])]:size-[15px]",
  /** Alone over a full-screen view, a thumb's tap target (closing the photo viewer). */
  lg: "size-11 [&_svg:not([class*='size-'])]:size-[22px]",
  /** In a list row. */
  sm: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
  md: "size-9 [&_svg:not([class*='size-'])]:size-[18px]",
  /** Under an answer: a full-size tap target on a phone, smaller on a desktop (Copy answer). */
  action:
    "size-9 md:size-7 [&_svg:not([class*='size-'])]:size-[17px] md:[&_svg:not([class*='size-'])]:size-[15px]",
  /** Inside a small pill, without making it taller (a skill's tag in the message box). */
  inline: "-my-1 size-[18px] [&_svg:not([class*='size-'])]:size-3.5",
} as const;

const ICON_LOOKS = {
  quiet: "text-muted-foreground hover:bg-muted hover:text-foreground",
  /** Shown pressed, while what it opened is open on the page (a confirm step, say). */
  pressed: "bg-muted text-foreground",
  /** On a disc in heather: an action beside each line of a list (Grill this plan). */
  filled: "bg-background text-primary-text hover:bg-accent",
  /** In the colour of the pill it's inside (a skill's tag). */
  inPill: "text-current hover:bg-primary/10",
  /** On a quiet disc among the message box's pills (the paperclip). */
  disc: "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
  /** A dark badge ringed in the box's colour, on the corner of a thumbnail (Remove). */
  badge: "border-2 border-field bg-foreground text-background [&_svg]:stroke-3",
  /** Light on the photo viewer's dark ground. */
  onViewer: "text-viewer-foreground hover:bg-viewer-foreground/10",
  /** On a heather wash: what it does has just been done (Copied). */
  done: "bg-accent text-primary-text",
} as const;

/** A quiet button that's only an icon, named for screen readers (and on hover) by `label`. */
export function IconButton({
  label,
  icon,
  size = "md",
  square = false,
  expanded,
  look = "quiet",
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
  look?: keyof typeof ICON_LOOKS;
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
        "inline-flex shrink-0 items-center justify-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0",
        square ? "rounded-md" : "rounded-full",
        ICON_LOOKS[look],
        ICON_SIZES[size],
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
