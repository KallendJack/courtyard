import { Button } from "@courtyard/ui/buttons/button.tsx";
import type { ReactNode } from "react";

/**
 * What was just done, with its Undo, while Undo can take it back: "Picked CLS" on a stock's options
 * (#704), "Have it: 5 × 80 screws" on the buy list (#760).
 */
export function UndoNote(props: {
  children: ReactNode;
  undo: () => void;
  /** Undo running. */
  undoing: boolean;
  /** Something beside it running, so Undo waits. */
  waiting: boolean;
}) {
  return (
    <p className="flex items-center justify-between gap-3 rounded-row bg-muted px-3 py-1.5 text-meta text-foreground">
      <span className="min-w-0 truncate">{props.children}</span>
      <Button
        variant="quiet"
        size="xs"
        busy={props.undoing}
        busyLabel="Undoing…"
        waiting={props.waiting}
        onClick={props.undo}
      >
        Undo
      </Button>
    </p>
  );
}
