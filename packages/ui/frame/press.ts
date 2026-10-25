import { type PointerEvent, useEffect, useRef } from "react";

/** How long a finger stays on a button that talks before it's a hold (push to talk) rather than a tap. */
export const HOLD_MS = 300;

/** The finger on the button, until it lifts, and whether it has become a hold. */
type Pressed = { readonly pointer: number; readonly timer: number; held: boolean };

/**
 * A press on a button that talks, told apart as a tap or a hold, the one way for every such button:
 * Courtyard's talk strip and Talk key, and Fabrication's Hold to ask (#753). `begin` as the
 * finger goes down (listening starts at once, so no word is lost); `held` is told once it has
 * stayed `HOLD_MS`; `end` as it lifts says which it was, or nothing for another finger.
 */
export const usePress = (on: { held: () => void }) => {
  const pressed = useRef<Pressed>(undefined);
  const latest = useRef(on);
  latest.current = on;

  /** Forgets the press, however it ended, returning it. */
  const clear = () => {
    const was = pressed.current;
    if (was !== undefined) window.clearTimeout(was.timer);
    pressed.current = undefined;
    return was;
  };
  // Gone mid-press, its hold never comes.
  useEffect(
    () => () => {
      if (pressed.current !== undefined) window.clearTimeout(pressed.current.timer);
    },
    [],
  );

  return {
    /** The finger goes down on the button, which keeps it until it lifts. */
    begin: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const pointer = event.pointerId;
      const timer = window.setTimeout(() => {
        if (pressed.current?.pointer !== pointer) return;
        pressed.current.held = true;
        latest.current.held();
      }, HOLD_MS);
      clear();
      pressed.current = { pointer, timer, held: false };
    },
    /** The finger lifts: a tap or a hold, or undefined when it isn't the one pressing. */
    end: (event: PointerEvent<HTMLElement>): "tap" | "hold" | undefined => {
      if (pressed.current?.pointer !== event.pointerId) return undefined;
      return clear()?.held === true ? "hold" : "tap";
    },
    /** Whether a finger is pressing now (`pointer`, if given, being it), and whether it's held. */
    now: (pointer?: number) => {
      const was = pressed.current;
      if (was === undefined || (pointer !== undefined && was.pointer !== pointer)) return undefined;
      return { held: was.held };
    },
    /** Forgets the press without a let-go: listening stopped some other way. */
    cancel: () => void clear(),
  };
};
