import type { Box } from "../build.ts";

// Where a recipe's pieces are (#770): each a box in the build, in mm, as the 3D view draws it, and
// where two of them meet, so a joint's fixings are counted where its pieces really touch.

/** Cut to the whole mm below: a part a touch short fits, one a touch long doesn't. */
export const cutSize = (mm: number) => Math.floor(mm + 1e-9);
/** A worked-out size, to a tenth of a mm. */
export const tenth = (mm: number) => Math.round(mm * 10) / 10;

export const box = (x: number, y: number, z: number, w: number, d: number, h: number): Box => ({
  x: tenth(x),
  y: tenth(y),
  z: tenth(z),
  w: tenth(w),
  d: tenth(d),
  h: tenth(h),
});

/** The three ways a box runs: along the length (x), the depth (y) and the height (z). */
export const AXES = ["x", "y", "z"] as const;
export type Axis = (typeof AXES)[number];

const SIZE = { x: "w", y: "d", z: "h" } as const;

/** Where a box starts and how far it runs one way. */
export const span = (of: Box, axis: Axis) => ({ from: of[axis], to: of[axis] + of[SIZE[axis]] });

/** How far a box runs one way. */
export const extent = (of: Box, axis: Axis) => of[SIZE[axis]];

/** The way a box is thinnest: a sheet's face is across it. */
export const thinnest = (of: Box): Axis =>
  AXES.reduce((thin, axis) => (extent(of, axis) < extent(of, thin) ? axis : thin));

/** Two boxes meeting face to face: the way they meet across, and how far the face runs each way. */
export type Contact = { readonly across: Axis; readonly face: Readonly<Record<Axis, number>> };

const NEAR = 0.05;

/** Where two boxes meet face to face, or nothing when they don't touch. */
export const contactOf = (a: Box, b: Box): Contact | null => {
  for (const across of AXES) {
    const one = span(a, across);
    const other = span(b, across);
    const touching = Math.abs(one.to - other.from) < NEAR || Math.abs(other.to - one.from) < NEAR;
    if (!touching) continue;
    const face = { x: 0, y: 0, z: 0 };
    let overlaps = true;
    for (const axis of AXES) {
      if (axis === across) continue;
      const p = span(a, axis);
      const q = span(b, axis);
      face[axis] = Math.min(p.to, q.to) - Math.max(p.from, q.from);
      if (face[axis] <= NEAR) overlaps = false;
    }
    if (overlaps) return { across, face };
  }
  return null;
};

/** The way a contact's face runs furthest: the line its screws go along. */
export const alongOf = (contact: Contact): Axis =>
  AXES.filter((axis) => axis !== contact.across).reduce((long, axis) =>
    contact.face[axis] > contact.face[long] ? axis : long,
  );

/** The way across a contact's face it runs least: how much there is to screw into. */
export const narrowOf = (contact: Contact) =>
  Math.min(...AXES.filter((axis) => axis !== contact.across).map((axis) => contact.face[axis]));
