import { z } from "zod";
import { DocumentSlug } from "./documents.ts";
import { FloorPlan } from "./floor-plan.ts";
import { MoveReview } from "./move-review.ts";
import { Project } from "./projects.ts";
import { ThingSlug } from "./things.ts";

// A planning workspace's Home (#208, #603): its main subject, then its projects (or, once, its move
// review), and nothing else:
// no chat. The subject is general, filled from any workspace's data, never made for one workspace:
// a Thing drawn as its kind of thing, or a room's floor plan.

/**
 * The places on Courtyard's drawing of a mountain bike (#603), the first kind of thing it draws, in
 * the order the drawing lists them. A part goes on the place its name says.
 */
export const BIKE_PLACES = [
  "saddle",
  "seatpost",
  "grips",
  "fork",
  "brakes",
  "drivetrain",
  "pedals",
  "front-tyre",
  "rear-tyre",
] as const;
export const BikePlace = z.enum(BIKE_PLACES);
export type BikePlace = z.infer<typeof BikePlace>;

/** A part on a drawn Thing: its name, and its upcoming replacement's, which its label says. */
export const DrawnPart = z.object({
  thing: ThingSlug,
  name: z.string(),
  /** Its upcoming replacement's name (#602): "Pedals · DMR V8 next". */
  upcoming: z.string().optional(),
});
export type DrawnPart = z.infer<typeof DrawnPart>;

/**
 * A planning workspace's main subject, which leads its Home (#603): a Thing drawn as its kind of
 * thing, its parts placed on the drawing by name and those it has no place for listed under it;
 * or a room's floor plan, as last drawn in an answer (#257), or a house's floors (#670); or, until a space has one, the space
 * to draw (#604): a workspace whose facts give a floor's two sides.
 */
export const HomeSubject = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("drawing"),
    /** The kind of thing it's drawn as. */
    drawing: z.literal("mountain-bike"),
    thing: ThingSlug,
    name: z.string(),
    placed: z.array(DrawnPart.extend({ place: BikePlace })),
    unplaced: z.array(DrawnPart),
  }),
  z.object({
    kind: z.literal("plan"),
    name: z.string(),
    /** The document it's saved as. */
    document: DocumentSlug,
    plan: FloorPlan,
  }),
  /**
   * A house's floors (#670): two or more plans each of a floor ("Ground floor", "First floor"),
   * drawn side by side to one scale, from the lowest up.
   */
  z.object({
    kind: z.literal("floors"),
    /** The workspace's name: "House". */
    name: z.string(),
    floors: z
      .array(
        z.object({
          /** The floor, as named above its plan: "Ground". */
          name: z.string(),
          /** The document it's saved as. */
          document: DocumentSlug,
          plan: FloorPlan,
        }),
      )
      .min(2),
  }),
  z.object({
    kind: z.literal("space"),
    /** What it's called, from the workspace's name: "garage", as in "Draw the garage". */
    name: z.string(),
    /** Its floor's two sides, as first saved: "5.14 m × 2.74 m". */
    size: z.string(),
    /** The facts saved about it that hold a measurement, which a plan is drawn from. */
    measurements: z.array(z.string()),
  }),
]);
export type HomeSubject = z.infer<typeof HomeSubject>;

/**
 * Draw the garage's first message (#604): the space and its saved measurements, as its Home
 * shows them, for a floor plan.
 */
export const drawSpaceMessage = (space: Extract<HomeSubject, { kind: "space" }>) =>
  [
    `Draw the ${space.name} as a floor plan, to scale, from what's saved:`,
    ...space.measurements.map((fact) => `- ${fact}`),
  ].join("\n");

/** A planning workspace's Home, as `GET /api/workspaces/:id/home` gives it. */
export const PlanningHome = z.object({
  /** Its main subject, or `null` while it has none. */
  subject: HomeSubject.nullable(),
  /**
   * Its projects (#603): those being carried on first, each by name, then those done; each with
   * its steps and decisions, which its page shows.
   */
  projects: z.array(Project),
  /**
   * Its move review (#603), while it waits on the owner: shown in place of the subject and the
   * projects until it's done.
   */
  review: MoveReview.nullable(),
});
export type PlanningHome = z.infer<typeof PlanningHome>;
