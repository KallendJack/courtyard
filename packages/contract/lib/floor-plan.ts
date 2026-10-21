import { z } from "zod";

// A floor plan a model writes in an answer or a document (#257, ADR 0021): the JSON in a `plan`
// fenced block, a room described as data in centimetres, which the web app draws to scale itself.
// The room is seen from the front of the house: its front wall at the bottom of the plan, its back
// wall at the top, and its left and right walls as someone standing at the front sees them.

/** The most of each part a plan has, so it stays readable. */
export const FLOOR_PLAN_MAX_ITEMS = 60;
const MAX_PARTS = 20;

/** The biggest room a plan draws, in centimetres a side: 50 m. */
const MAX_SIDE = 5000;

const Centimetres = z.number().min(0).max(MAX_SIDE);
const Length = z.number().positive().max(MAX_SIDE);
const Words = z.string().trim().min(1).max(60);

/** A wall of the room, as seen from the front. */
export const PlanWall = z.enum(["back", "right", "front", "left"]);
export type PlanWall = z.infer<typeof PlanWall>;

/**
 * A gap in a wall: a door (drawn with its swing), a window, a garage door or an open doorway.
 * `at` is where it starts along its wall, in cm from the wall's start: the back corner for the
 * left and right walls, the left corner for the back and front walls.
 */
export const PlanOpening = z.object({
  kind: z.enum(["door", "window", "garage-door", "doorway"]),
  wall: PlanWall,
  at: Centimetres,
  width: Length,
  name: Words.optional(),
  /** Which way a door opens: into the room (the default) or out of it. */
  swing: z.enum(["in", "out"]).optional(),
  /** Which end of it a door hangs from, along its wall: its start (the default) or its end. */
  hinge: z.enum(["start", "end"]).optional(),
});
export type PlanOpening = z.infer<typeof PlanOpening>;

/**
 * A wall inside the room, straight across it at `fromBack` cm from the back wall, or straight
 * down it at `fromLeft` cm from the left wall; from `start` to `end` along it (the whole way
 * across by default), with a doorway `at` cm along it. Along it is measured as the room is: from
 * the left wall for one across it, from the back wall for one down it.
 */
export const PlanPartition = z
  .object({
    fromBack: Centimetres.optional(),
    fromLeft: Centimetres.optional(),
    start: Centimetres.optional(),
    end: Centimetres.optional(),
    doorway: z.object({ at: Centimetres, width: Length }).optional(),
  })
  .refine(
    (wall) => (wall.fromBack === undefined) !== (wall.fromLeft === undefined),
    "A partition is either across the room (fromBack) or down it (fromLeft).",
  );
export type PlanPartition = z.infer<typeof PlanPartition>;

/** A part of the room with a use of its own (a workshop, an office), drawn as a dashed outline. */
export const PlanZone = z.object({
  name: Words,
  fromLeft: Centimetres,
  fromBack: Centimetres,
  width: Length,
  depth: Length,
});
export type PlanZone = z.infer<typeof PlanZone>;

const itemBase = {
  name: Words,
  /** Whether the owner has it (drawn solid, the default) or wants it (drawn dashed). */
  status: z.enum(["have", "want"]).optional(),
  /** Why it's there, shown when it's tapped. */
  why: z.string().trim().max(200).optional(),
};

/**
 * Something standing on the floor: `fromLeft` and `fromBack` are its corner nearest the back left,
 * `width` its size left to right and `depth` back to front, all in cm. A round one (a chair, a
 * workstand's room to walk round) is drawn as a circle or an oval in that box. A size nobody gave
 * is left out, never made up (#661): without both, it's drawn as a dot where it is.
 */
export const PlanFloorItem = z.object({
  ...itemBase,
  fromLeft: Centimetres,
  fromBack: Centimetres,
  width: Length.optional(),
  depth: Length.optional(),
  round: z.boolean().optional(),
});
export type PlanFloorItem = z.infer<typeof PlanFloorItem>;

/**
 * Something on a wall (a tool wall, a charging point): drawn as a thin strip along it, so the plan
 * shows which walls are used without taking floor. `at` is measured as an opening's is. With no
 * length known (#661), it's drawn as a dot at `at`.
 */
export const PlanWallItem = z.object({
  ...itemBase,
  wall: PlanWall,
  at: Centimetres,
  length: Length.optional(),
});
export type PlanWallItem = z.infer<typeof PlanWallItem>;

export const PlanItem = z.union([PlanWallItem, PlanFloorItem]);
export type PlanItem = z.infer<typeof PlanItem>;

/** How long a wall is: the back and front walls are the room's width, the sides its depth. */
export const wallLength = (plan: { width: number; depth: number }, wall: PlanWall) =>
  wall === "back" || wall === "front" ? plan.width : plan.depth;

/** A little over, for a model's rounding. */
const SLACK = 1;

/** A `plan` block's JSON: a room to scale, its doors and windows, zones, inner walls and things. */
export const FloorPlan = z
  .object({
    /** The room's name: one saved plan per room, so a redraw replaces the last. */
    room: Words,
    /** Left wall to right wall, in cm. */
    width: Length,
    /** Back wall to front wall, in cm. */
    depth: Length,
    /**
     * Whether the width and depth were measured (#661): the owner's own measurement of the room, or
     * one saved as its size. Only then are they shown as sizes; an outline drawn from its rooms'
     * sizes is drawn to scale without them.
     */
    measured: z.boolean().optional(),
    /** What's at the front, such as the garage door, under the plan's Front marker. */
    front: Words.optional(),
    /** What's beyond each wall (the house, the garden), written along it. */
    beyond: z.partialRecord(PlanWall, Words).optional(),
    /**
     * A plan is drawn with its front at the bottom; turned only for a reason, which is written in
     * one quiet line above it. `right` turns it a quarter clockwise, `left` anticlockwise.
     */
    turned: z.object({ to: z.enum(["right", "left", "around"]), why: Words }).optional(),
    openings: z.array(PlanOpening).max(MAX_PARTS).optional(),
    partitions: z.array(PlanPartition).max(MAX_PARTS).optional(),
    zones: z.array(PlanZone).max(MAX_PARTS).optional(),
    items: z.array(PlanItem).max(FLOOR_PLAN_MAX_ITEMS).optional(),
  })
  .refine(
    (plan) =>
      (plan.openings ?? []).every(
        (opening) => opening.at + opening.width <= wallLength(plan, opening.wall) + SLACK,
      ),
    "Every door and window fits along its wall.",
  )
  .refine(
    (plan) =>
      [...(plan.zones ?? []), ...(plan.items ?? [])].every((part) =>
        "wall" in part
          ? part.at + (part.length ?? 0) <= wallLength(plan, part.wall) + SLACK
          : part.fromLeft + (part.width ?? 0) <= plan.width + SLACK &&
            part.fromBack + (part.depth ?? 0) <= plan.depth + SLACK,
      ),
    "Everything on the plan is inside the room.",
  );
export type FloorPlan = z.infer<typeof FloorPlan>;
