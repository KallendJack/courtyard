import { type RefObject, useLayoutEffect, useState } from "react";

// A drawing's labels kept apart (#657). Each label sits at its own spot on the drawing, as a share
// of the drawing's box, but keeps its own size, so on a small drawing the labels on one row (the
// bike's tyres, drivetrain and pedals) can run into each other. Measured before the page is
// painted, and again whenever the room or a label changes size, any that would overlap are pushed
// apart along their row, out past the drawing into the room round it if need be, and every label
// is kept inside that room. Each one's shift is given in the drawing's own units, so its line can
// move with it and still reach it.

/** A point on a drawing, in its own units. */
export type Point = readonly [x: number, y: number];

/** The room left between two labels side by side, in CSS px. */
const GAP = 8;

/** A label's box, in CSS px from the drawing's top left. */
type Box = { left: number; top: number; width: number; height: number };

type Room = { left: number; top: number; right: number; bottom: number };

const beside = (a: Box, b: Box) => a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Where the boxes go so no two overlap and each stays in `room` (as far as the room allows): each
 * moved into the room, then, left to right, pushed right of any it overlaps, then, right to left,
 * pulled back inside the room's right edge, pulling those it would run into with it.
 */
const apart = (boxes: readonly Box[], room: Room) => {
  const placed = boxes.map((box) => ({
    ...box,
    top: Math.max(room.top, Math.min(box.top, room.bottom - box.height)),
  }));
  const order = [...placed].sort((a, b) => a.left - b.left || a.top - b.top);
  for (const [i, box] of order.entries()) {
    box.left = Math.max(box.left, room.left);
    for (const before of order.slice(0, i)) {
      if (beside(before, box)) box.left = Math.max(box.left, before.left + before.width + GAP);
    }
  }
  for (const [i, box] of [...order.entries()].reverse()) {
    box.left = Math.min(box.left, room.right - box.width);
    for (const after of order.slice(i + 1)) {
      if (beside(box, after)) box.left = Math.min(box.left, after.left - GAP - box.width);
    }
    box.left = Math.max(box.left, room.left);
  }
  return placed;
};

/**
 * How far each of a drawing's labels is moved so none overlaps another and each stays inside
 * `room`, in the drawing's units, by its key. `drawing` is the drawing's box, `width` units wide,
 * positioned inside `room`; each label in it is an element with `data-label` set to its key, its
 * top left at `spots[key].label` and as wide as its words. Off, nothing moves.
 */
export const useLabelsApart = <Key extends string>(options: {
  room: RefObject<HTMLElement | null>;
  drawing: RefObject<HTMLElement | null>;
  width: number;
  spots: Readonly<Record<Key, { readonly label: Point }>>;
  /** The labels drawn, so a new one is measured too. */
  keys: readonly Key[];
  on: boolean;
}) => {
  const { room, drawing, width, spots, on } = options;
  const [shifts, setShifts] = useState<Partial<Record<Key, Point>>>({});
  const keys = options.keys.join(" ");

  useLayoutEffect(() => {
    const around = room.current;
    const box = drawing.current;
    if (!on || around === null || box === null || keys === "") return;
    const isKey = (key: string | undefined): key is Key =>
      key !== undefined && Object.hasOwn(spots, key);
    const labels = [...box.querySelectorAll<HTMLElement>("[data-label]")];
    const measure = () => {
      const drawn = box.getBoundingClientRect();
      const roomy = around.getBoundingClientRect();
      const scale = drawn.width / width;
      if (scale === 0) return;
      const at = labels.flatMap((label) => {
        const key = label.dataset.label;
        if (!isKey(key)) return [];
        const [x, y] = spots[key].label;
        const size = label.getBoundingClientRect();
        return [{ key, left: x * scale, top: y * scale, width: size.width, height: size.height }];
      });
      const placed = apart(at, {
        left: roomy.left - drawn.left,
        top: roomy.top - drawn.top,
        right: roomy.right - drawn.left,
        bottom: roomy.bottom - drawn.top,
      });
      const next: Partial<Record<Key, Point>> = {};
      for (const [i, label] of at.entries()) {
        const to = placed[i];
        if (to === undefined) continue;
        const shift: Point = [(to.left - label.left) / scale, (to.top - label.top) / scale];
        if (Math.abs(shift[0]) > 0.01 || Math.abs(shift[1]) > 0.01) next[label.key] = shift;
      }
      setShifts((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    // Measured before the first paint, so nothing moves once drawn.
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(around);
    for (const label of labels) resized.observe(label);
    return () => resized.disconnect();
  }, [room, drawing, width, spots, on, keys]);

  const none: Partial<Record<Key, Point>> = {};
  return on ? shifts : none;
};
