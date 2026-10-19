import { z } from "zod";
import { DocumentSlug } from "./documents.ts";
import { FloorPlan } from "./floor-plan.ts";
import { Effort, ModelRef, SessionId } from "./session.ts";
import { ThingPin, ThingSlug, ThingStatus } from "./things.ts";

// A planning workspace's Home (#208): one big view, kept by the worker from the workspace's data,
// with the owner's last question above it and the next steps under it. Each view is general, filled
// from any workspace's Things, never made for one workspace.

/**
 * A view on Home, by what it shows: `wanted`, `picture:<slug>` for that Thing's photo, or
 * `plan:<slug>` for the floor plan saved as that document.
 */
export const HomeViewId = z
  .string()
  .regex(/^(?:wanted|(?:picture|plan):[a-z0-9]+(?:-[a-z0-9]+)*)$/)
  .brand<"HomeViewId">();
export type HomeViewId = z.infer<typeof HomeViewId>;

/**
 * A part on its Thing's photo: its pin (`null` until one's placed), and whether it's flagged,
 * which it is only when it needs something (to get, to replace, or a next step).
 */
export const PinnedPart = z.object({
  thing: ThingSlug,
  name: z.string(),
  status: ThingStatus,
  needs: z.string().optional(),
  pin: ThingPin.nullable(),
  flagged: z.boolean(),
});
export type PinnedPart = z.infer<typeof PinnedPart>;

/** A Thing the owner wants or means to replace, with its price when known and its next step. */
export const WantedItem = z.object({
  thing: ThingSlug,
  name: z.string(),
  status: z.enum(["want", "replace"]),
  price: z.string().optional(),
  needs: z.string().optional(),
});
export type WantedItem = z.infer<typeof WantedItem>;

const viewBase = {
  /** Its switch chip's words. */
  title: z.string(),
  /** When what it shows last changed, which decides the view showing until the owner picks one. */
  changedAt: z.iso.datetime(),
};

/**
 * One of Home's views: a Thing's photo with its parts pinned, flagged first, then the rest; a
 * room's floor plan, as last drawn in an answer (#257); or the wanted list, from the Things wanted
 * or to replace. Renders and phases come with their own issues, as further kinds here.
 */
export const HomeView = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"),
    id: HomeViewId,
    ...viewBase,
    /** The document it's saved as. */
    document: DocumentSlug,
    plan: FloorPlan,
  }),
  z.object({
    kind: z.literal("picture"),
    id: HomeViewId,
    ...viewBase,
    /** The Thing whose photo it is. */
    thing: ThingSlug,
    parts: z.array(PinnedPart),
  }),
  z.object({
    kind: z.literal("wanted"),
    id: HomeViewId,
    ...viewBase,
    items: z.array(WantedItem),
  }),
]);
export type HomeView = z.infer<typeof HomeView>;

/**
 * The owner's last message in the workspace, in the session they last used, and the replies its
 * answer suggested as next steps (none while it's being answered).
 */
export const LastQuestion = z.object({
  session: SessionId,
  text: z.string(),
  at: z.iso.datetime(),
  nextSteps: z.array(z.string()),
  /** Whether its answer is being written now. */
  answering: z.boolean(),
  /** The model and effort it was asked with, which a reply from Home carries on with (#481). */
  model: ModelRef,
  effort: Effort.optional(),
});
export type LastQuestion = z.infer<typeof LastQuestion>;

/** A planning workspace's Home, as `GET /api/workspaces/:id/home` gives it. */
export const PlanningHome = z.object({
  /** Its views, each Thing's photo in list order, then the wanted list. */
  views: z.array(HomeView),
  /** The view showing: the owner's pick while it's there, else the one last changed. */
  showing: HomeViewId.nullable(),
  /** Whether `showing` is the owner's pick. */
  picked: z.boolean(),
  /** The workspace's photo, top right: its main Thing's, by its file's name. */
  photo: ThingSlug.nullable(),
  question: LastQuestion.nullable(),
});
export type PlanningHome = z.infer<typeof PlanningHome>;

/** The owner's pick of the view Home shows (#208), which sticks until they pick another. */
export const HomeViewPick = z.object({ view: HomeViewId });
export type HomeViewPick = z.infer<typeof HomeViewPick>;
