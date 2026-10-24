import { type Busy, useBusy } from "@courtyard/ui/buttons/button.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import type { ComponentProps } from "react";

/**
 * The Paper boards' thumb-sized buttons (Handheld · 16, 17, 18), side by side at the bottom of a
 * card, in thumb reach: Deny and Allow on an approval, Merge and Close PR on a review; or one at
 * the end of a row that needs the owner (a code workspace's Needs you, #301). Its classes are off
 * the first load: they're in the stylesheets of the pieces that use it (approval-card.css,
 * review.css, code-home.css), and apply only inside those pieces.
 */
const BASE =
  "flex items-center justify-center gap-2 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px [&_svg]:size-[18px] [&_svg]:shrink-0";

const LOOKS = {
  /** The way out: Deny, Close PR. */
  quiet: "bg-muted font-bold text-foreground hover:bg-muted/70 disabled:opacity-50",
  /**
   * What the owner most likely wants: Allow, Merge. Greyed out, with a ring, until it can; the
   * same when it's `aria-disabled`, which still takes a tap, to say why it waits (#329).
   */
  main: "bg-foreground font-extrabold text-card hover:bg-foreground/85 disabled:bg-surface disabled:text-muted-foreground disabled:ring-1 disabled:ring-border disabled:ring-inset aria-disabled:bg-surface aria-disabled:text-muted-foreground aria-disabled:ring-1 aria-disabled:ring-border aria-disabled:ring-inset",
  /** The one big action of a screen, in violet: Merge (#240). Greyed out the same way. */
  primary:
    "bg-primary font-bold text-primary-foreground hover:bg-primary/85 disabled:bg-surface disabled:text-muted-foreground disabled:ring-1 disabled:ring-border disabled:ring-inset aria-disabled:bg-surface aria-disabled:text-muted-foreground aria-disabled:ring-1 aria-disabled:ring-border aria-disabled:ring-inset",
  /** In gold, as what needs the owner: Approve on a row of Needs you (#301). */
  needs: "bg-warning font-bold text-background hover:bg-warning/85 disabled:opacity-50",
  /** Ringed in gold, a quieter choice that needs the owner: an approval's Allow always (#185). */
  ringed:
    "bg-transparent font-bold text-foreground ring-1 ring-warning/35 ring-inset hover:bg-warning/10 disabled:opacity-50",
} as const;

/** How much of the row it takes, beside the other. */
const GROW = { 1: "grow", 1.4: "grow-[1.4]", 1.6: "grow-[1.6]", 3: "grow-[3]" } as const;

export function ThumbButton({
  look,
  grow = 1,
  tall = false,
  low = false,
  fit = false,
  row = false,
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
    look: keyof typeof LOOKS;
    grow?: keyof typeof GROW;
    /** A little taller, at the foot of a card with more in it (an approval). */
    tall?: boolean;
    /** A little lower, for a quieter choice under the card's own (an approval's Allow always). */
    low?: boolean;
    /**
     * As wide as its words, beside a title rather than in thumb reach (a desktop's Merge and Close
     * PR, #278).
     */
    fit?: boolean;
    /** A pill at the end of a row, the same width on every row (Needs you's Merge, Approve, #301). */
    row?: boolean;
  }) {
  const { working, attributes } = useBusy({ busy, busyLabel, onClick });
  return (
    <button
      type={type}
      className={classes(
        BASE,
        LOOKS[look],
        row
          ? "h-9 min-w-24 shrink-0 rounded-full px-4 text-sm/4.5"
          : fit
            ? "h-12 shrink-0 rounded-lg px-5 text-base/5"
            : low
              ? classes("h-11 basis-0 rounded-card text-sm/4.5", GROW[grow])
              : classes("basis-0 rounded-card text-base/5", GROW[grow], tall ? "h-15" : "h-14"),
      )}
      disabled={disabled === true || waiting}
      {...props}
      {...attributes}
    >
      {working ?? children}
    </button>
  );
}
