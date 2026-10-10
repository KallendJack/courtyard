import type { ComponentProps, ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * The Handheld frame's buttons (#193, #194, Paper boards Handheld · 00, 09, 10): thumb-sized, each
 * pressing in a little under a finger, with the theme's ring for the keyboard. Its classes are off
 * the first load, in handheld-frame.css, and apply only inside the frame's own pieces. Since
 * nothing merges classes, each look sets its colours either lit (`on`) or not (`off`), never both.
 */
const PRESS =
  "focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:opacity-40";

const KEY =
  "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-card text-[10px]/3 font-bold tracking-[0.08em] uppercase [&_svg]:text-foreground";

const LOOKS = {
  /** Settings, at the top of a tablet's right rail. */
  round: {
    base: classes(
      PRESS,
      "flex size-12 shrink-0 items-center justify-center rounded-full bg-muted/60 text-foreground/70 [&_svg]:size-5",
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
  /** Skills, Photo or Model on a tablet's right rail: a disc, with `caption` under it. */
  disc: { base: "group flex flex-col items-center gap-1.5 disabled:opacity-40", off: "", on: "" },
  /** Skills, Photo or Model in the row above the cover screen's bottom bar. */
  row: {
    base: classes(
      PRESS,
      "flex h-12 min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-lg bg-secondary px-2 text-xs/4 font-bold text-foreground/85 [&_svg]:size-4.5 [&_svg]:shrink-0",
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
  /** Type or Cancel on a tablet, where the bottom bar is taller. */
  wideKey: {
    base: classes(PRESS, KEY, "h-15 w-18 [&_svg]:size-6"),
    off: "bg-secondary text-muted-foreground ring-1 ring-input ring-inset",
    on: "bg-muted text-foreground ring-2 ring-foreground ring-inset",
  },
  /** One of a few to pick in a sheet, as a row across it (a skill), lit when it's the one picked. */
  choice: {
    base: "flex min-h-14.5 w-full items-center gap-3.5 rounded-lg px-3.5 py-2 text-left focus-visible:ring-3 focus-visible:ring-ring/50 enabled:active:bg-accent disabled:[&_svg]:opacity-40 [&_svg]:size-5 [&_svg]:shrink-0",
    off: "[&_svg]:text-foreground/70",
    on: "bg-accent [&_svg]:text-primary-text",
  },
} as const;

const DISC =
  "flex size-15 items-center justify-center rounded-full text-[15px]/[18px] font-extrabold group-focus-visible:ring-3 group-focus-visible:ring-ring/50 group-active:translate-y-px [&_svg]:size-5.5";

export function FrameButton({
  look,
  lit = false,
  caption,
  type = "button",
  children,
  ...props
}: Omit<ComponentProps<"button">, "className"> & {
  look: keyof typeof LOOKS;
  /** What it opened is open (a disc), it's what's picked (a choice), or Cancel is about to drop. */
  lit?: boolean;
  /** Under a disc: what it is. */
  caption?: string;
  children: ReactNode;
}) {
  const { base, off, on } = LOOKS[look];
  return (
    <button
      type={type}
      className={classes("outline-none select-none", base, lit ? on : off)}
      {...props}
    >
      {look === "disc" ? (
        <>
          <span
            className={classes(
              DISC,
              lit
                ? "bg-primary text-primary-foreground shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-primary)_20%,transparent),0_0_24px_color-mix(in_oklab,var(--color-primary)_50%,transparent)]"
                : "bg-secondary text-foreground ring-1 ring-input ring-inset",
            )}
          >
            {children}
          </span>
          <span
            className={classes(
              "text-[11px]/3.5 font-bold tracking-[0.06em] uppercase",
              lit ? "text-foreground" : "text-placeholder",
            )}
          >
            {caption}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
