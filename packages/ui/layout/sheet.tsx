import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton } from "../buttons/button.tsx";
import { useDialog } from "../hooks/use-dialog.ts";
import { classes } from "../lib/classes.ts";
import { Scroller } from "./scroller.tsx";

/** Where a sheet comes in from, and how much of the screen it takes. */
const FROM = {
  /** The bottom of a narrow window, as tall as what's in it, up to most of the screen. */
  bottom: "mx-0 mt-auto mb-0 w-full max-w-none rounded-t-lg",
  /** The right edge, the screen's full height (Fabrication's chat on the unfolded Fold). */
  right: "my-0 mr-0 ml-auto h-dvh max-h-none w-full max-w-xl rounded-l-sheet border-l shadow-sheet",
  /** The whole screen (Fabrication's chat on the folded Fold). */
  screen: "m-0 h-dvh max-h-none w-full max-w-none",
} as const;

/**
 * A panel over the page (the model and effort for a session; Fabrication's chat, #753). Its title
 * stays in view while what's under it scrolls. The browser's own dialog, so Escape, focus and
 * screen readers work as they should; tapping the dimmed page closes it too. A touch screen's
 * Handheld frame has its own sheets (the web app's handheld-sheet.tsx). Safe on the first load
 * (ADR 0012): it brings no class-merging code, as a component library's dialog would.
 *
 * - `choices` (the default): a few choices, with Done at its foot to close it. What's in it is
 *   only there while it's open, so the page never holds a second copy of its controls.
 * - `conversation`: a chat, which scrolls itself and ends in its own Reply box, so × by the title
 *   closes it. It stays on the page while closed, so a half-written message is still there when
 *   it opens again.
 */
export function Sheet(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  from?: keyof typeof FROM;
  kind?: "choices" | "conversation";
  children: ReactNode;
}) {
  const dialog = useDialog(props.open, props.onClose);
  const conversation = props.kind === "conversation";

  return (
    <dialog
      {...dialog}
      aria-label={props.title}
      className={classes(
        "overflow-hidden bg-card text-card-foreground backdrop:bg-foreground/30",
        FROM[props.from ?? "bottom"],
      )}
    >
      {conversation ? (
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h2 className="display-section text-lg/tight">{props.title}</h2>
            <IconButton label="Close" icon={<X aria-hidden />} onClick={props.onClose} />
          </div>
          {props.children}
        </div>
      ) : (
        props.open && (
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
        )
      )}
    </dialog>
  );
}
