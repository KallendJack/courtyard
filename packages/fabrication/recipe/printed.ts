import {
  type BuildRecipe,
  type PartRecipe,
  type PartScrew,
  PrinterSpec,
  type RecipePiece,
  type SourcedSize,
} from "@courtyard/contract";
import {
  type Box,
  type BuildPrint,
  type BuyLine,
  err,
  type Finding,
  ok,
  type Part,
  type PrintLine,
  type Result,
  type Step,
} from "../build.ts";
import { buyLine } from "../buy-list.ts";
import { fitsPlate, toolsOf } from "../print/index.ts";
import { checkRecipe, envelopeOf } from "../print/recipe.ts";
import { box } from "./geometry.ts";
import { type Placed, said, stockIn, words } from "./layout.ts";

// Printed parts in a wooden build (#773): a holder a timber's end drops into, or a bracket a
// timber's or sheet's edge runs along, each a piece the recipe names by which part, the stock it
// fits and where it goes. Code sizes it from that stock, with the printer's clearance, so changing
// the timber resizes it; makes it a part recipe for the printed-part pipeline (#702); and says to
// print it first and fit it once what it goes on is built.

type Printed = Extract<RecipePiece, { kind: "printed" }>;

/** What a printed piece is in a build: its part, with its print, and its screws for the buy list. */
export type PrintedPart = {
  readonly part: Part;
  readonly piece: Printed;
  /** Its screws, by name, and how many for all of them, when it's screwed. */
  readonly screws: { readonly name: string; readonly count: number } | undefined;
  readonly findings: readonly Finding[];
};

/** The sizes a holder or bracket is given, mm: chosen, so they have no source. */
const WALLS = 4;
const FLOOR = 4;
/** How far a timber's end drops into a holder. */
const HOLDER_DEPTH = 30;
/** How far an edge sits in a bracket's slot, and the bracket's length along it. */
const SLOT_DEPTH = 15;
const BRACKET_LENGTH = 40;
/** Screws through each one's floor. */
const SCREWS_EACH = 2;

const FILAMENT = "PLA filament, 1 kg reel";

const round = (mm: number) => Math.round(mm * 100) / 100;
const mm = (value: number) => `${round(value)} mm`;
const chosen = (name: string, value: number): PrintLine => ({
  name,
  says: mm(value),
  source: null,
});

/** A screw's shank from its name as bought: "4 × 30 screws" is 4 mm. */
const screwOf = (name: string): PartScrew | undefined => {
  const size = /(\d+(?:\.\d+)?)\s*[×x]\s*\d+/.exec(name)?.[1];
  if (size === undefined) return undefined;
  return {
    name,
    diameter: { value: Number(size), unit: "mm", source: { kind: "specified", reference: name } },
  };
};

/** Its shape: a box with a pocket the stock fits in, and screw holes through its floor. */
const shapeOf = (
  piece: Printed,
  fits: { name: string; thickness: SourcedSize; width: SourcedSize; kind: "timber" | "sheet" },
  clearance: number,
  screw: PartScrew | undefined,
): { recipe: PartRecipe; lines: PrintLine[] } => {
  const c = clearance;
  const thick = fits.thickness.value;
  // A holder takes the timber's whole end; a bracket's slot takes its edge, and runs out both ends.
  const holder = piece.part === "holder";
  const across = holder ? fits.width.value + 2 * c + 2 * WALLS : BRACKET_LENGTH;
  const back = thick + 2 * c + 2 * WALLS;
  const deep = holder ? HOLDER_DEPTH : SLOT_DEPTH;
  const height = deep + c + FLOOR;
  const holes = screw
    ? [1, 3].map((quarter) => ({
        kind: "hole",
        face: "top",
        at: { u: (across * quarter) / 4, v: back / 2 },
        screw,
        countersunk: true,
      }))
    : [];
  return {
    recipe: {
      base: { kind: "box", width: across, depth: back, height },
      features: [
        {
          kind: "pocket",
          face: "top",
          object: {
            name: fits.name,
            width: holder
              ? fits.width
              : { value: BRACKET_LENGTH, unit: "mm", source: { kind: "assumed" } },
            height: fits.thickness,
            depth: { value: deep, unit: "mm", source: { kind: "assumed" } },
          },
          open: holder ? [] : ["left", "right"],
        },
        ...holes,
      ],
    },
    lines: [
      holder
        ? {
            name: "Pocket",
            says: `${round(thick + 2 * c)} × ${mm(fits.width.value + 2 * c)}`,
            source: fits.width.source,
          }
        : { name: "Slot", says: mm(thick + 2 * c), source: fits.thickness.source },
      chosen(holder ? "Pocket depth" : "Slot depth", deep),
      chosen("Walls", WALLS),
      ...(screw
        ? [
            {
              name: "Screw holes",
              says: `${SCREWS_EACH} × ${mm(screw.diameter.value)}, countersunk`,
              source: screw.diameter.source,
            },
          ]
        : []),
    ],
  };
};

/** Where each one sits: on top of what it's on, at its ends in turn. */
const boxesOn = (on: readonly Box[], count: number, size: Part) => {
  const ends = on.flatMap((each) =>
    each.w >= each.d
      ? [each.x, each.x + each.w - size.length].map((x) =>
          box(
            x,
            each.y + (each.d - size.width) / 2,
            each.z + each.h,
            size.length,
            size.width,
            size.thickness,
          ),
        )
      : [each.y, each.y + each.d - size.length].map((y) =>
          box(
            each.x + (each.w - size.width) / 2,
            y,
            each.z + each.h,
            size.width,
            size.length,
            size.thickness,
          ),
        ),
  );
  return ends.slice(0, count);
};

/**
 * Each printed piece as a part, lettered after the parts that are cut, with its print; or why one
 * can't be.
 */
export const printedParts = (
  recipe: BuildRecipe,
  placed: readonly Placed[],
  firstLetter: (at: number) => string,
): Result<PrintedPart[], string[]> => {
  const of = stockIn(recipe);
  const printer = recipe.printer ?? PrinterSpec.parse({});
  const clearance = printer.clearance.value;
  const pieces = recipe.pieces.filter((piece): piece is Printed => piece.kind === "printed");
  const problems: string[] = [];
  const made = pieces.flatMap((piece, index): PrintedPart[] => {
    const at = `pieces.${recipe.pieces.indexOf(piece)}`;
    const screws = piece.screws === undefined ? undefined : of(piece.screws, "fixing");
    const screw = screws && screwOf(screws.name);
    if (screws && !screw) {
      problems.push(
        `${at}.screws: Say the screws' size in their name, as "4 × 30 screws", so the holes fit them.`,
      );
      return [];
    }
    const stock = recipe.stock.find((item) => item.id === piece.fits);
    if (stock?.kind !== "timber" && stock?.kind !== "sheet") {
      throw new Error(`The recipe was checked: "${piece.fits}" is a timber or sheet.`);
    }
    const shaped = shapeOf(piece, stock, clearance, screw);
    const checked = checkRecipe(shaped.recipe, printer);
    const size = envelopeOf({ base: shaped.recipe.base, features: checked.recipe?.features ?? [] });
    const print: BuildPrint = {
      plate: printer.plate,
      fits: fitsPlate(size, printer.plate),
      clearance: printer.clearance,
      nozzle: printer.nozzle,
      sizes: shaped.lines,
      recipe: checked.recipe,
    };
    const name = words(piece.id);
    const sized = {
      label: firstLetter(index),
      name,
      does:
        piece.part === "holder"
          ? `On the ${said(words(piece.on))}: the ${stock.name}'s end drops into it.`
          : `On the ${said(words(piece.on))}: the ${stock.name}'s edge sits in its slot.`,
      count: piece.count,
      material: { kind: "printed", stock: FILAMENT },
      length: size.length,
      width: size.depth,
      thickness: size.height,
      boxes: [],
      print,
    } satisfies Part;
    const on = placed.filter((each) => each.from === piece.on).flatMap((each) => each.boxes);
    return [
      {
        piece,
        part: { ...sized, boxes: boxesOn(on, piece.count, sized) },
        screws: screws && { name: screws.name, count: SCREWS_EACH * piece.count },
        findings: [
          ...checked.findings,
          ...(print.fits
            ? []
            : [{ kind: "too-big-for-plate", size, plate: printer.plate } as const]),
        ],
      },
    ];
  });
  return problems.length > 0 ? err(problems) : ok(made);
};

/** The filament for them all, and the screws through them. */
export const printedBuys = (printed: readonly PrintedPart[], recipe: BuildRecipe): BuyLine[] => {
  if (printed.length === 0) return [];
  const priceOf = (name: string) =>
    recipe.stock.find((item) => item.kind === "fixing" && item.name === name)?.price;
  const screws = new Map<string, { count: number; for: string[] }>();
  for (const { part, screws: each } of printed) {
    if (each === undefined) continue;
    const there = screws.get(each.name) ?? { count: 0, for: [] };
    screws.set(each.name, {
      count: there.count + each.count,
      for: [...there.for, said(part.name)],
    });
  }
  return [
    buyLine({
      item: FILAMENT,
      kind: "filament",
      for: `printing the ${printed.map(({ part }) => said(part.name)).join(" and ")}`,
      needed: 1,
      price: undefined,
    }),
    ...[...screws].map(([item, each]) =>
      buyLine({
        item,
        kind: "fixing",
        for: `fixing the ${each.for.join(" and ")}`,
        needed: each.count,
        price: priceOf(item),
      }),
    ),
  ];
};

const quiet = {
  helper: false,
  ways: [],
  wayChanged: null,
  tips: [],
  closeUps: [],
  techniques: [],
  walkThrough: [],
  scene: null,
} as const;

/**
 * Print each first, all on one plate; fit each once what it goes on is built: the stock tried in it,
 * and screwed when it's screwed. The steps for the rest come with the assembly order (#772).
 */
export const printedSteps = (
  printed: readonly PrintedPart[],
  recipe: BuildRecipe,
): Omit<Step, "number">[] => {
  const toHand = new Set(recipe.tools);
  const stockName = (id: string) => recipe.stock.find((item) => item.id === id)?.name ?? id;
  const prints = printed.map(
    ({ part, piece }): Omit<Step, "number"> => ({
      ...quiet,
      id: `print-${piece.id}`,
      title: `Print the ${said(part.name)}`,
      minutes: 10,
      parts: [part.label],
      adds: [],
      tools: [],
      safety: [],
      fixings: [],
      batch: part.count === 1 ? "In one go." : "All on one plate, in one go.",
      actions: [
        {
          howTo:
            "Open its 3MF file in Bambu Studio. The part is already set out on the plate the way up it prints: slice it, and send it to the printer.",
          numbers: `${part.count} × in ${part.material.stock}.`,
        },
        {
          howTo: "Let the plate cool before you flex the parts off it, so they don't bend.",
          numbers: "Cool, then off.",
        },
      ],
      check: {
        says: `The ${stockName(piece.fits)} goes into each by hand, without forcing, and doesn't rattle.`,
        photo: `The ${stockName(piece.fits)} in one`,
      },
      words: ["slice"],
    }),
  );
  const fits = printed.map(
    ({ part, piece, screws }): Omit<Step, "number"> => ({
      ...quiet,
      id: `fit-${piece.id}`,
      title: `Fit the ${said(part.name)}`,
      minutes: screws ? 5 * part.count : 2,
      parts: [part.label],
      adds: [part.label],
      tools: screws ? toolsOf(["pencil", "drill-driver", "drill-bits"], toHand) : [],
      safety: screws ? toolsOf(["safety-glasses"], toHand) : [],
      fixings: screws ? [screws] : [],
      batch: screws
        ? "Mark every hole first, then drill and screw them one at a time."
        : "One at a time.",
      actions: [
        {
          howTo: `Stand each on the ${said(words(piece.on))} where the ${stockName(piece.fits)} goes${screws ? ", and mark through its holes with a pencil" : ""}.`,
          numbers: `${part.count} × on the ${said(words(piece.on))}.`,
        },
        ...(screws
          ? [
              {
                howTo:
                  "Drill a pilot hole at each mark, then drive the screws until their heads sit flush, and no further: plastic cracks if a screw's forced.",
                numbers: `${screws.count} × ${screws.name}, flush.`,
              },
            ]
          : []),
      ],
      check: {
        says: screws
          ? "Each doesn't move when you push it, and every screw head is flush."
          : "Each sits square where it goes.",
        photo: `The ${said(part.name)} in place`,
      },
      words: screws ? ["pilot hole", "countersink"] : [],
    }),
  );
  return [...prints, ...fits];
};
