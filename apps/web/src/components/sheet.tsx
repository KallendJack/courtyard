import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { Scroller } from "./scroller.tsx";
import { useDialog } from "./use-dialog.ts";

/**
 * A panel that rises from the bottom of a narrow window over the page, for a few choices, with
 * Done to close it (the model and effort for a session); its title and Done stay in view while
 * what's between them scrolls. A touch screen's Handheld frame has its own
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
      className="mx-0 mt-auto mb-0 w-full max-w-none overflow-hidden rounded-t-lg bg-card text-card-foreground backdrop:bg-foreground/30"
    >
      {props.open && (
        // Its title and Done stay put; only what's between them scrolls (#339).
        <div className="flex max-h-[85dvh] flex-col gap-4 pt-2.5 pb-6">
          <div className="flex shrink-0 flex-col gap-4 px-4">
            <span aria-hidden className="h-1 w-9 self-center rounded-full bg-border" />
            <h2 className="display-section text-lg/tight">{props.title}</h2>
          </div>
          <Scroller data-dialog-body="" className="flex min-h-0 flex-col gap-3 px-4">
            {props.children}
          </Scroller>
          <div className="flex shrink-0 justify-end px-4">
            <Button onClick={props.onClose}>Done</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
