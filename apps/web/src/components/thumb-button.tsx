import type { ComponentProps } from "react";
import { classes } from "@/lib/classes";

/**
 * The Paper boards' thumb-sized buttons (Handheld · 16, 17, 18), side by side at the bottom of a
 * card, in thumb reach: Deny and Allow on an approval, Close PR and Merge on a review. Its classes
 * are off the first load: they're in the stylesheets of the pieces that use it (approval-card.css,
 * review.css), and apply only inside those pieces.
 */
const BASE =
  "flex basis-0 items-center justify-center gap-2 rounded-[18px] text-base/5 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px [&_svg]:size-[18px] [&_svg]:shrink-0";

const LOOKS = {
  /** The way out: Deny, Close PR. */
  quiet: "bg-muted font-bold text-foreground hover:bg-muted/70 disabled:opacity-50",
  /** What the owner most likely wants: Allow, Merge. Greyed out, with a ring, until it can. */
  main: "bg-foreground font-extrabold text-card hover:bg-foreground/85 disabled:bg-surface disabled:text-muted-foreground disabled:ring-1 disabled:ring-border disabled:ring-inset",
} as const;

/** How much of the row it takes, beside the other. */
const GROW = { 1: "grow", 1.4: "grow-[1.4]", 1.6: "grow-[1.6]" } as const;

export function ThumbButton({
  look,
  grow = 1,
  tall = false,
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "className"> & {
  look: keyof typeof LOOKS;
  grow?: keyof typeof GROW;
  /** A little taller, at the foot of a card with more in it (an approval). */
  tall?: boolean;
}) {
  return (
    <button
      type={type}
      className={classes(BASE, LOOKS[look], GROW[grow], tall ? "h-15" : "h-14")}
      {...props}
    />
  );
}
