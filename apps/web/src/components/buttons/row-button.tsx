import type { ComponentProps } from "react";

/**
 * A whole row of a list that opens or folds what's under it (#532; Paper, "Tablet · Roadmap"): a
 * milestone, an issue, "6 more open · 113 done". Its content is laid out by the row it's in; it
 * brings the tap, the hover and the focus ring, and says whether it's open.
 */
export function RowButton({
  expanded,
  ...props
}: Omit<ComponentProps<"button">, "className" | "type" | "aria-expanded"> & {
  expanded: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
      {...props}
    />
  );
}
