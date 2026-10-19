import type { ReactNode } from "react";

/** The ring's size and shape: the same with a photo or without, so nothing moves when one comes. */
const RING =
  "flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-tile ring-stroke ring-offset-2 ring-offset-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:size-24 md:rounded-sheet";

/**
 * A photo's ring, top right of a planning workspace's header (#481; Paper, "Tablet · Home: the
 * bike, parts pinned"), for the link round a photo shown in it. Safe on the first load (ADR 0012).
 */
export const photoRingLook = `${RING} bg-muted ring-chart-slate`;

/** The ring with no photo yet: what's shown in its place (an icon), offering one when tapped. */
export function EmptyPhotoRing(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-haspopup="dialog"
      onClick={props.onClick}
      className={`${RING} bg-secondary ring-input`}
    >
      {props.children}
    </button>
  );
}
