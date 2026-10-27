import { type PointerEvent, useRef, useState } from "react";

/** How far a board can be zoomed in, and how far a double tap goes. */
const MOST = 4;
const DOUBLE_TAP = 2;

type View = { readonly scale: number; readonly x: number; readonly y: number };
const WHOLE: View = { scale: 1, x: 0, y: 0 };

const distance = (points: readonly { x: number; y: number }[]) => {
  const [a, b] = points;
  return a === undefined || b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
};

/**
 * Pinch to zoom on a board's full-size picture (#522), by its own pointers, since the app's page
 * doesn't zoom: two fingers zoom it (up to 4×), one drags it while it's zoomed, and a double tap
 * (or double click) goes to 2× and back.
 */
export const useZoom = () => {
  const [view, setView] = useState<View>(WHOLE);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number }>(undefined);

  const down = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      pinch.current = { distance: distance([...pointers.current.values()]), scale: view.scale };
    }
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const was = pointers.current.get(event.pointerId);
    if (was === undefined) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, now);
    const start = pinch.current;
    if (pointers.current.size === 2 && start !== undefined && start.distance > 0) {
      const scale = Math.min(
        MOST,
        Math.max(1, (start.scale * distance([...pointers.current.values()])) / start.distance),
      );
      setView((at) => (scale === 1 ? WHOLE : { ...at, scale }));
    } else if (pointers.current.size === 1) {
      setView((at) =>
        at.scale === 1 ? at : { ...at, x: at.x + now.x - was.x, y: at.y + now.y - was.y },
      );
    }
  };

  const up = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
  };

  return {
    zoomed: view.scale > 1,
    style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` },
    handlers: {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: up,
      onDoubleClick: () =>
        setView((at) => (at.scale > 1 ? WHOLE : { ...WHOLE, scale: DOUBLE_TAP })),
    },
  };
};
