import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * A whole row of a list as one button that picks it (#481; Paper, "Tablet · Home: the bike, parts
 * pinned"): what needs doing beside a photo, the chosen row ringed in violet. What's in the row is
 * the caller's. Safe on the first load (ADR 0012).
 */
export function RowButton(props: {
  chosen: boolean;
  /** Less room above and below, on the cover screen. */
  compact?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.chosen}
      onClick={props.onClick}
      className={classes(
        "flex w-full items-center gap-3 rounded-row px-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        props.compact === true ? "py-2" : "py-2.5",
        props.chosen ? "bg-primary/12 ring-1 ring-primary-text ring-inset" : "hover:bg-secondary",
      )}
    >
      {props.children}
    </button>
  );
}
