import { z } from "zod";
import { SizeSource, SourcedSize } from "../sourced/size.ts";
import { BuildStockOptions } from "./stock.ts";

// What `packages/fabrication` derives for a Build, as Fabrication shows it (#698): the engine's
// `Build` (its `build.ts`), checked here so the app parses what crosses rather than trusting it,
// and the worker's compiler checks the engine still gives it. Only what a screen reads is named.

/** A list as the engine gives it, never changed once worked out. */
const list = <T extends z.ZodType>(item: T) => z.array(item).readonly();

/** A piece's place in the 3D view, in mm: `x` along, `y` back from the front, `z` up. */
export const BuildBox = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
  d: z.number(),
  h: z.number(),
});
export type BuildBox = z.infer<typeof BuildBox>;

/** A part, once for all its pieces: its label, what it does, its cut size and its boxes. */
export const BuildPart = z.object({
  label: z.string(),
  name: z.string(),
  does: z.string(),
  count: z.number().int(),
  material: z.object({ kind: z.enum(["timber", "sheet", "printed"]), stock: z.string() }),
  length: z.number(),
  width: z.number(),
  thickness: z.number(),
  boxes: list(BuildBox),
});
export type BuildPart = z.infer<typeof BuildPart>;

/** The cut plan: each timber's lengths with their cuts, each sheet's pieces where they sit. */
export const BuildCutPlan = z.object({
  kerf: z.number(),
  timber: list(
    z.object({
      stock: z.string(),
      stockLength: z.number(),
      lengths: list(
        z.object({
          cuts: list(z.object({ label: z.string(), length: z.number() })),
          used: z.number(),
          offcut: z.number(),
        }),
      ),
    }),
  ),
  sheets: list(
    z.object({
      stock: z.string(),
      sheetLength: z.number(),
      sheetWidth: z.number(),
      sheets: list(
        z.object({
          pieces: list(
            z.object({
              label: z.string(),
              x: z.number(),
              y: z.number(),
              along: z.number(),
              across: z.number(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type BuildCutPlan = z.infer<typeof BuildCutPlan>;

export const BuildBuyLine = z.object({
  item: z.string(),
  kind: z.enum(["timber", "sheet", "fitted", "fixing", "filament"]),
  /** The timber or sheet it buys, whose options its row opens (#704). */
  stock: z.string().optional(),
  for: z.string(),
  needed: z.number(),
  packOf: z.number(),
  packs: z.number(),
  price: z
    .object({ pence: z.number(), shop: z.string().optional(), link: z.string().optional() })
    .optional(),
  total: z.number().optional(),
});
export type BuildBuyLine = z.infer<typeof BuildBuyLine>;

const StepTool = z.object({ tool: z.string(), name: z.string(), toHand: z.boolean() });

const Point = z.object({ x: z.number(), y: z.number() });

/**
 * A step's close-up (#699): a flat view of what it makes, in mm from its top left (`y` down), its
 * key sizes as dimension lines and a dot where each fixing goes.
 */
const BuildCloseUp = z.object({
  title: z.string(),
  width: z.number(),
  height: z.number(),
  pieces: list(
    z.object({ label: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  ),
  dimensions: list(z.object({ from: Point, to: Point, mm: z.number() })),
  fixings: list(Point),
  notes: list(z.string()),
});

/** A step's ID, the slug of what it does ("fit-castors"), the same whatever else a Build has. */
export const BuildStepId = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * A step, as the instruction manual shows it (#699): its parts and the ones it puts on the Build,
 * the ways it can be done, its tools and fixings, each action said for a beginner ("show me how")
 * and as just the numbers, its close-up, the check before moving on, and the words it uses.
 */
export const BuildStep = z.object({
  id: BuildStepId,
  number: z.number().int(),
  title: z.string(),
  minutes: z.number(),
  helper: z.boolean(),
  parts: list(z.string()),
  adds: list(z.string()),
  ways: list(z.object({ name: z.string(), using: z.boolean(), toHand: z.boolean() })),
  tools: list(StepTool),
  safety: list(StepTool),
  fixings: list(z.object({ name: z.string(), count: z.number() })),
  actions: list(z.object({ howTo: z.string(), numbers: z.string() })),
  closeUp: BuildCloseUp.nullable(),
  check: z.object({ says: z.string(), photo: z.string() }),
  words: list(z.string()),
});
export type BuildStep = z.infer<typeof BuildStep>;

/** What the making rules found (ADR 0036). */
export const BuildFinding = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixing-too-short"),
    fixing: z.string(),
    length: z.number(),
    needed: z.number(),
    through: list(z.object({ what: z.string(), mm: z.number() })),
    /** The length to use, which the steps fit and the buy list buys instead. */
    use: z.number(),
    /** The steps that fit it, by number. */
    steps: list(z.number().int()),
  }),
  z.object({
    kind: z.literal("tools-missing"),
    tools: list(z.object({ tool: z.string(), name: z.string(), steps: list(z.number().int()) })),
  }),
  z.object({ kind: z.literal("too-big-for-stock"), label: z.string(), stock: z.string() }),
  z.object({
    kind: z.literal("wrong-stock"),
    stock: z.string(),
    parts: list(z.string()),
    why: z.string(),
  }),
  z.object({ kind: z.literal("assumed"), sizes: list(z.string()) }),
  z.object({ kind: z.literal("cannot-make"), problems: list(z.string()) }),
  z.object({
    kind: z.literal("too-big-for-plate"),
    size: z.object({ length: z.number(), depth: z.number(), height: z.number() }),
    plate: z.object({ width: z.number(), depth: z.number(), height: z.number() }),
  }),
  z.object({
    kind: z.literal("wall-too-thin"),
    where: z.string(),
    mm: z.number(),
    least: z.number(),
  }),
]);
export type BuildFinding = z.infer<typeof BuildFinding>;

/**
 * A printed part's own (#702): the plate it's made for and whether it fits, the clearance its
 * holes and pockets allow and the nozzle, and each size the Print tab lists, with its source when
 * it's an object's (`null` for a size the owner chose, such as its walls).
 */
export const BuildPrint = z.object({
  plate: z.object({ width: z.number(), depth: z.number(), height: z.number() }),
  fits: z.boolean(),
  clearance: SourcedSize,
  nozzle: SourcedSize,
  sizes: list(z.object({ name: z.string(), says: z.string(), source: SizeSource.nullable() })),
});
export type BuildPrint = z.infer<typeof BuildPrint>;

/** Everything a Build shows, worked out from its template and parameters. */
export const DerivedBuild = z.object({
  template: z.string(),
  size: z.object({ length: z.number(), depth: z.number(), height: z.number() }),
  parts: list(BuildPart),
  fitted: list(z.object({ name: z.string(), on: z.string(), boxes: list(BuildBox) })),
  cutPlan: BuildCutPlan,
  buyList: z.object({ lines: list(BuildBuyLine), total: z.number(), unpriced: z.number() }),
  steps: list(BuildStep),
  /** The words the steps use that a beginner may not know, each with a line saying what it means. */
  glossary: list(z.object({ word: z.string(), means: z.string() })),
  findings: list(BuildFinding),
  options: list(BuildStockOptions),
  /** A printed part's own; `null` for a Build cut from timber and sheets. */
  print: BuildPrint.nullable(),
});
export type DerivedBuild = z.infer<typeof DerivedBuild>;

/**
 * A printed part as the worker made it (#702): its size and volume from the solid itself, whether
 * it's watertight (closed all round, so a slicer reads it), the filament it takes, and its
 * triangles for the 3D view, in mm with `z` up from the plate.
 */
export const MadePart = z.object({
  size: z.object({ length: z.number(), depth: z.number(), height: z.number() }),
  /** mm³. */
  volume: z.number(),
  watertight: z.boolean(),
  /** PLA's, at 100% infill: what the slicer says will be less. */
  grams: z.number(),
  mesh: z.object({
    /** x, y, z for each corner, flat. */
    positions: z.array(z.number()),
    /** Three corners for each triangle, by their place in `positions`. */
    triangles: z.array(z.number().int()),
  }),
  /** The files to print, by their names, under the Build's own path. */
  files: z.object({ threeMf: z.string(), stl: z.string() }),
});
export type MadePart = z.infer<typeof MadePart>;
