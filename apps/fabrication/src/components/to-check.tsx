import { classes } from "@courtyard/ui/lib/classes.ts";

const SIZES = {
  /** A Build's top bar (#698). */
  md: "h-10 gap-2 px-4 text-interface font-bold",
  /** A space's top bar (#709; the room's boards, "1 to check"). */
  sm: "h-8 gap-1.5 px-3 text-label font-semibold",
} as const;

/**
 * "N to check" in a page's top bar, in gold: what the owner needs to look at, opened with a tap.
 * Shared, so a Build's and a space's look the same but for their size.
 */
export function ToCheck(props: { count: number; size?: keyof typeof SIZES; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={classes(
        "flex shrink-0 items-center rounded-full border border-warning/50 bg-warning/10 text-warning",
        SIZES[props.size ?? "md"],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-warning shadow-glow-needs" />
      {props.count} to check
    </button>
  );
}
