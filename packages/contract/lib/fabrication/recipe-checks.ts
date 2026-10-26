import type { z } from "zod";
import type { SourcedSize } from "../sourced/size.ts";
import type { RecipeFields } from "./build-recipe.ts";
import { overMost } from "./recipe-refusals.ts";

// What a Build's recipe (ADR 0039) is checked for beyond its shape: every size within its bounds,
// every ID used once, and every reference to a stock, piece or group of the right kind.

/**
 * How big a recipe gets: the build's own sizes and a stock's (mm), the kerf and an overhang, what
 * is fitted and bolted (a castor's height and plate and a bolt's length; a bolt's thread and pitch,
 * a washer and a nut, #770), how many lengths or sheets of a stock the owner has, and how many
 * stocks, pieces, groups and joints. Practical things
 * (shelves, racks, boxes, stands and benches) fit well inside them; a recipe over them is refused
 * with the reason.
 */
export const RECIPE_MOST = {
  size: 3000,
  stockSize: 6000,
  kerf: 10,
  overhang: 300,
  fitting: 300,
  thread: 24,
  pitch: 4,
  washer: 10,
  nut: 30,
  have: 50,
  stock: 16,
  pieces: 24,
  groups: 12,
  joints: 32,
} as const;

type Path = (string | number)[];

/** Every size within its most, refused by where it is in the recipe. */
export const withinBounds = (recipe: RecipeFields, context: z.RefinementCtx) => {
  const most = (path: Path, size: SourcedSize, bound: number, what: string, zero = false) =>
    overMost(context, path, size, bound, what, { zero });
  for (const side of ["length", "depth", "height"] as const) {
    most(["size", side], recipe.size[side], RECIPE_MOST.size, `The ${side}`);
  }
  most(["kerf"], recipe.kerf, RECIPE_MOST.kerf, "The kerf", true);
  recipe.stock.forEach((stock, index) => {
    if (stock.kind === "timber" || stock.kind === "sheet") {
      for (const side of ["thickness", "width", "length"] as const) {
        most(["stock", index, side], stock[side], RECIPE_MOST.stockSize, `${stock.name}'s ${side}`);
      }
    }
    if (stock.kind === "castor") {
      most(["stock", index, "height"], stock.height, RECIPE_MOST.fitting, "The castor's height");
      for (const side of ["length", "width", "thickness"] as const) {
        most(
          ["stock", index, "plate", side],
          stock.plate[side],
          RECIPE_MOST.fitting,
          `The castor's plate's ${side}`,
        );
      }
    }
  });
  recipe.pieces.forEach((piece, index) => {
    if (piece.kind === "panel") {
      most(
        ["pieces", index, "overhang"],
        piece.overhang,
        RECIPE_MOST.overhang,
        "The overhang",
        true,
      );
    }
  });
  recipe.groups.forEach((group, index) => {
    if (group.kind === "frame") {
      most(["groups", index, "lower"], group.lower, RECIPE_MOST.size, "The lower rails' height");
    }
  });
  recipe.joints.forEach((joint, index) => {
    if (joint.kind !== "bolted") return;
    const at = (...path: Path) => ["joints", index, ...path];
    most(at("bolt", "diameter"), joint.bolt.diameter, RECIPE_MOST.thread, "The bolt's thread");
    most(at("bolt", "pitch"), joint.bolt.pitch, RECIPE_MOST.pitch, "The bolt's pitch");
    most(at("bolt", "length"), joint.bolt.length, RECIPE_MOST.fitting, "The bolt's length");
    most(
      at("washer", "thickness"),
      joint.washer.thickness,
      RECIPE_MOST.washer,
      "The washer's thickness",
    );
    most(at("nut", "height"), joint.nut.height, RECIPE_MOST.nut, "The nut's height");
  });
};

/** Each kind of stock, piece and group a reference can point at. */
type Named = { readonly what: "stock" | "piece" | "group"; readonly kind: string };

/** Every ID used once, and every reference to what's in the recipe and of the right kind. */
export const referencesHold = (recipe: RecipeFields, context: z.RefinementCtx) => {
  const named = new Map<string, Named>();
  const name = (id: string, path: Path, what: Named) => {
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

  /** A reference that must be to one of these kinds of stock, piece or group, or to any piece. */
  const refer = (
    id: string,
    path: Path,
    to: {
      stock?: readonly string[];
      pieces?: readonly string[];
      groups?: readonly string[];
      anyPiece?: boolean;
    },
    what: string,
  ) => {
    const found = named.get(id);
    const fits =
      found !== undefined &&
      ((found.what === "stock" && (to.stock ?? []).includes(found.kind)) ||
        (found.what === "piece" && (to.pieces ?? []).includes(found.kind)) ||
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
    if (piece.kind === "fitted") {
      refer(piece.stock, at("stock"), { stock: ["castor"] }, "what's fitted is a castor");
      refer(piece.under, at("under"), { pieces: ["member"] }, "a castor is fitted under a member");
    }
    if (piece.kind === "printed") {
      refer(piece.on, at("on"), anyPiece, "a printed part goes on a piece or group");
      if (piece.part === "holder") {
        refer(piece.fits, at("fits"), timber, "a holder takes a timber's end");
      } else {
        refer(
          piece.fits,
          at("fits"),
          { stock: ["timber", "sheet"] },
          "a bracket fits a timber or sheet",
        );
      }
      if (piece.screws !== undefined) {
        refer(piece.screws, at("screws"), fixing, "a printed part's screws are a fixing");
      }
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
    if (group.kind === "box") {
      refer(group.fixing, at("fixing"), fixing, "a box's panels are held with a fixing");
    }
    if (group.kind === "shelf") {
      refer(group.on, at("on"), { groups: ["frame", "box"] }, "a shelf is in a frame or box");
    }
    if (group.kind === "brace") {
      refer(group.on, at("on"), { groups: ["frame"] }, "a brace goes on a frame");
    }
  });
  recipe.joints.forEach((joint, index) => {
    const at = (...field: Path) => ["joints", index, ...field];
    joint.joins.forEach((id, side) => {
      refer(id, at("joins", side), anyPiece, "a joint holds two pieces or groups");
    });
    if (joint.joins[0] === joint.joins[1]) {
      context.addIssue({
        code: "custom",
        path: at("joins"),
        message: `"${joint.joins[0]}" is joined to itself: a joint holds two pieces or groups.`,
      });
    }
    if ("fixing" in joint && joint.fixing !== undefined) {
      refer(joint.fixing, at("fixing"), fixing, "a joint is held with a fixing");
    }
    if (joint.kind === "bracket" && joint.screws !== undefined) {
      refer(joint.screws, at("screws"), fixing, "a bracket's screws are a fixing");
    }
  });
};
