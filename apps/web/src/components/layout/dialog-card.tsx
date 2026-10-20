import type { ReactNode } from "react";
import { classes } from "@/lib/classes";
import { useDialog } from "./use-dialog.ts";

/**
 * A card in the middle of the screen over the dimmed page, for one decision with a few choices
 * (#428; Paper, "Allow all for this task: how long" and "Run the build order: Allow all for
 * builders"): its title, a line on what it does, what's between, and its actions at the foot. The
 * browser's own dialog, so Escape, focus and screen readers work as they should, and a tap on the
 * page around it closes it. What's in it is only there while it's open. Safe on the first load
 * (ADR 0012).
 */
export function DialogCard(props: {
  title: string;
  /** What it does, in a line under the title. */
  says: ReactNode;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  /** Its actions, at the foot: Cancel, then the one it's for. */
  actions: ReactNode;
  /**
   * On a narrow screen it rises from the bottom instead, full width, its actions one under the
   * other, the one it's for first (#551; Paper, "Cover · Lead row: Allow all sheet").
   */
  rises?: boolean;
}) {
  const dialog = useDialog(props.open, props.onClose);
  const rises = props.rises === true;
  return (
    <dialog
      {...dialog}
      aria-label={props.title}
      className={classes(
        "m-auto w-[min(30rem,calc(100vw-2rem))] max-w-none rounded-tile border border-input bg-popover text-popover-foreground shadow-raised backdrop:bg-card/60",
        rises && "max-md:mx-0 max-md:mb-0 max-md:w-full max-md:rounded-b-none max-md:border-b-0",
      )}
    >
      {props.open && (
        <div className={classes("flex flex-col gap-4 p-5", rises && "max-md:pt-2.5")}>
          {rises && (
            <span aria-hidden className="h-1 w-9 self-center rounded-full bg-border md:hidden" />
          )}
          <div className="flex flex-col gap-1.5">
            <h2 className="display-section text-card-title tracking-[-0.015em] text-foreground">
              {props.title}
            </h2>
            <p className="text-meta text-muted-foreground">{props.says}</p>
          </div>
          {props.children}
          <div className={classes("flex gap-2.5", rises && "max-md:flex-col-reverse")}>
            {props.actions}
          </div>
        </div>
      )}
    </dialog>
  );
}
