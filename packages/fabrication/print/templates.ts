import {
  PartRecipe,
  PartScrew,
  PrinterSpec,
  type SizeSource,
  SourcedSize,
} from "@courtyard/contract";
import { z } from "zod";
import type { PrintLine } from "../build.ts";
import { Price, Words } from "../stock.ts";
import { Tool } from "../tools.ts";

// The printed parts' templates (#702): the shapes the owner needs first, each a few parameters a
// model sets from what's said, made into a part recipe here. Anything else is a recipe as it's
// written (`printed-part`). Every size of something real (a battery, a castor's plate) carries
// its source; a size the owner chooses (a wall) is a plain number.

/** A size the owner chooses, mm. */
const Chosen = z.number().positive().max(500);

/** What every printed part takes besides its shape: how many, the printer, what it's printed in. */
const printed = {
  /** How many to print. */
  count: z.number().int().positive().max(50).default(1),
  printer: PrinterSpec.prefault({}),
  filament: Words.default("PLA filament, 1 kg reel"),
  /** What the buy list's things cost, by their names: the filament, a screw. */
  prices: z.record(Words, Price).default({}),
  /** The tools and kit the owner has to hand. */
  tools: z.array(Tool).default([]),
};

/** Screws through the part: which, how many, and whether their heads sit flush. */
const Screws = z.object({
  screw: PartScrew,
  count: z.number().int().min(1).max(3),
  countersunk: z.boolean().default(true),
});

/**
 * A holster: a tray the battery (or any boxy thing) slides into from the front or drops into
 * from above, walls on its sides and back, screwed to a wall through its back.
 */
export const HolsterParameters = z.object({
  /** What it holds: across, front to back, and its height. */
  holds: z.object({ name: Words, width: SourcedSize, depth: SourcedSize, height: SourcedSize }),
  walls: Chosen,
  screws: Screws.nullable().default(null),
  ...printed,
});
export type HolsterParameters = z.infer<typeof HolsterParameters>;

/** A shim: a flat plate under a castor's, its bolt holes where the castor's are. */
export const ShimParameters = z.object({
  /** The castor's plate. */
  plate: z.object({ width: SourcedSize, depth: SourcedSize }),
  /** How much it lifts the castor. */
  thickness: Chosen,
  /** The castor's bolts, and how far apart their holes are, centre to centre, each way. */
  bolts: z.object({ screw: PartScrew, across: SourcedSize, back: SourcedSize }),
  ...printed,
});
export type ShimParameters = z.infer<typeof ShimParameters>;

/** A bracket: an L, a flat leg and an upright one, with screws through each. */
export const BracketParameters = z.object({
  width: Chosen,
  /** The flat leg's length, front to back, and the upright's height. */
  flat: Chosen,
  upright: Chosen,
  thickness: Chosen,
  /** Screws through each leg. */
  screws: Screws,
  /** Rounds its four upright corners. */
  fillet: Chosen.optional(),
  ...printed,
});
export type BracketParameters = z.infer<typeof BracketParameters>;

/** Any other shape: a part recipe as it's written. */
export const PrintedPartParameters = z.object({
  /** What it is, in a few words: "Cable clip". */
  part: Words,
  recipe: PartRecipe,
  ...printed,
});
export type PrintedPartParameters = z.infer<typeof PrintedPartParameters>;

/** What every template gives: its part's name and what it does, its recipe, and its sizes. */
export type Shaped = {
  readonly part: string;
  readonly does: string;
  readonly recipe: PartRecipe;
  readonly lines: readonly PrintLine[];
  /** What a pocket holds, for the step that tries it in. */
  readonly holds?: string;
};

const mm = (value: number) => `${Math.round(value * 100) / 100} mm`;
const sourced = (name: string, size: SourcedSize): PrintLine => ({
  name,
  says: mm(size.value),
  source: size.source,
});
const chosen = (name: string, value: number): PrintLine => ({
  name,
  says: mm(value),
  source: null,
});
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Screw holes in a line: "2 × 4 mm, countersunk". */
const screwLine = (count: number, screw: PartScrew, countersunk: boolean): PrintLine => ({
  name: "Screw holes",
  says: `${count} × ${mm(screw.diameter.value)}${countersunk ? ", countersunk" : ""}`,
  source: screw.diameter.source,
});

/** Spread `count` along `length`: one in the middle, or evenly with a quarter of it at each end. */
const spread = (count: number, length: number) =>
  count === 1
    ? [length / 2]
    : Array.from({ length: count }, (_, index) => length / 4 + (index * length) / 2 / (count - 1));

export const holsterShape = (p: HolsterParameters): Shaped => {
  const c = p.printer.clearance.value;
  const { holds } = p;
  const width = holds.width.value + 2 * c + 2 * p.walls;
  const depth = holds.depth.value + c + p.walls;
  const height = holds.height.value + c + p.walls;
  const pocketBack = depth - p.walls;
  const screws = p.screws;
  return {
    part: "Holster",
    does: `Holds the ${holds.name}, which slides in from the front.`,
    holds: holds.name,
    recipe: {
      base: { kind: "box", width, depth, height },
      features: [
        {
          kind: "pocket",
          face: "top",
          object: {
            name: holds.name,
            width: holds.width,
            height: holds.depth,
            depth: holds.height,
          },
          at: { u: width / 2, v: pocketBack - (holds.depth.value + 2 * c) / 2 },
          open: ["down"],
        },
        // Through the back wall, from inside the tray, so the heads sit flush where it holds.
        ...(screws === null
          ? []
          : spread(screws.count, width).map((u) => ({
              kind: "hole",
              face: "front",
              at: { u, v: p.walls + (height - p.walls) / 2 },
              screw: screws.screw,
              countersunk: screws.countersunk,
            }))),
      ],
    },
    lines: [
      sourced(`${capital(holds.name)} width`, holds.width),
      sourced(`${capital(holds.name)} depth`, holds.depth),
      sourced(`${capital(holds.name)} height`, holds.height),
      chosen("Walls", p.walls),
      ...(screws === null ? [] : [screwLine(screws.count, screws.screw, screws.countersunk)]),
    ],
  };
};

export const shimShape = (p: ShimParameters): Shaped => {
  const width = p.plate.width.value;
  const depth = p.plate.depth.value;
  const { across, back, screw } = p.bolts;
  return {
    part: "Shim",
    does: `Lifts the castor ${mm(p.thickness)}, under its plate, on its own bolts.`,
    recipe: {
      base: { kind: "plate", width, depth, thickness: p.thickness },
      features: [-1, 1].flatMap((u) =>
        [-1, 1].map((v) => ({
          kind: "hole",
          face: "top",
          at: { u: width / 2 + (u * across.value) / 2, v: depth / 2 + (v * back.value) / 2 },
          screw,
          countersunk: false,
        })),
      ),
    },
    lines: [
      sourced("Castor plate width", p.plate.width),
      sourced("Castor plate depth", p.plate.depth),
      sourced("Bolt holes apart, across", across),
      sourced("Bolt holes apart, front to back", back),
      chosen("Thickness", p.thickness),
      screwLine(4, screw, false),
    ],
  };
};

export const bracketShape = (p: BracketParameters): Shaped => {
  const { screws } = p;
  const hole = (face: "top" | "front", v: number) =>
    spread(screws.count, p.width).map((u) => ({
      kind: "hole",
      face,
      at: { u, v },
      screw: screws.screw,
      countersunk: screws.countersunk,
    }));
  return {
    part: "Bracket",
    does: "Joins two faces at a right angle.",
    recipe: {
      base: {
        kind: "l-bracket",
        width: p.width,
        depth: p.flat,
        height: p.upright,
        thickness: p.thickness,
      },
      features: [
        ...(p.fillet === undefined ? [] : [{ kind: "fillet", radius: p.fillet }]),
        ...hole("top", (p.flat - p.thickness) / 2),
        ...hole("front", p.thickness + (p.upright - p.thickness) / 2),
      ],
    },
    lines: [
      chosen("Width", p.width),
      chosen("Flat leg", p.flat),
      chosen("Upright leg", p.upright),
      chosen("Thickness", p.thickness),
      screwLine(screws.count * 2, screws.screw, screws.countersunk),
    ],
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A sourced size in a feature as written, when it is one. */
const sizeIn = (value: unknown) => {
  const size = SourcedSize.safeParse(value);
  return size.success ? size.data : undefined;
};

/** A recipe's own sizes: each pocket's object, each way, and its screws. */
export const printedPartShape = (p: PrintedPartParameters): Shaped => {
  const lines: PrintLine[] = [];
  let holds: string | undefined;
  for (const feature of p.recipe.features) {
    if (feature.kind === "pocket" && isRecord(feature.object)) {
      const name = typeof feature.object.name === "string" ? feature.object.name : "object";
      holds ??= name;
      for (const way of ["width", "height", "depth"] as const) {
        const size = sizeIn(feature.object[way]);
        if (size) lines.push(sourced(`${capital(name)} ${way}`, size));
      }
    }
    if ((feature.kind === "hole" || feature.kind === "slot") && isRecord(feature.screw)) {
      const size = sizeIn(feature.screw.diameter);
      const name = typeof feature.screw.name === "string" ? feature.screw.name : "screw";
      if (size && !lines.some((line) => line.name === capital(name))) {
        lines.push(sourced(capital(name), size));
      }
    }
  }
  return {
    part: p.part,
    does: capital(p.part),
    recipe: p.recipe,
    lines,
    ...(holds === undefined ? {} : { holds }),
  };
};

/** Where a size came from, as words for a finding. */
export const isAssumed = (source: SizeSource | null) => source?.kind === "assumed";
