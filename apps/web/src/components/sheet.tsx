import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { useDialog } from "./use-dialog.ts";

/**
 * A panel that rises from the bottom of a narrow window over the page, for a few choices, with
 * Done to close it (the model and effort for a session). A touch screen's Handheld frame has its own
 * sheets (handheld-sheet.tsx). The browser's own dialog, so Escape,
 * focus and screen readers work as they should. Tapping the dimmed page closes it too. What's in it
 * is only there while it's open, so the page never holds a second copy of its controls. Safe on
 * the first load (ADR 0012): it brings no class-merging code, as a component library's dialog would.
 */
export function Sheet(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useDialog(props.open, props.onClose);

  return (
    <dialog
      {...dialog}
      aria-label={props.title}
      className="mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-lg bg-card text-card-foreground backdrop:bg-foreground/30"
    >
      {props.open && (
        <div className="flex flex-col gap-4 px-4 pt-2.5 pb-6">
          <span aria-hidden className="h-1 w-9 self-center rounded-full bg-border" />
          <h2 className="display-section text-lg/tight">{props.title}</h2>
          <div className="flex flex-col gap-3">{props.children}</div>
          <div className="flex justify-end">
            <Button onClick={props.onClose}>Done</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
