import type { ReactNode } from "react";
import { classes } from "../lib/classes.ts";

/**
 * Its colour, by what each means (AGENTS.md): violet the owner's or chosen, gold something to know
 * or that needs someone else, moss fine, grey the rest.
 */
const TONES = {
  /** Chosen, filled: the option a Build uses (#704). */
  chosen: "bg-primary text-primary-foreground",
  /** The owner's: a step they do. */
  owner: "bg-primary/12 text-primary-text",
  /** Something to know, or a pro's job. */
  needs: "bg-warning/10 text-warning",
  /** Fine as it is. */
  fine: "bg-muted text-success",
  /** Plain words: an option recommended. */
  plain: "bg-muted text-foreground",
  /** Quiet: what Courtyard does. */
  quiet: "bg-secondary text-muted-foreground",
} as const;

/** A chip's colour, by what it means. */
export type ChipTone = keyof typeof TONES;

const SIZES = {
  /** On its own in a row: a project step's who. */
  md: "h-6 px-2.5 text-label",
  /** Several in a line under a choice: a stock option's notes. */
  sm: "h-5.5 px-2 text-caption",
} as const;

/**
 * A chip: a few words in a pill that say what something is or what to know about it, never a
 * button (that's `button.tsx`). Shared, so every chip looks the same; it takes options, not
 * classes, since nothing merges them.
 */
export function Chip(props: {
  tone: ChipTone;
  size?: keyof typeof SIZES;
  /** Bold, for the one that marks a choice (Picked, Recommended). */
  strong?: boolean;
  children: ReactNode;
}) {
  const size = props.size ?? "md";
  return (
    <span
      className={classes(
        "flex shrink-0 items-center rounded-full",
        TONES[props.tone],
        SIZES[size],
        props.strong === true ? "font-bold" : size === "md" ? "font-semibold" : undefined,
      )}
    >
      {props.children}
    </span>
  );
}
