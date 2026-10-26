import { BuildRecipe, type RecipeJoint, type RecipeStock } from "@courtyard/contract";
import type { z } from "zod";
import type { BenchParameters } from "../bench/parameters.ts";
import { err, ok, type Result } from "../build.ts";

// The framed bench as a recipe (#769): its starter writes one from the bench's parameters, and a
// recipe that is a framed bench is read back into them, so the bench's own code works it out to
// exactly the template's numbers. Any other recipe waits for #770–#772.

/** A recipe as written, before its defaults are filled in. */
export type RecipeInput = z.input<typeof BuildRecipe>;
type StockInput = RecipeInput["stock"][number];
type GroupInput = NonNullable<RecipeInput["groups"]>[number];
type PieceInput = NonNullable<RecipeInput["pieces"]>[number];
type JointInput = NonNullable<RecipeInput["joints"]>[number];

/** Each piece and group a framed bench has, by the ID its starter gives it. */
const ROLES = [
  "legs",
  "end-frames",
  "long-rails",
  "shelf",
  "braces",
  "top",
  "top-support",
  "shelf-support",
  "castor-bases",
] as const;
type Role = (typeof ROLES)[number];

/** A stock's ID from its name: "45 × 95 C16" is `45-95-c16`. */
const idFrom = (name: string, kind: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "") || kind;

/** A value as JSON with its keys in order, so two the same are the same whatever their order. */
const sameAs = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

/** A stock without its ID: what it is, whatever the recipe calls it. */
const contentOf = ({ id: _id, ...stock }: RecipeStock | StockInput) => sameAs(stock);

/**
 * The bench's recipe, as its starter writes it: one stock for each timber, sheet and fixing it
 * uses (the same one once, however many jobs it does), and its pieces, groups and joints.
 */
export const benchRecipe = (p: BenchParameters): RecipeInput => {
  const stock: StockInput[] = [];
  const add = (item: StockInput) => {
    const same = stock.find((there) => contentOf(there) === contentOf(item));
    if (same) return same.id;
    const base = idFrom(item.name, item.kind);
    let id = base;
    for (let n = 2; stock.some((there) => there.id === id); n++) id = `${base}-${n}`;
    stock.push({ ...item, id });
    return id;
  };
  const frame = add({ kind: "timber", id: "", ...p.frame.timber });
  const wide = add({ kind: "timber", id: "", ...p.frame.wide });
  const top = add({ kind: "sheet", id: "", ...p.top.sheet });
  const shelf = p.shelf.on ? add({ kind: "sheet", id: "", ...p.shelf.sheet }) : null;
  const braced = p.braces.rear || p.braces.ends;
  const braces = braced ? add({ kind: "sheet", id: "", ...p.braces.sheet }) : null;
  const frameScrews = add({ kind: "fixing", id: "", ...p.fixings.frameScrews });
  const sheetScrews = add({ kind: "fixing", id: "", ...p.fixings.sheetScrews });
  const brackets = add({ kind: "fixing", id: "", ...p.fixings.brackets });
  const bracketScrews = p.fixings.bracketScrews
    ? add({ kind: "fixing", id: "", ...p.fixings.bracketScrews })
    : undefined;
  const castors = p.castors;
  const castor = castors
    ? add({
        kind: "castor",
        id: "",
        name: castors.name,
        height: castors.height,
        price: castors.price,
        plate: castors.plate,
      })
    : null;
  const bracket = (joins: [Role, Role]): JointInput => ({
    kind: "bracket",
    joins,
    fixing: brackets,
    ...(bracketScrews ? { screws: bracketScrews } : {}),
  });

  const groups: GroupInput[] = [
    { kind: "legs", id: "legs", stock: frame, at: p.frame.legs },
    {
      kind: "frame",
      id: "end-frames",
      stock: frame,
      legs: "legs",
      sides: "ends",
      lower: p.shelf.height,
    },
    {
      kind: "frame",
      id: "long-rails",
      stock: frame,
      legs: "legs",
      sides: "front-and-back",
      lower: p.shelf.height,
    },
  ];
  const pieces: PieceInput[] = [
    { kind: "panel", id: "top", stock: top, place: "top", overhang: p.top.overhang },
    { kind: "member", id: "top-support", stock: wide, place: "across-the-middle", under: "top" },
  ];
  const joints: JointInput[] = [
    { kind: "screwed", joins: ["legs", "end-frames"], fixing: frameScrews },
    { kind: "screwed", joins: ["end-frames", "long-rails"], fixing: frameScrews },
  ];
  if (castors && castor) {
    pieces.push({
      kind: "member",
      id: "castor-bases",
      stock: wide,
      place: "under-each-end",
      under: "end-frames",
    });
    joints.push(bracket(["legs", "castor-bases"]), {
      kind: "bolted",
      piece: "castor-bases",
      fits: castor,
      at: "each-end",
      each: castors.boltsEach,
      bolt: castors.bolt,
      washer: castors.washer,
      nut: castors.nut,
    });
  }
  joints.push(bracket(["top-support", "long-rails"]));
  if (shelf) {
    groups.push({ kind: "shelf", id: "shelf", stock: shelf, on: "long-rails", rests: "rails" });
    pieces.push({
      kind: "member",
      id: "shelf-support",
      stock: frame,
      place: "across-the-middle",
      under: "shelf",
    });
    joints.push(bracket(["shelf-support", "long-rails"]), {
      kind: "sheet-screwed",
      joins: ["shelf", "long-rails"],
      fixing: sheetScrews,
    });
  }
  if (braces) {
    groups.push({
      kind: "brace",
      id: "braces",
      stock: braces,
      on: "end-frames",
      sides: [
        ...(p.braces.rear ? (["back"] as const) : []),
        ...(p.braces.ends ? (["ends"] as const) : []),
      ],
    });
    joints.push({ kind: "sheet-screwed", joins: ["braces", "end-frames"], fixing: sheetScrews });
  }
  joints.push({ kind: "sheet-screwed", joins: ["top", "long-rails"], fixing: sheetScrews });

  return {
    size: { length: p.length, depth: p.depth, height: p.height },
    kerf: p.kerf,
    stock,
    groups,
    pieces,
    joints,
    damp: p.damp,
    prices: p.prices,
    tools: p.tools,
  };
};

/** What the vocabulary has that a framed bench never does, said as "a box (crate)". */
const notInABench = (recipe: BuildRecipe): string[] => [
  ...recipe.groups.flatMap((group) =>
    group.kind === "box"
      ? [`a box (${group.id})`]
      : group.kind === "shelf" && group.rests === "cleats"
        ? [`a shelf on cleats (${group.id})`]
        : [],
  ),
  ...recipe.pieces.flatMap((piece) =>
    piece.kind === "printed" ? [`a printed part (${piece.id})`] : [],
  ),
  ...recipe.joints.flatMap((joint) =>
    joint.kind === "printed" ? [`a printed joint (${joint.joins.join(" to ")})`] : [],
  ),
];

/**
 * A recipe as what it is, whatever its IDs: each stock it points at by what that stock is, and
 * each piece and group by its role in a bench, so a recipe is a bench's when it says the same.
 */
const shapeOf = (recipe: BuildRecipe, roleOf: ReadonlyMap<string, Role>) => {
  const stockOf = new Map(recipe.stock.map((stock) => [stock.id, contentOf(stock)]));
  const ref = (id: string) => roleOf.get(id) ?? `not a bench's: ${id}`;
  const stuff = (id: string) => stockOf.get(id) ?? id;
  const joint = (joint: RecipeJoint) =>
    joint.kind === "bolted"
      ? { ...joint, piece: ref(joint.piece), fits: stuff(joint.fits) }
      : {
          ...joint,
          joins: joint.joins.map(ref).sort(),
          ...(joint.fixing === undefined ? {} : { fixing: stuff(joint.fixing) }),
          ...(joint.kind === "bracket" && joint.screws !== undefined
            ? { screws: stuff(joint.screws) }
            : {}),
        };
  const sorted = (items: unknown[]) => items.map(sameAs).sort();
  return sameAs({
    size: recipe.size,
    kerf: recipe.kerf,
    groups: sorted(
      recipe.groups.map((group) => ({
        ...group,
        id: ref(group.id),
        stock: stuff(group.stock),
        ...("legs" in group ? { legs: ref(group.legs) } : {}),
        ...("on" in group ? { on: ref(group.on) } : {}),
        ...("sides" in group && Array.isArray(group.sides)
          ? { sides: [...group.sides].sort() }
          : {}),
      })),
    ),
    pieces: sorted(
      recipe.pieces.map((piece) => ({
        ...piece,
        id: ref(piece.id),
        ...("stock" in piece ? { stock: stuff(piece.stock) } : {}),
        ...("under" in piece ? { under: ref(piece.under) } : {}),
      })),
    ),
    joints: sorted(recipe.joints.map(joint)),
    damp: recipe.damp,
    prices: recipe.prices,
    tools: recipe.tools,
  });
};

/** Why a recipe isn't one worked out yet, as the one finding it's refused with. */
const notYet = (why: string) =>
  err([`recipe: Only a framed bench's recipe can be worked out so far, and this ${why}.`]);

/**
 * A checked recipe read back into the bench's parameters, when it's a framed bench's: its legs,
 * end frames and long rails, its top and the support under it, and whichever of the shelf, braces
 * and castor bases it has, joined as the bench's starter joins them. Anything else is refused.
 */
export const benchFromRecipe = (recipe: BuildRecipe): Result<BenchParameters, string[]> => {
  const others = notInABench(recipe);
  if (others.length > 0) return notYet(`has ${others.join(", ")}`);

  const stockOf = new Map(recipe.stock.map((stock) => [stock.id, stock]));
  const strip = <T extends RecipeStock>({ kind: _kind, id: _id, ...rest }: T) => rest;
  const timberAt = (id: string) => {
    const found = stockOf.get(id);
    return found?.kind === "timber" ? strip(found) : undefined;
  };
  const sheetAt = (id: string) => {
    const found = stockOf.get(id);
    return found?.kind === "sheet" ? strip(found) : undefined;
  };
  const fixingAt = (id: string) => {
    const found = stockOf.get(id);
    return found?.kind === "fixing" ? strip(found) : undefined;
  };
  const castorAt = (id: string) => {
    const found = stockOf.get(id);
    return found?.kind === "castor" ? strip(found) : undefined;
  };
  const roleOf = new Map<string, Role>();
  const legs = recipe.groups.find((group) => group.kind === "legs");
  const frames = recipe.groups.filter((group) => group.kind === "frame");
  const ends = frames.find((frame) => frame.sides === "ends");
  const long = frames.find((frame) => frame.sides === "front-and-back");
  const top = recipe.pieces.find((piece) => piece.kind === "panel");
  const shelf = recipe.groups.find((group) => group.kind === "shelf");
  const brace = recipe.groups.find((group) => group.kind === "brace");
  const members = recipe.pieces.filter((piece) => piece.kind === "member");
  const topSupport = members.find(
    (member) => member.place === "across-the-middle" && member.under === top?.id,
  );
  const shelfSupport = members.find(
    (member) => member.place === "across-the-middle" && member.under === shelf?.id,
  );
  const bases = members.find(
    (member) => member.place === "under-each-end" && member.under === ends?.id,
  );
  const found: [Role, { id: string } | undefined][] = [
    ["legs", legs],
    ["end-frames", ends],
    ["long-rails", long],
    ["shelf", shelf],
    ["braces", brace],
    ["top", top],
    ["top-support", topSupport],
    ["shelf-support", shelfSupport],
    ["castor-bases", bases],
  ];
  for (const [role, item] of found) if (item) roleOf.set(item.id, role);

  const timber = legs && timberAt(legs.stock);
  const sheet = top && sheetAt(top.stock);
  const wide = topSupport && timberAt(topSupport.stock);
  if (!legs || !timber) return notYet("has no timber legs at its corners");
  if (!ends || !long) return notYet("has no end frames and long rails joining its legs");
  if (!top || !sheet) return notYet("has no top");
  if (!wide) return notYet("has no timber support across the middle under its top");

  const fixingOf = (kind: RecipeJoint["kind"]) => {
    const joint = recipe.joints.find((joint) => joint.kind === kind);
    return joint && "fixing" in joint && joint.fixing !== undefined
      ? fixingAt(joint.fixing)
      : undefined;
  };
  const frameScrews = fixingOf("screwed");
  const sheetScrews = fixingOf("sheet-screwed");
  const bracketJoint = recipe.joints.find((joint) => joint.kind === "bracket");
  const brackets = fixingOf("bracket");
  if (!frameScrews || !sheetScrews || !brackets || bracketJoint?.kind !== "bracket") {
    return notYet("isn't screwed, bracketed and sheet-screwed as a bench is");
  }
  const bracketScrews =
    bracketJoint.screws === undefined ? undefined : fixingAt(bracketJoint.screws);
  const bolted = recipe.joints.find((joint) => joint.kind === "bolted");
  const castor = bolted?.kind === "bolted" ? castorAt(bolted.fits) : undefined;

  const parameters: BenchParameters = {
    length: recipe.size.length,
    depth: recipe.size.depth,
    height: recipe.size.height,
    kerf: recipe.kerf,
    top: { sheet, overhang: top.overhang },
    frame: { legs: legs.at, timber, wide },
    shelf: {
      on: shelf !== undefined,
      height: ends.lower,
      sheet: (shelf && sheetAt(shelf.stock)) ?? sheet,
    },
    braces: {
      rear: brace?.sides.includes("back") ?? false,
      ends: brace?.sides.includes("ends") ?? false,
      sheet: (brace && sheetAt(brace.stock)) ?? sheet,
    },
    castors:
      bolted?.kind === "bolted" && castor
        ? {
            ...castor,
            boltsEach: bolted.each,
            bolt: bolted.bolt,
            washer: bolted.washer,
            nut: bolted.nut,
          }
        : null,
    fixings: { frameScrews, sheetScrews, brackets, ...(bracketScrews ? { bracketScrews } : {}) },
    damp: recipe.damp,
    prices: recipe.prices,
    tools: recipe.tools,
  };
  // It's a bench's only when the bench's own starter would write it so: nothing more, nothing less.
  const starter = BuildRecipe.parse(benchRecipe(parameters));
  const asStarter = new Map(ROLES.map((role) => [role, role]));
  if (shapeOf(recipe, roleOf) !== shapeOf(starter, asStarter)) {
    return notYet("joins its pieces another way than a bench's");
  }
  return ok(parameters);
};
