import {
  type FloorPlan,
  type PlanItem,
  type PlanOpening,
  type PlanWall,
  wallLength,
} from "@courtyard/contract";

// Where a floor plan's parts go on the screen (#257): the room's centimetres, measured from its
// left and back walls as seen from the front of the house, to pixels, front at the bottom unless
// the plan is turned. Text is placed, never turned with it, so it always reads upright.

export type Point = { readonly x: number; readonly y: number };
export type Box = Point & { readonly width: number; readonly height: number };
export type Edge = "top" | "right" | "bottom" | "left";

/** The room's walls clockwise from the back, and the screen's edges clockwise from the top. */
const WALLS: readonly PlanWall[] = ["back", "right", "front", "left"];
const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
const QUARTERS = { right: 1, around: 2, left: 3 } as const;

/** Room round the room for what's written outside its walls: what's beyond, and its sizes. */
export const PAD = 44;

/** A point `t` cm along a wall from its start: a side wall's back corner, else its left corner. */
const along = (plan: FloorPlan, wall: PlanWall, t: number): [number, number] =>
  wall === "back"
    ? [t, 0]
    : wall === "front"
      ? [t, plan.depth]
      : wall === "left"
        ? [0, t]
        : [plan.width, t];

/** The way into the room from a wall. */
const INWARD: Record<PlanWall, [number, number]> = {
  back: [0, 1],
  front: [0, -1],
  left: [1, 0],
  right: [-1, 0],
};

/** The plan laid out to fit `fit` pixels at most, to scale. */
export const layoutOf = (plan: FloorPlan, fit: { width: number; height: number }) => {
  const quarter = plan.turned === undefined ? 0 : QUARTERS[plan.turned.to];
  const sideways = quarter % 2 === 1;
  const across = sideways ? plan.depth : plan.width;
  const down = sideways ? plan.width : plan.depth;
  const scale = Math.min((fit.width - 2 * PAD) / across, (fit.height - 2 * PAD) / down);

  /** Where a point in the room, `x` cm from the left wall and `y` from the back, is drawn. */
  const point = (x: number, y: number): Point => {
    const [sx, sy] =
      quarter === 0
        ? [x, y]
        : quarter === 1
          ? [plan.depth - y, x]
          : quarter === 2
            ? [plan.width - x, plan.depth - y]
            : [y, plan.width - x];
    return { x: PAD + sx * scale, y: PAD + sy * scale };
  };
  /** Where a box in the room is drawn. */
  const box = (x: number, y: number, width: number, depth: number): Box => {
    const a = point(x, y);
    const b = point(x + width, y + depth);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  };
  const onWall = (wall: PlanWall, t: number) => point(...along(plan, wall, t));
  return {
    scale,
    width: across * scale + 2 * PAD,
    height: down * scale + 2 * PAD,
    room: box(0, 0, plan.width, plan.depth),
    point,
    box,
    onWall,
    /** The screen's edge a wall is drawn on. */
    edgeOf: (wall: PlanWall): Edge => EDGES[(WALLS.indexOf(wall) + quarter) % 4] ?? "top",
    /** A door's leaf and swing: from its hinge, open, round to the jamb it closes on. */
    doorPath: (door: PlanOpening) => {
      const hingeAt = door.hinge === "end" ? door.at + door.width : door.at;
      const jambAt = door.hinge === "end" ? door.at : door.at + door.width;
      const [inX, inY] = INWARD[door.wall];
      const way = door.swing === "out" ? -1 : 1;
      const [hx, hy] = along(plan, door.wall, hingeAt);
      const hinge = point(hx, hy);
      const open = point(hx + inX * way * door.width, hy + inY * way * door.width);
      const jamb = onWall(door.wall, jambAt);
      // Round from open to the jamb the short way: clockwise on the screen when it turns that way.
      const turn =
        (open.x - hinge.x) * (jamb.y - hinge.y) - (open.y - hinge.y) * (jamb.x - hinge.x);
      const radius = door.width * scale;
      return `M${hinge.x},${hinge.y} L${open.x},${open.y} A${radius},${radius} 0 0 ${turn > 0 ? 1 : 0} ${jamb.x},${jamb.y}`;
    },
    /** A thing on a wall, as a strip along its inside `thickness` pixels deep. */
    stripOn: (item: { wall: PlanWall; at: number; length: number }, thickness: number) => {
      const deep = thickness / scale;
      const { wall, at, length } = item;
      return wall === "back"
        ? box(at, 0, length, deep)
        : wall === "front"
          ? box(at, plan.depth - deep, length, deep)
          : wall === "left"
            ? box(0, at, deep, length)
            : box(plan.width - deep, at, deep, length);
    },
  };
};

export type Layout = ReturnType<typeof layoutOf>;

/** The stretches of a line `length` long left once its gaps are taken out, in order. */
export const runsAround = (
  from: number,
  to: number,
  gaps: readonly { at: number; width: number }[],
): [number, number][] => {
  const runs: [number, number][] = [];
  let start = from;
  for (const gap of [...gaps].sort((a, b) => a.at - b.at)) {
    if (gap.at > start) runs.push([start, Math.min(gap.at, to)]);
    start = Math.max(start, gap.at + gap.width);
  }
  if (start < to) runs.push([start, to]);
  return runs;
};

/** A wall's stretches between its doors and windows. */
export const wallRuns = (plan: FloorPlan, wall: PlanWall) =>
  runsAround(
    0,
    wallLength(plan, wall),
    (plan.openings ?? []).filter((opening) => opening.wall === wall),
  );

/** How near a wall something stands to be listed by it, in cm. */
const BY_A_WALL = 30;

/** The wall something is on or stands by, or the middle of the room. */
export const sideOf = (plan: FloorPlan, item: PlanItem): PlanWall | "middle" => {
  if ("wall" in item) return item.wall;
  const gaps: [PlanWall, number][] = [
    ["left", item.fromLeft],
    ["back", item.fromBack],
    ["right", plan.width - item.fromLeft - item.width],
    ["front", plan.depth - item.fromBack - item.depth],
  ];
  const [wall, gap] = gaps.reduce((nearest, one) => (one[1] < nearest[1] ? one : nearest));
  return gap <= BY_A_WALL ? wall : "middle";
};

/** What a side is called in the list: by what's beyond it when the plan says, else by where. */
export const sideName = (plan: FloorPlan, side: PlanWall | "middle") => {
  if (side === "middle") return "Middle";
  const beyond = plan.beyond?.[side];
  if (beyond !== undefined) return `${beyond} side`;
  return { back: "Back wall", front: "Front wall", left: "Left side", right: "Right side" }[side];
};

/** The order the list's sides go in: round the room from the left, then the middle. */
export const SIDES: readonly (PlanWall | "middle")[] = ["left", "back", "right", "front", "middle"];

/** Centimetres as metres to one place: `3.0 m`. */
export const metres = (cm: number) => `${(cm / 100).toFixed(1)} m`;

/** A thing's size in words: its longer side first, `120 × 60 cm`; a wall's thing, its length. */
export const sizeOf = (item: PlanItem) => {
  if ("wall" in item) return `${round(item.length)} cm`;
  if (item.round && item.width === item.depth) return `${round(item.width)} cm round`;
  const [long, short] = [item.width, item.depth].sort((a, b) => b - a);
  return `${round(long ?? 0)} × ${round(short ?? 0)} cm`;
};

const round = (cm: number) => Math.round(cm);
