import { z } from "zod";
import { DocumentSlug } from "./documents.ts";
import { FloorPlan } from "./floor-plan.ts";
import { Project } from "./projects.ts";
import { ThingSlug } from "./things.ts";

// A planning workspace's Home (#208, #603): its main subject, then its projects, and nothing else:
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
 * or a room's floor plan, as last drawn in an answer (#257).
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
]);
export type HomeSubject = z.infer<typeof HomeSubject>;

/** A planning workspace's Home, as `GET /api/workspaces/:id/home` gives it. */
export const PlanningHome = z.object({
  /** Its main subject, or `null` while it has none. */
  subject: HomeSubject.nullable(),
  /**
   * Its projects (#603): those being carried on first, each by name, then those done; each with
   * its steps and decisions, which its page shows.
   */
  projects: z.array(Project),
});
export type PlanningHome = z.infer<typeof PlanningHome>;
