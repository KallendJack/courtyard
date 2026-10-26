import { z } from "zod";
import { SourcedSize } from "../sourced/size.ts";
import {
  BuildFixing,
  BuildOptionPrices,
  BuildPrice,
  BuildSheet,
  BuildTimber,
  BuildToolId,
  Words,
} from "./materials.ts";
import { PartRecipe } from "./recipe.ts";
import { RECIPE_MOST, referencesHold, withinBounds } from "./recipe-checks.ts";
import { notAKind } from "./recipe-refusals.ts";

export { RECIPE_MOST } from "./recipe-checks.ts";

// A Build's recipe (ADR 0039, #769): what it's made of, as a model writes it. Its stock, its
// pieces (timber members, sheet panels, printed parts), its groups of pieces (legs, frames, a box,
// a shelf, a brace) and the joints that hold them, every size with its source. Code works out the
// rest: the parts and their lengths, the cut plan, the buy list, the steps and the checks. Nothing
// it writes is a length to cut, a quantity or a total.
//
// The words for where things go: the build's length runs left to right, its depth front to back,
// its height up from the floor. Its ends are left and right, its sides front and back.

/** A stock's, piece's, group's or joint's name in the recipe, so others can point at it. */
export const RecipeId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Name it in lower case, words joined by dashes.")
  .max(40);
export type RecipeId = z.infer<typeof RecipeId>;

/** Something bought whole and fitted, never cut: a castor, fitted under a piece. */
const Castor = z.strictObject({
  kind: z.literal("castor"),
  id: RecipeId,
  name: Words,
  /** From the floor to the top of its plate. */
  height: SourcedSize,
  price: BuildPrice.optional(),
  plate: z.strictObject({ length: SourcedSize, width: SourcedSize, thickness: SourcedSize }),
});

/**
 * How many of a timber's lengths or a sheet's sheets the owner has already, at its size (spare
 * lengths, or offcuts given as a stock of their own), used before any is bought (#770).
 */
const Have = z.number().int().positive().max(RECIPE_MOST.have).optional();

/** What the recipe's pieces are cut from and fixed with, each by its own ID. */
export const RecipeStock = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("timber"), id: RecipeId, ...BuildTimber.shape, have: Have }),
    z.strictObject({ kind: z.literal("sheet"), id: RecipeId, ...BuildSheet.shape, have: Have }),
    z.strictObject({ kind: z.literal("fixing"), id: RecipeId, ...BuildFixing.shape }),
    Castor,
  ],
  { error: notAKind("stock") },
);
export type RecipeStock = z.infer<typeof RecipeStock>;

/**
 * A piece on its own: a sheet panel (the top, reaching past what's under it by its overhang on
 * every side), a timber member (across the middle of what it's under, or one under each end of
 * it), something bought whole and fitted (a castor under each end of a member), or a printed part
 * (#702) on another piece.
 */
export const RecipePiece = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("panel"),
      id: RecipeId,
      stock: RecipeId,
      place: z.enum(["top"]),
      overhang: SourcedSize,
    }),
    z.strictObject({
      kind: z.literal("member"),
      id: RecipeId,
      stock: RecipeId,
      place: z.enum(["across-the-middle", "under-each-end"]),
      /** The piece or group it's under. */
      under: RecipeId,
    }),
    z.strictObject({
      kind: z.literal("fitted"),
      id: RecipeId,
      /** The castor it is. */
      stock: RecipeId,
      at: z.enum(["each-end"]),
      /** The member it's under. */
      under: RecipeId,
    }),
    z.strictObject({
      kind: z.literal("printed"),
      id: RecipeId,
      part: PartRecipe,
      count: z.number().int().positive().max(50).default(1),
      /** The piece or group it's fitted to. */
      on: RecipeId,
    }),
  ],
  { error: notAKind("piece") },
);
export type RecipePiece = z.infer<typeof RecipePiece>;

/**
 * Pieces in a group: four legs at the corners; a rectangle frame of rails at the top and `lower`
 * above the legs' feet, on the ends or the front and back; a box or carcass of sheet, open on one
 * side, its panels screwed together with its `fixing`; a shelf resting on a frame's lower rails,
 * or on cleats in a box; brace panels on a frame's back or ends, so it can't rack.
 */
export const RecipeGroup = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("legs"),
      id: RecipeId,
      stock: RecipeId,
      at: z.enum(["corners"]),
    }),
    z.strictObject({
      kind: z.literal("frame"),
      id: RecipeId,
      stock: RecipeId,
      /** The legs its rails join. */
      legs: RecipeId,
      sides: z.enum(["ends", "front-and-back"]),
      /** The lower rails' height above the legs' feet. */
      lower: SourcedSize,
    }),
    z.strictObject({
      kind: z.literal("box"),
      id: RecipeId,
      stock: RecipeId,
      open: z.enum(["front", "top"]),
      /** The screws through each panel into the edges of the next. */
      fixing: RecipeId,
    }),
    z.strictObject({
      kind: z.literal("shelf"),
      id: RecipeId,
      stock: RecipeId,
      /** The frame or box it's in. */
      on: RecipeId,
      rests: z.enum(["rails", "cleats"]),
    }),
    z.strictObject({
      kind: z.literal("brace"),
      id: RecipeId,
      stock: RecipeId,
      on: RecipeId,
      sides: z
        .array(z.enum(["back", "ends"]))
        .min(1)
        .max(2),
    }),
  ],
  { error: notAKind("group") },
);
export type RecipeGroup = z.infer<typeof RecipeGroup>;

/** Two pieces or groups a joint holds, by their IDs. */
const Joins = z.tuple([RecipeId, RecipeId]);

/**
 * How two pieces are held: screws through one timber into another, staggered; screws through a
 * sheet (the first) into the edges under it; an angle bracket in the corner, with its screws (the
 * sheet screws' when left out); `each` bolts wherever the two meet (a castor's plate on its base,
 * a rail on a leg), each with its washers and nut; or a printed holder or bracket.
 */
export const RecipeJoint = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("screwed"), joins: Joins, fixing: RecipeId }),
    z.strictObject({ kind: z.literal("sheet-screwed"), joins: Joins, fixing: RecipeId }),
    z.strictObject({
      kind: z.literal("bracket"),
      joins: Joins,
      fixing: RecipeId,
      screws: RecipeId.optional(),
    }),
    z.strictObject({
      kind: z.literal("bolted"),
      joins: Joins,
      /** How many bolts where the two meet: 4 through a castor's plate. */
      each: z.number().int().positive().max(8),
      bolt: z.strictObject({
        diameter: SourcedSize,
        /** The thread's pitch: two threads past the nut is the least that holds. */
        pitch: SourcedSize,
        length: SourcedSize,
        price: BuildPrice.optional(),
      }),
      washer: z.strictObject({
        thickness: SourcedSize,
        perBolt: z.number().int().nonnegative().max(4),
        price: BuildPrice.optional(),
      }),
      nut: z.strictObject({ height: SourcedSize, price: BuildPrice.optional() }),
    }),
    z.strictObject({ kind: z.literal("printed"), joins: Joins, fixing: RecipeId.optional() }),
  ],
  { error: notAKind("joint") },
);
export type RecipeJoint = z.infer<typeof RecipeJoint>;

/**
 * A recipe as written: its overall size, the saw's kerf, its stock, pieces, groups and joints, and
 * what it's worked out with (whether it stands somewhere damp, the stock options' prices, the
 * tools to hand), before it's checked.
 */
const RecipeFields = z.strictObject({
  size: z.strictObject({ length: SourcedSize, depth: SourcedSize, height: SourcedSize }),
  kerf: SourcedSize,
  stock: z
    .array(RecipeStock)
    .min(1)
    .max(RECIPE_MOST.stock, `A recipe has at most ${RECIPE_MOST.stock} stocks.`),
  pieces: z
    .array(RecipePiece)
    .max(RECIPE_MOST.pieces, `A recipe has at most ${RECIPE_MOST.pieces} pieces on their own.`)
    .default([]),
  groups: z
    .array(RecipeGroup)
    .max(RECIPE_MOST.groups, `A recipe has at most ${RECIPE_MOST.groups} groups.`)
    .default([]),
  joints: z
    .array(RecipeJoint)
    .max(RECIPE_MOST.joints, `A recipe has at most ${RECIPE_MOST.joints} joints.`)
    .default([]),
  damp: z.boolean().default(false),
  prices: BuildOptionPrices.default({}),
  tools: z.array(BuildToolId).default([]),
});
export type RecipeFields = z.infer<typeof RecipeFields>;

/**
 * A recipe, checked (`recipe-checks.ts`): every size and count within `RECIPE_MOST`, every ID used
 * once, and every reference to a stock, piece or group of the right kind.
 */
export const BuildRecipe = RecipeFields.superRefine((recipe, context) => {
  withinBounds(recipe, context);
  referencesHold(recipe, context);
});
export type BuildRecipe = z.infer<typeof BuildRecipe>;
