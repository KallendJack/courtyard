import { type ReactNode, type TouchEvent, useRef } from "react";
import { classes } from "@/lib/classes";
import { useLayout } from "./handheld.ts";
import { useDialog } from "./use-dialog.ts";

/** How far a swipe goes, in pixels, before it closes a sheet. */
const SWIPE = 64;

/**
 * A sheet in the Handheld frame (#194, Paper boards Handheld · 09, 28, 29), sized to the screen and never
 * partly off it: on a tablet or the unfolded Fold it comes in from the right edge, beside the right
 * rail, over the page, which dims; on a phone or the folded Fold it rises from the bottom, up to
 * most of the screen. What's in it scrolls inside it, and `foot` stays at its foot. Tapping outside
 * it, Escape, or swiping it back the way it came (sideways, or down) closes it. The browser's own
 * dialog, so focus and screen readers work as they should. Its look is in handheld-frame.css, which
 * the frame loads: only the frame and the message box docked in it open one.
 */
export function HandheldSheet(props: {
  title: string;
  /** A word or two beside the title: the workspace whose skills or message they are. */
  aside?: string;
  open: boolean;
  onClose: () => void;
  /**
   * Kept at the sheet's foot, below what scrolls, in the thumb's reach: the model a message goes
   * with, or its effort (#201).
   */
  foot?: ReactNode;
  /**
   * On a tablet, a sheet with only a little in it is only as tall as that, at the top of the
   * screen, by the button that opened it. Without, it runs from the top to the bottom bar.
   */
  fits?: "top";
  children?: ReactNode;
}) {
  const side = useLayout() === "tablet" ? "right" : "bottom";
  // Closed because another sheet opens in its place (Skills' Change, #201), it's already closing:
  // the browser saying so a moment later mustn't close the one that opened.
  const dialog = useDialog(props.open, () => {
    if (props.open) props.onClose();
  });
  const body = useRef<HTMLDivElement>(null);
  /** Where a touch on the sheet started, and whether what scrolls was at its top then. */
  const touch = useRef<{ x: number; y: number; atTop: boolean }>(undefined);

  const touchStart = (event: TouchEvent) => {
    const finger = event.touches[0];
    if (finger === undefined || event.touches.length > 1) {
      touch.current = undefined;
      return;
    }
    const scroller = body.current;
    const inBody =
      scroller !== null && event.target instanceof Node && scroller.contains(event.target);
    touch.current = {
      x: finger.clientX,
      y: finger.clientY,
      atTop: !inBody || scroller.scrollTop <= 0,
    };
  };
  const touchEnd = (event: TouchEvent) => {
    const start = touch.current;
    const finger = event.changedTouches[0];
    touch.current = undefined;
    if (start === undefined || finger === undefined) return;
    const across = finger.clientX - start.x;
    const down = finger.clientY - start.y;
    const swiped =
      side === "right"
        ? across > SWIPE && across > Math.abs(down)
        : start.atTop && down > SWIPE && down > Math.abs(across);
    if (swiped) props.onClose();
  };

  return (
    <dialog
      {...dialog}
      data-sheet={side}
      {...(props.fits === undefined ? {} : { "data-fits": props.fits })}
      aria-label={props.title}
      onTouchStart={touchStart}
      onTouchEnd={touchEnd}
      onTouchCancel={() => {
        touch.current = undefined;
      }}
    >
      {props.open && (
        <>
          <div data-handheld="" className="contents">
            <header
              className={classes(
                "flex shrink-0 flex-col px-5 pb-2",
                side === "right" ? "pt-4.5" : "pt-2.5",
              )}
            >
              {side === "bottom" && (
                <span aria-hidden className="mb-3 h-1 w-9 self-center rounded-full bg-input" />
              )}
              <span className="flex items-center justify-between gap-3">
                <h2 className="display-title text-[22px]/7">{props.title}</h2>
                {props.aside !== undefined && (
                  <span className="truncate text-[12px]/4 font-semibold text-placeholder">
                    {props.aside}
                  </span>
                )}
              </span>
            </header>
          </div>
          {props.children !== undefined && (
            <div ref={body} data-sheet-body="">
              {props.children}
            </div>
          )}
          {props.foot !== undefined && <div data-sheet-foot="">{props.foot}</div>}
        </>
      )}
    </dialog>
  );
}
