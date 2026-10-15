import { type CSSProperties, useId } from "react";

/** The gap a sheet keeps from the screen's edges, as the page's own gutter. */
const GUTTER = 16;

/** A name for the button a sheet opens under: `anchorName` on the button, `placeUnder` on the sheet. */
export const useAnchorName = () => `--anchor-${useId().replace(/[^\w-]/g, "")}`;

/**
 * Where a sheet opens (#397): `gap` under its button, `width` wide where there's room, its `side`
 * edge level with the button's but never off the screen, and no taller than the room below, so its
 * foot stays on screen. The browser keeps it there (CSS anchor positioning), so it follows the
 * button however the page settles after it opens: measured once, it was 150 px out on the Fold when
 * the side column came in after.
 */
export const placeUnder = (
  anchor: string,
  { side, gap, width }: { side: "left" | "right"; gap: number; width: number },
): CSSProperties => {
  const wide = `min(${width}px, 100% - ${2 * GUTTER}px)`;
  return {
    positionAnchor: anchor,
    width: wide,
    top: `calc(anchor(bottom) + ${gap}px)`,
    bottom: GUTTER,
    left:
      side === "left"
        ? `clamp(${GUTTER}px, anchor(left), 100% - ${GUTTER}px - ${wide})`
        : `max(${GUTTER}px, anchor(right) - ${wide})`,
    // The room it has, down to `bottom`, but no taller than what's in it.
    height: "auto",
    maxHeight: "max-content",
  };
};
