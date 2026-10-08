import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "./button.tsx";

/**
 * A panel that rises from the bottom of a phone's screen over the page, for a few choices, with
 * Done to close it (the model and effort for a session). The browser's own dialog, so Escape,
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
  const dialog = useRef<HTMLDialogElement>(null);
  const { open } = props;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard's way out is Escape, which the browser's dialog handles itself
    <dialog
      ref={dialog}
      aria-label={props.title}
      onClose={props.onClose}
      // A tap on the dialog itself, not on anything in it, is a tap on the dimmed page around it.
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      className="mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-lg bg-card text-card-foreground backdrop:bg-foreground/30"
    >
      {open && (
        <div className="flex flex-col gap-4 px-4 pt-2.5 pb-6">
          <span aria-hidden className="h-1 w-9 self-center rounded-full bg-border" />
          <h2 className="font-display text-lg/tight font-semibold">{props.title}</h2>
          <div className="flex flex-col gap-3">{props.children}</div>
          <div className="flex justify-end">
            <Button onClick={props.onClose}>Done</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
