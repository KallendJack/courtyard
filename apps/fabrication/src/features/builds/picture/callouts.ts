import * as THREE from "three";
import { GAP, type Placing, spread } from "../scene.ts";

// Callouts over a step's picture (#783; Paper, 2 · Agreed, "Fabrication · Castors in 3D, your kit
// · Fold (#783)"): words off the model, never over a box of it, each with a short leader to what
// it's about. Here rather than in `scene.ts`, which would be over 400 lines.

type Point = { x: number; y: number };

/** A box's outline on screen: the hull of its eight corners as `onScreen` puts them. */
export const outlineOf = (
  mesh: THREE.Mesh<THREE.BoxGeometry>,
  onScreen: (at: THREE.Vector3) => Point,
): Point[] => {
  const { width, height, depth } = mesh.geometry.parameters;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((corner) =>
    onScreen(
      new THREE.Vector3(
        corner & 1 ? width / 2 : -width / 2,
        corner & 2 ? height / 2 : -height / 2,
        corner & 4 ? depth / 2 : -depth / 2,
      ).add(mesh.position),
    ),
  );
  // The convex hull, by the monotone chain: lower then upper, each turning one way.
  const sorted = [...corners].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (points: Point[]) => {
    const kept: Point[] = [];
    for (const point of points) {
      while (kept.length >= 2 && turn(kept.at(-2) as Point, kept.at(-1) as Point, point) <= 0) {
        kept.pop();
      }
      kept.push(point);
    }
    return kept.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
};

/** Whether a word's box (its middle and size, in px) overlaps an outline: no axis between them. */
const overlaps = (at: Placing, outline: readonly Point[]) => {
  const corners = [
    { x: at.x - at.w / 2, y: at.y - at.h / 2 },
    { x: at.x + at.w / 2, y: at.y - at.h / 2 },
    { x: at.x + at.w / 2, y: at.y + at.h / 2 },
    { x: at.x - at.w / 2, y: at.y + at.h / 2 },
  ];
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    ...outline.map((point, at) => {
      const next = outline[(at + 1) % outline.length] ?? point;
      return { x: next.y - point.y, y: point.x - next.x };
    }),
  ];
  return axes.every((axis) => {
    const along = (points: readonly Point[]) => points.map((p) => p.x * axis.x + p.y * axis.y);
    const word = along(corners);
    const shape = along(outline);
    return Math.max(...word) > Math.min(...shape) && Math.max(...shape) > Math.min(...word);
  });
};

/** How much of the view a scene with callouts fills, less than one without, to leave them room. */
export const CALLOUT_FILL = 0.7;

/** Under this size, in px, a picture (folded) shows each callout's first line only. */
const SMALL = { width: 360, height: 330 } as const;

export const isSmall = (view: { width: number; height: number }) =>
  view.width < SMALL.width || view.height < SMALL.height;

/** How far a callout's words may slide along their line, as parts of their width. */
const SLIDES = [0, -0.35, 0.35] as const;

/** How far from what it's about a callout may go, in px, and the steps out it tries. */
const CALLOUT_REACH = { first: 14, step: 10, most: 360 } as const;

/**
 * Where each callout's words go (#783): off the model, never over a box of it, clear of the words
 * already placed and inside the picture, as near what it's about as that allows, so its leader is
 * short. It tries the side away from the model's middle first, and over the model only when
 * there's no room off it.
 */
export const offModel = (
  wanted: readonly (Placing & { optional?: boolean })[],
  options: {
    outlines: readonly (readonly Point[])[];
    placed: readonly Placing[];
    /** The room it may use, in px: from `top` down to `height`, and across to `width`. */
    bounds: { width: number; height: number; top: number };
  },
): (Point | undefined)[] => {
  const placed = [...options.placed];
  const all = options.outlines.flat();
  const middle = {
    x: all.reduce((sum, p) => sum + p.x, 0) / Math.max(all.length, 1),
    y: all.reduce((sum, p) => sum + p.y, 0) / Math.max(all.length, 1),
  };
  const clear = (at: Placing, offIt: boolean) =>
    at.x - at.w / 2 >= GAP &&
    at.y - at.h / 2 >= options.bounds.top + GAP &&
    at.x + at.w / 2 <= options.bounds.width - GAP &&
    at.y + at.h / 2 <= options.bounds.height - GAP &&
    (!offIt || options.outlines.every((outline) => !overlaps(at, outline))) &&
    placed.every(
      (other) =>
        Math.abs(other.x - at.x) >= (other.w + at.w) / 2 + GAP ||
        Math.abs(other.y - at.y) >= (other.h + at.h) / 2 + GAP,
    );
  return wanted.map((want) => {
    const away = Math.atan2(want.y - middle.y, want.x - middle.x);
    const angles = Array.from({ length: 16 }, (_, at) => (at * Math.PI) / 8).sort(
      (a, b) =>
        Math.abs(Math.atan2(Math.sin(a - away), Math.cos(a - away))) -
        Math.abs(Math.atan2(Math.sin(b - away), Math.cos(b - away))),
    );
    const nearest = (offIt: boolean) => {
      for (let far = CALLOUT_REACH.first; far <= CALLOUT_REACH.most; far += CALLOUT_REACH.step) {
        for (const angle of angles) {
          const x = Math.cos(angle);
          const y = Math.sin(angle);
          // Its near edge `far` from the point, along the way it goes; then slid along its
          // line, so a long one fits beside the picture's edge or another's words.
          const edge = (Math.abs(x) * want.w) / 2 + (Math.abs(y) * want.h) / 2;
          for (const slide of SLIDES) {
            const at = {
              ...want,
              x: want.x + x * (far + edge) + slide * want.w,
              y: want.y + y * (far + edge),
            };
            if (clear(at, offIt)) return at;
          }
        }
      }
      return undefined;
    };
    // With no room off the model (a small picture), over it beats over other words. With no room
    // at all, one that may step aside (a part's pill) does; the rest go where they point.
    const chosen = nearest(true) ?? nearest(false) ?? (want.optional ? undefined : want);
    if (chosen === undefined) return undefined;
    placed.push(chosen);
    return { x: chosen.x, y: chosen.y };
  });
};

/** A leader's end at a word's box: the nearest point of it to what it's about. */
const leaderEnd = (to: Point, word: Placing): Point => ({
  x: Math.min(Math.max(to.x, word.x - word.w / 2), word.x + word.w / 2),
  y: Math.min(Math.max(to.y, word.y - word.h / 2), word.y + word.h / 2),
});

/** How far a dimension line's ends are carried towards what it measures, in px. */
const CARRIED = 8;

/**
 * A size's dimension line over the picture (#826, its boards): drawn end to end in `lines`, each
 * end carried towards what it measures by a short dashed line; and where its gold tag goes,
 * beside its middle on the side away from the model.
 */
export const dimensionLine = (
  size: { key: string; from: THREE.Vector3; to: THREE.Vector3 },
  onScreen: (at: THREE.Vector3) => Point,
  outlines: readonly (readonly Point[])[],
  tag: { w: number; h: number },
  lines: ReadonlyMap<string, SVGLineElement>,
): Point => {
  const from = onScreen(size.from);
  const to = onScreen(size.to);
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const all = outlines.flat();
  const middle = {
    x: all.reduce((sum, p) => sum + p.x, 0) / Math.max(all.length, 1),
    y: all.reduce((sum, p) => sum + p.y, 0) / Math.max(all.length, 1),
  };
  // Square to the line, pointing away from the model.
  const square = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  const side = (mid.x - middle.x) * square.x + (mid.y - middle.y) * square.y < 0 ? -1 : 1;
  const away = { x: square.x * side, y: square.y * side };
  const draw = (key: string, a: Point, b: Point) => {
    const line = lines.get(key);
    line?.setAttribute("x1", String(a.x));
    line?.setAttribute("y1", String(a.y));
    line?.setAttribute("x2", String(b.x));
    line?.setAttribute("y2", String(b.y));
  };
  const carried = (end: Point) => ({ x: end.x - away.x * CARRIED, y: end.y - away.y * CARRIED });
  draw(size.key, from, to);
  draw(`${size.key} from`, from, carried(from));
  draw(`${size.key} to`, to, carried(to));
  const out = (Math.abs(away.x) * tag.w + Math.abs(away.y) * tag.h) / 2 + GAP;
  return { x: mid.x + away.x * out, y: mid.y + away.y * out };
};

/** How much of the view's foot its buttons take, in px: Hold to ask and Reset view. */
const FOOT = 72;
/** How much of its top its title takes, in px: "In your Workmate". */
const HEAD = 40;

/** A word over the picture, as the view measures it: its element, and its place and size in px. */
type Shown = Placing & { label: HTMLElement };

/**
 * Where every word over the picture goes, each moved there: what's pinned (a screw spot, #826)
 * exactly on its place, the marks' words and the parts' letters clear of each other and inside
 * the picture (#777), then the callouts off the model, each leader drawn from its place to the
 * nearest edge of its words (#783).
 */
export const placeWords = (options: {
  pinned: readonly Shown[];
  shown: readonly Shown[];
  /** Each callout's words and leader; an `optional` one steps aside when nothing fits. */
  callouts: readonly (Shown & { leader: SVGLineElement | undefined; optional?: boolean })[];
  outlines: readonly (readonly Point[])[];
  bounds: { width: number; height: number };
  /** Room over the picture the callouts keep clear of: Where this goes, at the bench (#826). */
  keepClear?: readonly Placing[];
}) => {
  const spots = spread(options.shown, options.bounds);
  const placed: Shown[] = [
    ...options.pinned,
    ...options.shown.map((each, at) => ({ ...each, ...spots[at] })),
  ];
  // Never under the view's foot, where Hold to ask and Reset view sit, nor over its title.
  const bounds = { ...options.bounds, height: options.bounds.height - FOOT, top: HEAD };
  const off = offModel(options.callouts, {
    ...options,
    bounds,
    placed: [...placed, ...(options.keepClear ?? [])],
  });
  options.callouts.forEach((each, at) => {
    const room = off[at];
    // Hidden by visibility, so it keeps its size for the next frame's placing.
    each.label.style.visibility = room === undefined ? "hidden" : "";
    each.leader?.setAttribute("visibility", room === undefined ? "hidden" : "visible");
    if (room === undefined) return;
    const spot = { ...each, ...room };
    const end = leaderEnd(each, spot);
    each.leader?.setAttribute("x1", String(each.x));
    each.leader?.setAttribute("y1", String(each.y));
    each.leader?.setAttribute("x2", String(end.x));
    each.leader?.setAttribute("y2", String(end.y));
    placed.push(spot);
  });
  for (const { label, x, y } of placed) {
    label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }
};
