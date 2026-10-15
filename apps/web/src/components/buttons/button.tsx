import { LoaderCircle } from "lucide-react";
import { type ComponentProps, type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { classes } from "@/lib/classes";

/**
 * A button shows it's working (#330; Paper, "Component · A button shows it's working"): while
 * what the owner tapped runs, its button keeps its colour and size and ignores more taps, and once
 * it has run for a moment, a spinner takes its icon's place and `busyLabel` says what it's doing
 * ("Merging…"). Greyed out (`disabled`) only ever means it can't right now. `waiting` is for the
 * actions beside a working one (Close PR while Merge merges): dimmed, as when they can't.
 */
export type Busy =
  | { busy?: never; busyLabel?: never; waiting?: boolean }
  | { busy: boolean; busyLabel: string; waiting?: boolean };

/** How long a quick action has before it shows it's working, so it never flashes (as #269). */
const WORKING_AFTER_MS = 300;

/**
 * What a button that might be busy shows and does: its content, swapped for a spinner and what
 * it's doing once it has been busy a moment, and its tap, ignored while it's busy.
 */
export const useBusy = (props: {
  busy: boolean;
  busyLabel: string | undefined;
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
}) => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!props.busy) return;
    const timer = setTimeout(() => setShown(true), WORKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [props.busy]);
  return {
    /** The spinner and what it's doing, once it shows; else nothing. */
    working:
      props.busy && shown ? (
        <>
          <LoaderCircle aria-hidden className="animate-spin" />
          {props.busyLabel}
        </>
      ) : undefined,
    attributes: {
      ...(props.busy ? { "aria-busy": true } : {}),
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        // A form's submit button too: a press while it works sends nothing again.
        if (props.busy) event.preventDefault();
        else props.onClick?.(event);
      },
    },
  };
};

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
  /** The main action on something that needs the owner first, in gold (Grill, #363). */
  needs: "border-transparent bg-warning text-background hover:bg-warning/85",
  /** Any other action, such as Cancel. */
  outline: "border-input bg-input/30 text-foreground hover:bg-input/50",
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
  /** An action on what's new, beside its list's heading, such as Mark all read (#345). */
  soft: "border-primary/30 bg-primary/10 text-primary-text hover:bg-primary/20",
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
  grow = false,
  narrowIcon,
  type = "button",
  busy = false,
  busyLabel,
  waiting = false,
  disabled,
  onClick,
  children,
  ...props
}: Omit<ComponentProps<"button">, "className"> &
  Busy & {
    variant?: keyof typeof VARIANTS;
    size?: keyof typeof SIZES;
    fullWidth?: boolean;
    /** Fills what's left of its row beside other buttons (Start building beside Cancel). */
    grow?: boolean;
    /** On a narrow screen, only this icon shows, in a round button; the label stays for screen readers. */
    narrowIcon?: ReactNode;
  }) {
  const collapses = narrowIcon !== undefined;
  const { working, attributes } = useBusy({ busy, busyLabel, onClick });
  return (
    <button
      type={type}
      className={classes(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        grow && "grow",
        collapses && "max-md:size-9 max-md:px-0",
      )}
      disabled={disabled === true || waiting}
      {...props}
      {...attributes}
    >
      {collapses ? (
        <>
          <span aria-hidden className="contents md:hidden">
            {working === undefined ? narrowIcon : <LoaderCircle className="animate-spin" />}
          </span>
          <span className="inline-flex items-center gap-1.5 max-md:sr-only">
            {working ?? children}
          </span>
        </>
      ) : (
        (working ?? children)
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
  /** Under an answer: a full-size tap target on a phone, smaller on a desktop (Copy answer). */
  action:
    "size-9 md:size-7 [&_svg:not([class*='size-'])]:size-[17px] md:[&_svg:not([class*='size-'])]:size-[15px]",
  /** Inside a small pill, without making it taller (a skill's tag in the message box). */
  inline: "-my-1 size-[18px] [&_svg:not([class*='size-'])]:size-3.5",
  /** A thumb's size: the Reply box's buttons (#206, #251). */
  thumb: "size-11 [&_svg:not([class*='size-'])]:size-4",
} as const;

const ICON_LOOKS = {
  quiet: "text-muted-foreground hover:bg-muted hover:text-foreground",
  /** Shown pressed, while what it opened is open on the page (a confirm step, say). */
  pressed: "bg-muted text-foreground",
  /** Ringed in violet, while the menu it opened is open over the page (a workspace's ⋯). */
  open: "bg-muted text-foreground ring-stroke ring-primary-text",
  /** On a disc in violet: an action beside each line of a list (Grill this plan). */
  filled: "bg-background text-primary-text hover:bg-accent",
  /** In the colour of the pill it's inside (a skill's tag). */
  inPill: "text-current hover:bg-primary/10",
  /** On a quiet disc (a quick question's action). */
  disc: "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
  /** A dark badge ringed in the box's colour, on the corner of a thumbnail (Remove). */
  badge: "border-2 border-field bg-foreground text-background",
  /** On a charcoal wash: what it does has just been done (Copied). */
  done: "bg-accent text-primary-text",
  /** On a lilac disc: what's playing now (step by step's Pause, while a step is read aloud, #241). */
  playing: "bg-primary-text text-secondary hover:bg-primary-text/85",
  /** Filled violet: the main action, as an icon (↑, sending what was said). */
  primary: "bg-primary text-primary-foreground hover:bg-primary/80",
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
  busy = false,
  busyLabel,
  waiting = false,
  disabled,
  onClick,
  ...props
}: Omit<ComponentProps<"button">, "className" | "children" | "aria-label" | "title"> &
  Busy & {
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
  const { working, attributes } = useBusy({ busy, busyLabel, onClick });
  // Working, its spinner takes the icon's place, and its name says what it's doing.
  const name = working === undefined || busyLabel === undefined ? label : busyLabel;
  return (
    <button
      type={type}
      aria-label={name}
      title={hint === undefined ? name : `${name} (${hint})`}
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
      className={classes(
        "inline-flex shrink-0 items-center justify-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 [&_svg]:shrink-0",
        square ? "rounded-md" : "rounded-full",
        ICON_LOOKS[look],
        ICON_SIZES[size],
      )}
      disabled={disabled === true || waiting}
      {...props}
      {...attributes}
    >
      {working === undefined ? icon : <LoaderCircle aria-hidden className="animate-spin" />}
    </button>
  );
}
