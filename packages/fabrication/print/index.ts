import { type BuildTemplate, type PartFeature, PartRecipeShown } from "@courtyard/contract";
import type { z } from "zod";
import { type Build, err, type Finding, ok, type Result, type Step } from "../build.ts";
import { buyLine, buyListOf } from "../buy-list.ts";
import { toolsMissing } from "../findings.ts";
import { glossaryOf } from "../glossary.ts";
import { TOOL_NAMES, type Tool } from "../tools.ts";
import { checkRecipe, envelopeOf } from "./recipe.ts";
import {
  BracketParameters,
  bracketShape,
  HolsterParameters,
  holsterShape,
  isAssumed,
  PrintedCommon,
  PrintedPartParameters,
  printedPartShape,
  type Shaped,
  ShimParameters,
  shimShape,
} from "./templates.ts";

// A printed part's Build (#702): its template's parameters made into a recipe, checked, and
// everything the Build shows worked out from it, as a bench's is: the part, the buy list (the
// filament and any screws), the steps (print it, try it, fix it) and the findings. The solid is
// made from the recipe by `makePart`, in the worker.

type Printed = Exclude<BuildTemplate, "framed-bench">;

/** Each printed template: its parameters, and the shape it makes from them. */
const TEMPLATES = {
  "battery-holster": { parameters: HolsterParameters, shape: holsterShape },
  "castor-shim": { parameters: ShimParameters, shape: shimShape },
  bracket: { parameters: BracketParameters, shape: bracketShape },
  "printed-part": { parameters: PrintedPartParameters, shape: printedPartShape },
} as const;

const COMMON = { count: true, printer: true, filament: true, prices: true, tools: true } as const;

/**
 * A printed template's own parameters, as JSON Schema gives them to a model: what every printed
 * template also takes is `PRINTED_COMMON`, said once, and a recipe's features have their fields.
 */
export const PRINTED_PARAMETERS: Readonly<Record<Printed, z.ZodType>> = {
  "battery-holster": HolsterParameters.omit(COMMON),
  "castor-shim": ShimParameters.omit(COMMON),
  bracket: BracketParameters.omit(COMMON),
  "printed-part": PrintedPartParameters.omit(COMMON).extend({ recipe: PartRecipeShown }),
};

/** What every printed template takes besides its own, as JSON Schema gives it to a model. */
export const PRINTED_COMMON: z.ZodType = PrintedCommon;

const issues = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join(".") || "parameters"}: ${issue.message}`);

/** What every printed template takes besides its shape. */
type Common = Pick<HolsterParameters, "count" | "filament" | "prices" | "tools">;

/** The screws its holes and slots take, by name, for one part. */
const screwsOf = (features: readonly PartFeature[]) => {
  const screws = new Map<string, number>();
  for (const feature of features) {
    if (feature.kind === "hole" || feature.kind === "slot") {
      screws.set(feature.screw.name, (screws.get(feature.screw.name) ?? 0) + 1);
    }
  }
  return screws;
};

const toolsOf = (tools: readonly Tool[], toHand: ReadonlySet<Tool>) =>
  tools.map((tool) => ({ tool, name: TOOL_NAMES[tool], toHand: toHand.has(tool) }));

/** Print it, try what it holds in it, and fix it up when it has screws. */
const stepsOf = (options: {
  shaped: Shaped;
  common: Common;
  clearance: number;
  screws: ReadonlyMap<string, number>;
}): Step[] => {
  const { shaped, common, clearance, screws } = options;
  const toHand = new Set(common.tools);
  const drafts: Omit<Step, "number">[] = [
    {
      id: "print",
      title: common.count === 1 ? "Print it" : `Print ${common.count}`,
      minutes: 10,
      helper: false,
      parts: ["A"],
      adds: ["A"],
      ways: [],
      tools: [],
      safety: [],
      fixings: [],
      actions: [
        {
          howTo:
            "Open the 3MF file in Bambu Studio. The part is already set out on the plate the way up it prints: slice it, and send it to the printer.",
          numbers: `${common.count} × in ${common.filament}.`,
        },
        {
          howTo: "Let the plate cool before you flex the part off it, so it doesn't bend.",
          numbers: "Cool, then off.",
        },
      ],
      closeUp: null,
      scene: null,
      check: {
        says: "It's whole, its edges are flat, and its holes are clean, with no strings across them.",
        photo: "The part from the side its holes are on",
      },
      words: ["slice"],
    },
    ...(shaped.holds === undefined
      ? []
      : [
          {
            id: "try-it",
            title: `Try the ${shaped.holds} in it`,
            minutes: 2,
            helper: false,
            parts: ["A"],
            adds: [],
            ways: [],
            tools: [],
            safety: [],
            fixings: [],
            actions: [
              {
                howTo: `Slide the ${shaped.holds} in before fixing anything. It should go in by hand without forcing, and not rattle.`,
                numbers: `${clearance} mm to spare each side.`,
              },
            ],
            closeUp: null,
            scene: null,
            check: {
              says: "It goes in by hand and stays put.",
              photo: `The ${shaped.holds} in it`,
            },
            words: [],
          },
        ]),
    ...(screws.size === 0
      ? []
      : [
          {
            id: "fix-it",
            title: "Fix it",
            minutes: 15,
            helper: false,
            parts: ["A"],
            adds: [],
            ways: [],
            tools: toolsOf(["pencil", "drill-driver", "drill-bits"], toHand),
            safety: toolsOf(["safety-glasses"], toHand),
            fixings: [...screws].map(([name, count]) => ({ name, count: count * common.count })),
            actions: [
              {
                howTo: "Hold it where it goes and mark through each hole with a pencil.",
                numbers: "Mark each hole.",
              },
              {
                howTo:
                  "Drill a pilot hole at each mark, then drive the screws until their heads sit flush, and no further: plastic cracks if a screw's forced.",
                numbers: "Pilot holes, screws flush.",
              },
            ],
            closeUp: null,
            scene: null,
            check: {
              says: "It doesn't move when you push it, and every screw head is flush.",
              photo: "It fixed in place",
            },
            words: ["pilot hole", "countersink"],
          },
        ]),
  ];
  return drafts.map((draft, index) => ({ ...draft, number: index + 1 }));
};

/** Whether a part fits the plate, either way round on it. */
const fitsPlate = (size: Build["size"], plate: { width: number; depth: number; height: number }) =>
  size.height <= plate.height &&
  ((size.length <= plate.width && size.depth <= plate.depth) ||
    (size.length <= plate.depth && size.depth <= plate.width));

/** Everything a printed part's Build shows, from its template and parameters (ADR 0036). */
export const derivePrinted =
  (template: Printed) =>
  (raw: unknown): Result<Build, string[]> => {
    const { parameters: schema, shape } = TEMPLATES[template];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err(issues(parsed.error));
    const parameters = parsed.data;
    const shaped = (shape as (p: typeof parameters) => Shaped)(parameters);
    const { printer } = parameters;
    const checked = checkRecipe(shaped.recipe, printer);
    const features = (checked.recipe?.features ?? []) as readonly PartFeature[];
    const size = envelopeOf({ base: shaped.recipe.base, features });
    const fits = fitsPlate(size, printer.plate);
    const screws = screwsOf(features);
    const steps = stepsOf({
      shaped,
      common: parameters,
      clearance: printer.clearance.value,
      screws,
    });

    const findings: Finding[] = [...checked.findings];
    if (!fits) findings.push({ kind: "too-big-for-plate", size, plate: printer.plate });
    const assumed = shaped.lines.filter((line) => isAssumed(line.source)).map((line) => line.name);
    if (assumed.length > 0) findings.push({ kind: "assumed", sizes: assumed });
    const missing = toolsMissing(steps);
    if (missing) findings.push(missing);

    const priced = (item: string) => parameters.prices[item];
    const buyList = buyListOf([
      buyLine({
        item: parameters.filament,
        kind: "filament",
        for: `printing ${parameters.count === 1 ? "it" : `${parameters.count}`}`,
        needed: 1,
        price: priced(parameters.filament),
      }),
      ...[...screws].map(([item, each]) =>
        buyLine({
          item,
          kind: "fixing",
          for: "fixing it",
          needed: each * parameters.count,
          price: priced(item),
        }),
      ),
    ]);

    return ok({
      template,
      size,
      parts: [
        {
          label: "A",
          name: shaped.part,
          does: shaped.does,
          count: parameters.count,
          material: { kind: "printed", stock: parameters.filament },
          length: size.length,
          width: size.depth,
          thickness: size.height,
          boxes: [{ x: 0, y: 0, z: 0, w: size.length, d: size.depth, h: size.height }],
        },
      ],
      fitted: [],
      cutPlan: { kerf: 0, timber: [], sheets: [] },
      buyList,
      steps,
      glossary: glossaryOf(steps.flatMap((step) => step.words)),
      findings,
      options: [],
      print: {
        plate: printer.plate,
        fits,
        clearance: printer.clearance,
        nozzle: printer.nozzle,
        sizes: shaped.lines,
        recipe: checked.recipe,
      },
    });
  };

export { to3mf, toStl } from "./files.ts";
export { FONT_FILE, readFont } from "./lettering.ts";
export { type Made, makePart } from "./make.ts";
