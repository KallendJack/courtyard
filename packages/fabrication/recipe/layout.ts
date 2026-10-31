import type { BuildRecipe, RecipeGroup, RecipePiece, RecipeStock } from "@courtyard/contract";
import type { Box } from "../build.ts";
import { err, ok, type Result } from "../build.ts";
import { carcassBody } from "./carcass.ts";
import { castorsUnder } from "./castors.ts";
import { box, cutSize } from "./geometry.ts";
import { legsBody } from "./legs.ts";

// Where every piece of any recipe goes (#770), worked out from its groups and pieces as the words
// say them: the top on what it stands on, reaching past it by its overhang; legs and their frames,
// or a box; shelves and braces in them; supports across the middle; bases under each end, and the
// castors under those. A recipe this can't place is refused with the reason.

/** A piece placed: what it's from in the recipe, what it's called and does, its cut size and boxes. */
export type Placed = {
  /** The piece's or group's ID. */
  readonly from: string;
  readonly name: string;
  readonly does: string;
  /** The stock it's cut from, by its ID. */
  readonly stock: string;
  readonly kind: "timber" | "sheet";
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly boxes: readonly Box[];
  /** Legs, listed before the rest of their stock. */
  readonly legs?: boolean;
};

/**
 * Something fitted whole: its piece, the castor it is, and the member it's under; and the coach
 * screws' length when it's fixed from below rather than bolted through (#835).
 */
export type PlacedFitted = {
  readonly from: string;
  readonly stock: string;
  readonly under: string;
  readonly boxes: readonly Box[];
  readonly screws?: number;
};

export type Layout = {
  readonly placed: readonly Placed[];
  readonly fitted: readonly PlacedFitted[];
};

type Timber = Extract<RecipeStock, { kind: "timber" }>;
type Sheet = Extract<RecipeStock, { kind: "sheet" }>;
type Member = Extract<RecipePiece, { kind: "member" }>;

/** What a body (legs and frames, or a box) is placed from: the recipe and its overall sizes. */
export type Ctx = {
  readonly recipe: BuildRecipe;
  readonly timber: (id: string) => Timber;
  readonly sheet: (id: string) => Sheet;
  /** A piece's, group's or stock's ID in words: "top-support" is "Top support". */
  readonly name: (id: string) => string;
  /** Where in the recipe a group or piece is, for a refusal: "groups.3". */
  readonly at: (item: RecipeGroup | RecipePiece) => string;
  readonly top: Extract<RecipePiece, { kind: "panel" }> | undefined;
  /** The bases under each end, when it has them, and whether castors are fitted under those. */
  readonly base: Member | undefined;
  readonly castors: boolean;
  readonly length: number;
  readonly depth: number;
  /** The frame's or box's own footprint: the top's less its overhang on every side. */
  readonly left: number;
  readonly right: number;
  readonly front: number;
  readonly back: number;
  /** Where its legs' feet or the box's underside are, and the height from there to the top's underside. */
  readonly foot: number;
  readonly height: number;
};

/** What a body places, where the top goes on it, and where a support goes across its middle. */
export type Body = {
  readonly placed: Placed[];
  readonly problems: string[];
  readonly topZ: number;
  /** The span from front to back a support across the middle fills, when it has one. */
  readonly across: { readonly y: number; readonly depth: number } | undefined;
};

/** "top-support" as it's said: "Top support". */
export const words = (id: string) => {
  const said = id.replace(/-/g, " ");
  return said.charAt(0).toUpperCase() + said.slice(1);
};

export const said = (name: string) => name.toLowerCase();

const isKind = <K extends RecipeStock["kind"]>(
  item: RecipeStock | undefined,
  kind: K,
): item is Extract<RecipeStock, { kind: K }> => item?.kind === kind;

/**
 * A checked recipe's stock by its ID, of the kind it must be. The contract checked every
 * reference, so one that isn't is a bug.
 */
export const stockIn = (recipe: BuildRecipe) => {
  const stock = new Map(recipe.stock.map((item) => [item.id, item]));
  return <K extends RecipeStock["kind"]>(id: string, kind: K) => {
    const found = stock.get(id);
    if (!isKind(found, kind)) throw new Error(`The recipe was checked: "${id}" is a ${kind}.`);
    return found;
  };
};

/** The recipe's pieces placed, or why it can't be. */
export const layoutOf = (recipe: BuildRecipe): Result<Layout, string[]> => {
  const of = stockIn(recipe);
  const at = (item: RecipeGroup | RecipePiece) =>
    item.kind === "panel" ||
    item.kind === "member" ||
    item.kind === "fitted" ||
    item.kind === "printed"
      ? `pieces.${recipe.pieces.indexOf(item)}`
      : `groups.${recipe.groups.indexOf(item)}`;

  // A printed holder or bracket is a piece with its own screws (#773), placed with the parts.
  const printed = recipe.joints.flatMap((joint, index) =>
    joint.kind === "printed"
      ? [
          `joints.${index}: A printed joint isn't worked out in a recipe: make the holder or bracket a printed piece, with its screws.`,
        ]
      : [],
  );
  if (printed.length > 0) return err(printed);

  const stands = recipe.groups.filter((group) => group.kind === "legs" || group.kind === "box");
  const [on] = stands;
  if (on === undefined || stands.length > 1) {
    return err([
      `recipe: A recipe stands on one set of legs or one box, and this has ${stands.length === 0 ? "neither" : stands.length}.`,
    ]);
  }
  const [top, secondTop] = recipe.pieces.filter((piece) => piece.kind === "panel");
  if (secondTop) return err([`${at(secondTop)}: A recipe has one top.`]);

  // What's under each end: a base under the legs, their frames or the box, and castors under it.
  const holding = new Set([
    on.id,
    ...recipe.groups.flatMap((group) =>
      group.kind === "frame" && group.legs === on.id ? [group.id] : [],
    ),
  ]);
  const problems: string[] = [];
  const members = recipe.pieces.filter((piece) => piece.kind === "member");
  const bases = members.filter((member) => member.place === "under-each-end");
  for (const member of bases) {
    if (!holding.has(member.under)) {
      problems.push(
        `${at(member)}: A base goes under each end of the legs, their frames or the box.`,
      );
    }
  }
  const [base, secondBase] = bases;
  if (secondBase) problems.push(`${at(secondBase)}: A recipe has one base each end.`);
  const fitted = recipe.pieces.filter((piece) => piece.kind === "fitted");
  for (const piece of fitted) {
    if (piece.under !== base?.id) {
      problems.push(`${at(piece)}: A castor is fitted under the base under each end.`);
    }
  }
  const [fit, secondFit] = fitted;
  if (secondFit) problems.push(`${at(secondFit)}: A recipe has one castor under each end.`);
  if (problems.length > 0) return err(problems);
  const castor = fit && of(fit.stock, "castor");

  const overhang = top?.overhang.value ?? 0;
  const length = recipe.size.length.value;
  const depth = recipe.size.depth.value;
  const topThick = top ? of(top.stock, "sheet").thickness.value : 0;
  const castorHeight = castor?.height.value ?? 0;
  const foot = castorHeight + (base ? of(base.stock, "timber").thickness.value : 0);
  const ctx: Ctx = {
    recipe,
    timber: (id) => of(id, "timber"),
    sheet: (id) => of(id, "sheet"),
    name: words,
    at,
    top,
    base,
    castors: castor !== undefined,
    length,
    depth,
    left: overhang,
    right: length - overhang,
    front: overhang,
    back: depth - overhang,
    foot,
    height: recipe.size.height.value - topThick - foot,
  };
  const body = on.kind === "legs" ? legsBody(ctx, on) : carcassBody(ctx, on);
  if (body.problems.length > 0) return err(body.problems);
  const placed = [...body.placed];

  if (top) {
    const z = body.topZ;
    placed.push({
      from: top.id,
      name: words(top.id),
      does:
        overhang > 0
          ? `The ${said(words(top.id))}, reaching past what's under it on every side.`
          : `The ${said(words(top.id))}, flush with what's under it.`,
      stock: top.stock,
      kind: "sheet",
      length: cutSize(length),
      width: cutSize(depth),
      thickness: topThick,
      boxes: [box(0, 0, z, length, depth, topThick)],
    });
  }

  for (const member of members) {
    const timber = of(member.stock, "timber");
    const thick = timber.thickness.value;
    const wide = timber.width.value;
    if (member.place === "under-each-end") {
      const frameDepth = ctx.back - ctx.front;
      placed.push({
        from: member.id,
        name: words(member.id),
        does: `Under each end${on.kind === "box" ? ` of the ${said(words(on.id))}` : " frame"}, ${castor ? "with a castor bolted under each end" : "lifting it off the floor"}.`,
        stock: member.stock,
        kind: "timber",
        length: cutSize(frameDepth),
        width: wide,
        thickness: thick,
        boxes: [ctx.left, ctx.right - wide].map((x) =>
          box(x, ctx.front, castorHeight, wide, frameDepth, thick),
        ),
      });
      continue;
    }
    const under = placed.find((each) => each.from === member.under);
    const supported = under?.boxes[0];
    if (body.across === undefined || supported === undefined || under?.kind !== "sheet") {
      problems.push(
        `${at(member)}: A support across the middle goes under a top or a shelf on a frame's rails.`,
      );
      continue;
    }
    placed.push({
      from: member.id,
      name: words(member.id),
      does: `Across the middle under the ${said(under.name)}, so it doesn't sag.`,
      stock: member.stock,
      kind: "timber",
      length: cutSize(body.across.depth),
      width: wide,
      thickness: thick,
      boxes: [
        box(
          (length - thick) / 2,
          body.across.y,
          supported.z - wide,
          thick,
          body.across.depth,
          wide,
        ),
      ],
    });
  }
  if (problems.length > 0) return err(problems);

  // Each castor clear of what stands on its base, or on coach screws from below (#835).
  const fittedPlaced = fitted.flatMap((piece): PlacedFitted[] => {
    const under = placed.find((each) => each.from === piece.under);
    if (!castor || !under) return [];
    return [
      {
        from: piece.id,
        stock: piece.stock,
        under: piece.under,
        ...castorsUnder({ recipe, placed, base: under, fitted: piece.id, castor }),
      },
    ];
  });
  return ok({ placed, fitted: fittedPlaced });
};
