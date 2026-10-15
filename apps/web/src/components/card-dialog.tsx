import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { classes } from "@/lib/classes";
import { IconButton } from "./button.tsx";
import { useDialog } from "./use-dialog.ts";

/**
 * A card over the page for one task with a few lines to it (Connections, #308; the setup card,
 * #323): its title, a line under it saying what it's for, and Close, then what's in it. Under what
 * opened it (`style`, from place-under.ts), else in the middle of the screen. The browser's own
 * dialog, so Escape, focus and screen readers work as they should, and a tap on the page around it
 * closes it. What's in it is only there while it's open; it keeps its own title and main action in
 * view, scrolling only what's between them (#339). Safe on the first load (ADR 0012).
 */
export function CardDialog(props: {
  title: string;
  note: string;
  open: boolean;
  onClose: () => void;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const dialog = useDialog(props.open, props.onClose);
  return (
    <dialog
      {...dialog}
      aria-label={props.title}
      style={props.style}
      className={classes(
        "fixed overflow-hidden rounded-box border border-input bg-popover p-0 text-popover-foreground shadow-raised backdrop:bg-card/60 open:flex open:flex-col",
        props.style === undefined
          ? "inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100%-2rem),27.5rem)]"
          : "m-0",
      )}
    >
      {props.open && (
        <div className="flex min-h-0 flex-col gap-3 p-5">
          <div className="flex shrink-0 items-start justify-between gap-3 pb-1">
            <div className="flex flex-col gap-1">
              <h2 className="display-section text-sheet-title">{props.title}</h2>
              <p className="text-meta font-medium text-muted-foreground">{props.note}</p>
            </div>
            <IconButton label="Close" icon={<X />} onClick={props.onClose} />
          </div>
          {props.children}
        </div>
      )}
    </dialog>
  );
}
