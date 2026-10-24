import { classes } from "@courtyard/ui/lib/classes.ts";
import type { ComponentProps } from "react";

type RowButtonProps = Omit<
  ComponentProps<"button">,
  "className" | "type" | "aria-expanded" | "aria-pressed"
> &
  (
    | {
        /** A row that opens or folds what's under it, and says whether it's open. */
        expanded: boolean;
        chosen?: never;
        compact?: never;
      }
    | {
        /** A row that picks it, the chosen row ringed in violet. */
        chosen: boolean;
        /** Less room above and below, on the cover screen. */
        compact?: boolean;
        expanded?: never;
      }
  );

/**
 * A whole row of a list as one button. Either it opens or folds what's under it (#532; Paper,
 * "Tablet · Roadmap"): a milestone, an issue, "6 more open · 113 done". Or it picks the row (#565;
 * Paper, "Cover · Planning Home: the bike, part by part"): a part under its Thing's photo. Its content is
 * laid out by the row it's in; it brings the tap, the hover and the focus ring. Safe on the first
 * load (ADR 0012).
 */
export function RowButton({ expanded, chosen, compact, ...props }: RowButtonProps) {
  if (chosen === undefined) {
    return (
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
        {...props}
      />
    );
  }
  return (
    <button
      type="button"
      aria-pressed={chosen}
      className={classes(
        "flex w-full items-center gap-3 rounded-row px-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        compact === true ? "py-2" : "py-2.5",
        chosen ? "bg-primary/12 ring-1 ring-primary-text ring-inset" : "hover:bg-secondary",
      )}
      {...props}
    />
  );
}
