import { BuildRecipe, type RecipeStock } from "@courtyard/contract";
import {
  type Build,
  type BuyLine,
  err,
  type Fitted,
  ok,
  type Part,
  type Result,
} from "../build.ts";
import { buyLine, buyListOf, stockLines } from "../buy-list.ts";
import type { Role } from "../catalog.ts";
import { cutPlanOf, type Spares } from "../cut-plan.ts";
import { assumedSizes } from "../findings.ts";
import { pickStock, type Slot, standsInFor, stockOptions, wrongStock } from "../options.ts";
import { bagOf } from "../parts-page.ts";
import type { Sheet, StockOptionId, Timber } from "../stock.ts";
import { fixingsOf } from "./fixings.ts";
import { layoutOf, type Placed, said, stockIn, words } from "./layout.ts";

// Any recipe worked out (#770): its pieces placed, so its parts, each lettered with its cut size;
// its cut plan, on the stock the owner has first; its buy list, less what they have; the stock
// findings; and each timber's and sheet's options, costed by working it out again with each
// (#704). Its steps are the bench's until they're worked out from the joints (#772).

/** Part letters, as the agreed boards give them: no I or O, which read as 1 and 0. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const letter = (at: number) =>
  at < LETTERS.length
    ? (LETTERS[at] as string)
    : `${LETTERS[Math.floor(at / LETTERS.length) - 1]}${LETTERS[at % LETTERS.length]}`;

type CutStock = Extract<RecipeStock, { kind: "timber" | "sheet" }>;
const isCut = (stock: RecipeStock): stock is CutStock =>
  stock.kind === "timber" || stock.kind === "sheet";
/** A recipe's stock as a template's: what it is, without its ID or how many are had. */
const asStock = ({ kind: _kind, id: _id, have: _have, ...stock }: CutStock): Timber | Sheet =>
  stock;

/**
 * Each piece as a part, lettered in the order they're cut: timber before sheets, each stock in the
 * recipe's order, its legs first, then the longest down.
 */
const lettered = (recipe: BuildRecipe, placed: readonly Placed[]) => {
  const at = (id: string) => recipe.stock.findIndex((item) => item.id === id);
  const name = (id: string) => recipe.stock.find((item) => item.id === id)?.name ?? id;
  return placed
    .map((piece, index) => ({ piece, index }))
    .sort(
      (a, b) =>
        Number(a.piece.kind === "sheet") - Number(b.piece.kind === "sheet") ||
        at(a.piece.stock) - at(b.piece.stock) ||
        Number(b.piece.legs === true) - Number(a.piece.legs === true) ||
        b.piece.length - a.piece.length ||
        b.piece.width - a.piece.width ||
        a.index - b.index,
    )
    .map(({ piece }, index) => ({
      piece,
      part: {
        label: letter(index),
        name: piece.name,
        does: piece.does,
        count: piece.boxes.length,
        material: { kind: piece.kind, stock: name(piece.stock) },
        length: piece.length,
        width: piece.width,
        thickness: piece.thickness,
        boxes: piece.boxes,
      } satisfies Part,
    }));
};

const SLOT: Readonly<Record<Role, { name: string; recommended: StockOptionId }>> = {
  frame: { name: "Frame timber", recommended: "c16-45x95" },
  wide: { name: "Wide timber", recommended: "c16-45x145" },
  sheet: { name: "Sheet", recommended: "plywood-18" },
};

/**
 * Each stock pieces are cut from, as a slot its options can fill: the frame's timber (legs and
 * rails), the wide timber (supports and bases, which take bolts), or a sheet.
 */
const slotsOf = (
  recipe: BuildRecipe,
  parts: readonly { piece: Placed; part: Part }[],
): Slot<BuildRecipe>[] =>
  recipe.stock.filter(isCut).flatMap((item) => {
    const cut = parts.filter(({ piece }) => piece.stock === item.id);
    if (cut.length === 0) return [];
    const framing = cut.some(({ piece }) =>
      recipe.groups.some(
        (group) => group.id === piece.from && (group.kind === "legs" || group.kind === "frame"),
      ),
    );
    const role: Role = item.kind === "sheet" ? "sheet" : framing ? "frame" : "wide";
    return [
      {
        role,
        ...SLOT[role],
        parts: cut.map(({ part }) => part.label),
        inUse: () => true,
        stock: (now) => asStock(stockIn(now)(item.id, item.kind)),
        set: (now, stock) => ({
          ...now,
          stock: now.stock.map((each) =>
            each.id === item.id
              ? ({ ...stock, kind: item.kind, id: item.id } as RecipeStock)
              : each,
          ),
        }),
      },
    ];
  });

/** Every size nobody measured or read from a maker, by where it is: "top.overhang". */
const assumedIn = (recipe: BuildRecipe) =>
  assumedSizes({
    ...recipe.size,
    kerf: recipe.kerf,
    ...Object.fromEntries(
      [...recipe.stock, ...recipe.pieces, ...recipe.groups].map((item) => [item.id, item]),
    ),
    ...Object.fromEntries(recipe.joints.map((joint) => [joint.joins.join("-"), joint])),
  });

/** A recipe's Build but its options, and its slots: or why it can't be worked out. */
const recipeBuild = (
  recipe: BuildRecipe,
  have: readonly string[],
): Result<{ build: Omit<Build, "options">; slots: Slot<BuildRecipe>[] }, string[]> => {
  const layout = layoutOf(recipe);
  if (!layout.ok) return layout;
  const labelled = lettered(recipe, layout.value.placed);
  const parts = labelled.map(({ part }) => part);
  const slots = slotsOf(recipe, labelled);
  const partOf = (from: string) => labelled.find(({ piece }) => piece.from === from)?.part;
  const of = stockIn(recipe);
  const castorOf = (id: string) => of(id, "castor");

  const cut = recipe.stock.filter(isCut);
  const timbers = cut.filter((item) => item.kind === "timber").map(asStock);
  const sheets = cut.filter((item) => item.kind === "sheet").map(asStock);
  // Stock the owner has that no piece is cut from stands in for a stock it will do for, first.
  const used = new Set(layout.value.placed.map((piece) => piece.stock));
  const spares: Spares = new Map(
    cut
      .filter((item) => used.has(item.id))
      .map((item) => [
        item.name,
        cut.flatMap((had) =>
          !used.has(had.id) &&
          had.have !== undefined &&
          had.kind === item.kind &&
          standsInFor(asStock(had), asStock(item), item.kind)
            ? [{ stock: asStock(had), count: had.have }]
            : [],
        ),
      ]),
  );
  const planned = cutPlanOf({ parts, timbers, sheets, kerf: recipe.kerf.value, spares });
  const fixings = fixingsOf({ recipe, layout: layout.value, name: words, have });
  if (!fixings.ok) return fixings;

  // What's had of a stock is bought less: none of a spare, the rest of what pieces are cut from.
  const had = new Map(cut.flatMap((item) => (item.have ? [[item.name, item.have] as const] : [])));
  const priceOf = (stock: string) => cut.find((item) => item.name === stock)?.price;
  const stockBought = stockLines({
    cutPlan: planned.cutPlan,
    timbers,
    sheets,
    names: new Map(parts.map((part) => [part.label, part.name])),
  }).map((line): BuyLine => {
    const owned = line.stock === undefined ? undefined : had.get(line.stock);
    if (owned === undefined || line.stock === undefined) return line;
    return buyLine({
      item: line.item,
      kind: line.kind,
      stock: line.stock,
      for: line.for,
      needed: Math.max(0, line.needed - owned),
      price: priceOf(line.stock),
    });
  });
  const fitted: Fitted[] = layout.value.fitted.map((each) => ({
    name: castorOf(each.stock).name,
    on: partOf(each.under)?.label ?? "",
    boxes: each.boxes,
  }));
  const buyList = buyListOf([
    ...stockBought,
    ...layout.value.fitted.map((each) =>
      buyLine({
        item: castorOf(each.stock).name,
        kind: "fitted",
        for: `under the ${said(partOf(each.under)?.name ?? words(each.under))}`,
        needed: each.boxes.length,
        price: castorOf(each.stock).price,
      }),
    ),
    ...fixings.value.map((each) => {
      const line = buyLine({
        item: each.name,
        kind: "fixing",
        for: each.for.join(", "),
        needed: each.count,
        price: each.price,
      });
      return each.length ? { ...line, length: each.length } : line;
    }),
  ]);

  const assumed = assumedIn(recipe);
  const boxes = [...parts, ...fitted].flatMap((each) => each.boxes);
  const most = (end: (box: (typeof boxes)[number]) => number) =>
    Math.round(Math.max(...boxes.map(end)) * 10) / 10;
  return ok({
    slots,
    build: {
      template: "recipe",
      size: {
        length: most((box) => box.x + box.w),
        depth: most((box) => box.y + box.d),
        height: most((box) => box.z + box.h),
      },
      parts,
      fitted,
      cutPlan: planned.cutPlan,
      buyList,
      bag: bagOf(buyList),
      steps: [],
      glossary: [],
      findings: [
        ...planned.findings,
        ...wrongStock({ parameters: recipe, slots, damp: recipe.damp, build: { parts } }),
        ...(assumed ? [assumed] : []),
      ],
      print: null,
    },
  });
};

/**
 * Any checked recipe worked out: its Build, with each timber's and sheet's options, or why it
 * can't be. Bolts the owner has (`have`, their Things' names) too short are said (#763).
 */
export const workOutRecipe = (
  recipe: BuildRecipe,
  have: readonly string[] = [],
): Result<Build, string[]> => {
  const worked = recipeBuild(recipe, have);
  if (!worked.ok) return worked;
  const { build, slots } = worked.value;
  return ok({
    ...build,
    options: stockOptions({
      parameters: recipe,
      slots,
      prices: recipe.prices,
      damp: recipe.damp,
      build,
      derive: (swapped) => {
        const again = recipeBuild(swapped, have);
        return again.ok ? ok(again.value.build) : again;
      },
    }),
  });
};

/**
 * A recipe with one of its stocks (by name, as its buy list gives it) swapped for an option (#704),
 * its price and size from the recipe's options' prices; or why not.
 */
export const pickRecipeStock = (
  input: unknown,
  pick: { stock: string; option: string },
): Result<BuildRecipe, string[]> => {
  const parsed = BuildRecipe.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues.map((issue) => issue.message));
  const worked = recipeBuild(parsed.data, []);
  if (!worked.ok) return worked;
  return pickStock({
    parameters: parsed.data,
    slots: worked.value.slots,
    prices: (recipe) => recipe.prices,
    setPrices: (recipe, prices) => ({ ...recipe, prices }),
    pick,
  });
};
