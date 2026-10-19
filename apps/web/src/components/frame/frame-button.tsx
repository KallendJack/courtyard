import type { ComponentProps, ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * A model as short as it goes, as the Model button and the model line in the Skills sheet show it:
 * its initials and numbers, "Sonnet 5" as "S5".
 */
export const modelMark = (model: string) =>
  model
    .split(/[\s-]+/)
    .map((word) => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase()))
    .join("");

/**
 * The Handheld frame's buttons (#193, #194, #201, #206, Paper boards Handheld · 09, 10, 28, 29 and
 * the agreed tablet boards): thumb-sized, each pressing in a little under a finger, with the
 * theme's ring for the keyboard. Its classes are off the first load, in handheld-frame.css, and
 * apply only inside the frame's own pieces. Since nothing merges classes, each look sets its
 * colours either lit (`on`) or not (`off`), never both.
 */
const PRESS =
  "focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:opacity-40";

const KEY =
  "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-card text-rail font-bold tracking-label uppercase [&_svg]:text-foreground";

const LOOKS = {
  /** Model, Skills or Add on a tablet's right rail: its icon, or the model's mark, and its name. */
  rail: {
    base: classes(
      PRESS,
      "flex h-14 w-full shrink-0 items-center gap-3 rounded-lg pr-3 pl-4 text-left text-interface font-semibold [&_svg]:size-5 [&_svg]:shrink-0",
    ),
    off: "bg-secondary text-foreground/90 ring-1 ring-input ring-inset [&_svg]:text-foreground/85",
    /** Its sheet is open, beside it. */
    on: "bg-primary text-primary-foreground shadow-lit",
  },
  /** Settings on a tablet's right rail: quieter, under them. */
  quiet: {
    base: classes(
      PRESS,
      "flex h-12 w-full shrink-0 items-center gap-3 rounded-lg pr-3 pl-4.25 text-left text-sm font-medium text-foreground/65 [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:text-foreground/85",
    ),
    off: "",
    on: "",
  },
  /** Settings, beside the cover screen's tiles. */
  square: {
    base: classes(
      PRESS,
      "flex size-13 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground/70 [&_svg]:size-5",
    ),
    off: "",
    on: "",
  },
  /** Skills, Photo or Model in the row above the cover screen's bottom bar. */
  row: {
    base: classes(
      PRESS,
      "flex h-12 min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-lg bg-secondary px-2 text-meta/4 font-bold text-foreground/85 [&_svg]:size-4.5 [&_svg]:shrink-0",
    ),
    off: "",
    on: "",
  },
  /** Type, or Cancel while the talk strip listens, beside it on the cover screen. */
  key: {
    base: classes(PRESS, KEY, "w-16 [&_svg]:size-5.5"),
    off: "bg-secondary text-muted-foreground ring-1 ring-input ring-inset",
    /** Cancel, with a held finger slid onto it to drop what was said. */
    on: "bg-muted text-foreground ring-2 ring-foreground ring-inset",
  },
  /** One of a few to pick in a sheet, as a row across it (a skill), lit when it's the one picked. */
  choice: {
    base: "flex min-h-14.5 w-full items-center gap-3.5 rounded-lg px-3.5 py-2 text-left focus-visible:ring-3 focus-visible:ring-ring/50 enabled:active:bg-accent disabled:[&_svg]:opacity-40 [&_svg]:size-5 [&_svg]:shrink-0",
    off: "[&_svg]:text-foreground/70",
    on: "bg-accent [&_svg]:text-primary-text",
  },
  /**
   * A provider's default at the top of the Model sheet (#247, "Tablet · Model sheet: quick
   * switch"), lit in violet when it's what the message goes with.
   */
  chip: {
    base: classes(
      PRESS,
      "flex min-w-0 flex-1 basis-0 items-center justify-between gap-3 rounded-card px-4 py-3.5 text-left ring-1 ring-inset",
    ),
    off: "ring-input",
    on: "bg-muted ring-primary",
  },
  /** A heading across a sheet that folds what's under it open or shut ("More models", #247). */
  fold: {
    base: classes(
      PRESS,
      "flex w-full items-center gap-3 border-t px-1 py-3.5 text-left [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-foreground/70",
    ),
    off: "",
    on: "",
  },
  /** The line at a sheet's foot that opens another (the model, Paper board Handheld · 28). */
  line: {
    base: classes(
      PRESS,
      "flex w-full items-center gap-3 rounded-lg bg-secondary px-3.5 py-3 text-left [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:text-foreground/70",
    ),
    off: "",
    on: "",
  },
  /** "4 more Codex models": a few more to show in a sheet's list (Paper board Handheld · 29). */
  more: {
    base: classes(
      PRESS,
      "flex items-center gap-2 self-start rounded-bubble px-3 py-2.5 text-label font-bold text-foreground/70 [&_svg]:size-3 [&_svg]:shrink-0",
    ),
    off: "",
    on: "",
  },
} as const;

export function FrameButton({
  look,
  lit = false,
  type = "button",
  children,
  ...props
}: Omit<ComponentProps<"button">, "className"> & {
  look: keyof typeof LOOKS;
  /** What it opened is open (a rail button), it's what's picked (a choice), or Cancel is about to drop. */
  lit?: boolean;
  children: ReactNode;
}) {
  const { base, off, on } = LOOKS[look];
  return (
    <button
      type={type}
      className={classes("outline-none select-none", base, lit ? on : off)}
      {...props}
    >
      {children}
    </button>
  );
}
