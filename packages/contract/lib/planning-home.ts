import { z } from "zod";
import { DocumentSlug } from "./documents.ts";
import { FloorPlan } from "./floor-plan.ts";
import { Project } from "./projects.ts";
import { BikePlace, ThingSlug } from "./things.ts";

// A planning workspace's Home (#208, #603): its main subject, then its projects, and nothing
// else: no chat. The subject is general, filled from any workspace's data, never made for one
// workspace: a Thing drawn as its kind of thing, or a room's floor plan.

/** A part on a drawn Thing: its name, and its upcoming replacement's, which its label says. */
export const DrawnPart = z.object({
  thing: ThingSlug,
  name: z.string(),
  /** Its upcoming replacement's name (#602): "Pedals · DMR V8 next". */
  upcoming: z.string().optional(),
});
export type DrawnPart = z.infer<typeof DrawnPart>;

/**
 * A floor plan's size against its space's floor as recorded (#711): the size measured (or from a
 * maker's or developer's plan); the size recorded, but only reported or estimated, so drawn as
 * unmeasured; or not the size recorded, which is flagged, with the size recorded.
 */
export const PlanCheck = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measured") }),
  z.object({ kind: z.literal("unmeasured") }),
  z.object({ kind: z.literal("differs"), recorded: z.string() }),
]);
export type PlanCheck = z.infer<typeof PlanCheck>;

/**
 * A planning workspace's main subject, which leads its Home (#603): a Thing drawn as its kind of
 * thing, its parts on the places saved on them and those with none listed under it; or a room's
 * floor plan, as last drawn in an answer (#257), or a house's floors (#670); or, until a space has
 * one, the space to draw (#604): a space Thing whose floor's length and width are recorded.
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
    /** Its size shown as measured only when the space's records measure it so (#711). */
    plan: FloorPlan,
    /** Its size against its space's floor as recorded, once that is; none before. */
    check: PlanCheck.optional(),
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
    /** What it's called, from the space's name: "garage", as in "Draw the garage". */
    name: z.string(),
    /** Its floor's length and width as recorded: "5140 mm × 2740 mm". */
    size: z.string(),
    /** Each of its size records standing, with its source, which a plan is drawn from. */
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
});
export type PlanningHome = z.infer<typeof PlanningHome>;
