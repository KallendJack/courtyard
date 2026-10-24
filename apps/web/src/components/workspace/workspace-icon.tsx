import type { WorkspaceIcon as Icon } from "@courtyard/contract";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { lazy, Suspense } from "react";

/** The icons themselves, loaded once a page first shows one, so they stay off the first load. */
const WorkspaceMark = lazy(() => import("./workspace-marks.tsx"));

const SIZES = {
  /** Beside a name in a line of text: the way back to a workspace. */
  sm: "size-3.5",
  /** Beside a name in a list: the sidebar, the strip. */
  md: "size-4",
  /** On a workspace's tile in the Handheld frame. */
  tile: "size-5",
  /** One to pick in the Icon sheet. */
  lg: "size-6",
  /** On a workspace's tile on Home (#102). */
  home: "size-7",
} as const;

/**
 * A workspace's icon (#210, Paper board Handheld · 36): white, or violet on the workspace that's
 * open. Its slot keeps its size while the icons load.
 */
export function WorkspaceIcon(props: { icon: Icon; size: keyof typeof SIZES; open?: boolean }) {
  return (
    <span
      aria-hidden
      className={classes(
        "flex shrink-0",
        SIZES[props.size],
        props.open ? "text-primary-text" : "text-foreground/85",
      )}
    >
      <Suspense>
        <WorkspaceMark icon={props.icon} />
      </Suspense>
    </span>
  );
}
