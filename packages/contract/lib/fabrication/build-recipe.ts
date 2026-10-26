import { z } from "zod";
import { SourcedSize } from "../sourced/size.ts";
import {
  BuildFixing,
  BuildOptionPrices,
  BuildPrice,
  BuildSheet,
  BuildTimber,
  BuildToolId,
} from "./materials.ts";
import { PartRecipe } from "./recipe.ts";

// A Build's recipe (ADR 0039, #769): what it's made of, as a model writes it. Its stock, its
// pieces (timber members, sheet panels, printed parts), its groups of pieces (legs, frames, a box,
// a shelf, a brace) and the joints that hold them, every size with its source. Code works out the
// rest: the parts and their lengths, the cut plan, the buy list, the steps and the checks. Nothing
// it writes is a length to cut, a quantity or a total.
//
// The words for where things go: the build's length runs left to right, its depth front to back,
// its height up from the floor. Its ends are left and right, its sides front and back.

const Words = z.string().trim().min(1).max(80);

/** A stock's, piece's, group's or joint's name in the recipe, so others can point at it. */
export const RecipeId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Name it in lower case, words joined by dashes.")
  .max(40);
export type RecipeId = z.infer<typeof RecipeId>;

/**
 * How big a recipe gets: the build's own sizes and a stock's (mm), the kerf and an overhang, and
 * how many stocks, pieces, groups and joints. Practical things (shelves, racks, boxes, stands and
 * benches) fit well inside them; a recipe over them is refused with the reason.
 */
export const RECIPE_MOST = {
  size: 3000,
  stockSize: 6000,
  kerf: 10,
  overhang: 300,
  stock: 16,
  pieces: 24,
  groups: 12,
  joints: 32,
} as const;

/** Something bought whole and fitted, never cut: a castor, under a base. */
const Castor = z.strictObject({
  kind: z.literal("castor"),
  id: RecipeId,
  name: Words,
  /** From the floor to the top of its plate. */
  height: SourcedSize,
  price: BuildPrice.optional(),
  plate: z.strictObject({ length: SourcedSize, width: SourcedSize, thickness: SourcedSize }),
});

/** What the recipe's pieces are cut from and fixed with, each by its own ID. */
export const RecipeStock = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("timber"), id: RecipeId, ...BuildTimber.shape }),
  z.strictObject({ kind: z.literal("sheet"), id: RecipeId, ...BuildSheet.shape }),
  z.strictObject({ kind: z.literal("fixing"), id: RecipeId, ...BuildFixing.shape }),
  Castor,
]);
export type RecipeStock = z.infer<typeof RecipeStock>;

/**
 * A piece on its own: a sheet panel (the top, reaching past what's under it by its overhang on
 * every side), a timber member (across the middle of what it's under, or one under each end of
 * it), or a printed part (#702) on another piece.
 */
export const RecipePiece = z.discriminatedUnion("kind", [
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
    kind: z.literal("printed"),
    id: RecipeId,
    part: PartRecipe,
    count: z.number().int().positive().max(50).default(1),
    /** The piece or group it's fitted to. */
    on: RecipeId,
  }),
]);
export type RecipePiece = z.infer<typeof RecipePiece>;

/**
 * Pieces in a group: four legs at the corners; a rectangle frame of rails at the top and `lower`
 * above the legs' feet, on the ends or the front and back; a box or carcass of sheet, open on one
 * side; a shelf resting on a frame's lower rails or on cleats; brace panels on a frame's back or
 * ends, so it can't rack.
 */
export const RecipeGroup = z.discriminatedUnion("kind", [
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
]);
export type RecipeGroup = z.infer<typeof RecipeGroup>;

/** Two pieces or groups a joint holds, by their IDs. */
const Joins = z.tuple([RecipeId, RecipeId]);

/**
 * How two pieces are held: screws through one timber into another, staggered; screws through a
 * sheet into the edges under it; an angle bracket in the corner, with its screws (the sheet
 * screws' when left out); a castor bolted under a piece, `each` bolts through its plate, each with
 * its washers and nut; or a printed holder or bracket.
 */
export const RecipeJoint = z.discriminatedUnion("kind", [
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
    /** The piece the castor is under. */
    piece: RecipeId,
    fits: RecipeId,
    at: z.enum(["each-end"]),
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
]);
export type RecipeJoint = z.infer<typeof RecipeJoint>;

/** Each kind of stock, piece and group a reference can point at. */
type Named = { readonly what: "stock" | "piece" | "group"; readonly kind: string };

/**
 * A size over its most, or nothing where it can't be (a 0 kerf or overhang can), refused with what
 * it is and what it can be.
 */
const overMost = (
  context: z.RefinementCtx,
  path: (string | number)[],
  size: SourcedSize,
  most: number,
  what: string,
  { zero = false }: { zero?: boolean } = {},
) => {
  if ((!zero && size.value <= 0) || size.value > most) {
    context.addIssue({
      code: "custom",
      path,
      message: `${what} is ${size.value} mm: it must be ${zero ? "" : "more than 0 and "}at most ${most} mm.`,
    });
  }
};

/**
 * A recipe as written: its overall size, the saw's kerf, its stock, pieces, groups and joints, and
 * what it's worked out with (whether it stands somewhere damp, the stock options' prices, the
 * tools to hand). Checked here: every size and count within `RECIPE_MOST`, every ID used once, and
 * every reference to a stock, piece or group of the right kind.
 */
export const BuildRecipe = z
  .strictObject({
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
  })
  .superRefine((recipe, context) => {
    for (const side of ["length", "depth", "height"] as const) {
      overMost(context, ["size", side], recipe.size[side], RECIPE_MOST.size, `The ${side}`);
    }
    overMost(context, ["kerf"], recipe.kerf, RECIPE_MOST.kerf, "The kerf", { zero: true });
    recipe.stock.forEach((stock, index) => {
      if (stock.kind !== "timber" && stock.kind !== "sheet") return;
      for (const side of ["thickness", "width", "length"] as const) {
        overMost(
          context,
          ["stock", index, side],
          stock[side],
          RECIPE_MOST.stockSize,
          `${stock.name}'s ${side}`,
        );
      }
    });
    recipe.pieces.forEach((piece, index) => {
      if (piece.kind === "panel") {
        overMost(
          context,
          ["pieces", index, "overhang"],
          piece.overhang,
          RECIPE_MOST.overhang,
          "The overhang",
          { zero: true },
        );
      }
    });
    recipe.groups.forEach((group, index) => {
      if (group.kind === "frame") {
        overMost(
          context,
          ["groups", index, "lower"],
          group.lower,
          RECIPE_MOST.size,
          "The lower rails' height",
        );
      }
    });

    const named = new Map<string, Named>();
    const name = (id: string, path: (string | number)[], what: Named) => {
      if (named.has(id)) {
        context.addIssue({
          code: "custom",
          path,
          message: `"${id}" names two things: give each its own.`,
        });
      }
      named.set(id, what);
    };
    recipe.stock.forEach((stock, index) => {
      name(stock.id, ["stock", index, "id"], { what: "stock", kind: stock.kind });
    });
    recipe.groups.forEach((group, index) => {
      name(group.id, ["groups", index, "id"], { what: "group", kind: group.kind });
    });
    recipe.pieces.forEach((piece, index) => {
      name(piece.id, ["pieces", index, "id"], { what: "piece", kind: piece.kind });
    });

    /** A reference that must be to one of these kinds of stock, or to a piece or group. */
    const refer = (
      id: string,
      path: (string | number)[],
      to: { stock?: readonly string[]; groups?: readonly string[]; anyPiece?: boolean },
      what: string,
    ) => {
      const found = named.get(id);
      const fits =
        found !== undefined &&
        ((found.what === "stock" && (to.stock ?? []).includes(found.kind)) ||
          (found.what === "group" && (to.groups ?? []).includes(found.kind)) ||
          (found.what !== "stock" && to.anyPiece === true));
      if (!fits) {
        context.addIssue({
          code: "custom",
          path,
          message:
            found === undefined
              ? `"${id}" isn't in the recipe: ${what}.`
              : `"${id}" is a ${found.kind}: ${what}.`,
        });
      }
    };
    const timber = { stock: ["timber"] } as const;
    const sheet = { stock: ["sheet"] } as const;
    const fixing = { stock: ["fixing"] } as const;
    const anyPiece = { anyPiece: true } as const;

    recipe.pieces.forEach((piece, index) => {
      const at = (field: string) => ["pieces", index, field];
      if (piece.kind === "panel")
        refer(piece.stock, at("stock"), sheet, "a panel is cut from a sheet");
      if (piece.kind === "member") {
        refer(piece.stock, at("stock"), timber, "a member is cut from a timber");
        refer(piece.under, at("under"), anyPiece, "a member goes under a piece or group");
      }
      if (piece.kind === "printed") {
        refer(piece.on, at("on"), anyPiece, "a printed part goes on a piece or group");
      }
    });
    recipe.groups.forEach((group, index) => {
      const at = (field: string) => ["groups", index, field];
      if (group.kind === "legs" || group.kind === "frame") {
        refer(
          group.stock,
          at("stock"),
          timber,
          `${group.kind === "legs" ? "legs are" : "a frame is"} cut from a timber`,
        );
      } else {
        refer(group.stock, at("stock"), sheet, `a ${group.kind} is cut from a sheet`);
      }
      if (group.kind === "frame") {
        refer(group.legs, at("legs"), { groups: ["legs"] }, "a frame's rails join legs");
      }
      if (group.kind === "shelf") {
        refer(group.on, at("on"), { groups: ["frame", "box"] }, "a shelf is in a frame or box");
      }
      if (group.kind === "brace") {
        refer(group.on, at("on"), { groups: ["frame"] }, "a brace goes on a frame");
      }
    });
    recipe.joints.forEach((joint, index) => {
      const at = (...field: (string | number)[]) => ["joints", index, ...field];
      if (joint.kind === "bolted") {
        refer(joint.piece, at("piece"), anyPiece, "a castor is bolted under a piece");
        refer(joint.fits, at("fits"), { stock: ["castor"] }, "a bolt fits a castor");
        return;
      }
      joint.joins.forEach((id, side) => {
        refer(id, at("joins", side), anyPiece, "a joint holds two pieces or groups");
      });
      if (joint.fixing !== undefined) {
        refer(joint.fixing, at("fixing"), fixing, "a joint is held with a fixing");
      }
      if (joint.kind === "bracket" && joint.screws !== undefined) {
        refer(joint.screws, at("screws"), fixing, "a bracket's screws are a fixing");
      }
    });
  });
export type BuildRecipe = z.infer<typeof BuildRecipe>;
