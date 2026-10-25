import { IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

/**
 * The chat, one tap away on the Fold (#753): a sheet over the page from the right, or the whole
 * screen folded, opened from Chat or a tap on Hold to ask. It stays on the page while closed, so
 * a half-written message is still there when it opens again.
 */
export function ChatSheet(props: {
  open: boolean;
  close: () => void;
  cover: boolean;
  children: ReactNode;
}) {
  const { open, close } = props;
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    addEventListener("keydown", closeOnEscape);
    return () => removeEventListener("keydown", closeOnEscape);
  }, [open, close]);
  return (
    <div className={classes("fixed inset-0 z-40", !open && "hidden")}>
      {!props.cover && (
        <button
          type="button"
          aria-label="Close the chat"
          tabIndex={-1}
          onClick={close}
          className="absolute inset-0 bg-card/60"
        />
      )}
      <div
        role="dialog"
        aria-label="Chat"
        className={classes(
          "absolute flex flex-col gap-3 bg-popover p-4",
          props.cover
            ? "inset-0"
            : "inset-y-0 right-0 w-full max-w-xl rounded-l-sheet border-l shadow-sheet",
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3">
          <CapsLabel tone="muted" heading={{ level: 2 }}>
            Chat
          </CapsLabel>
          <IconButton label="Close" look="quiet" icon={<X aria-hidden />} onClick={close} />
        </div>
        {props.children}
      </div>
    </div>
  );
}
