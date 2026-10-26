import {
  type Build,
  type BuildSetting,
  err,
  type Finding,
  type KeptWay,
  ok,
  type Result,
} from "../build.ts";
import { buyLine, buyListOf, stockLines, toolsToBuy } from "../buy-list.ts";
import { type Capacities, capacitiesFrom } from "../capacity.ts";
import { cutPlanOf } from "../cut-plan.ts";
import { assumedSizes, boltLength, toolsMissing } from "../findings.ts";
import { glossaryOf } from "../glossary.ts";
import { oneSheetEach, stockOptions, wrongStock } from "../options.ts";
import type { Price } from "../stock.ts";
import {
  bitSetsFrom,
  NO_SPANNERS,
  type SpannerKit,
  type SquareKind,
  spannerKitFrom,
  squareKindFrom,
  standInFor,
  Tool,
  toolsFrom,
} from "../tools.ts";
import { benchFitted, benchParts, shapeOf, shapeProblems } from "./frame.ts";
import { BenchParameters, castorFixingNames } from "./parameters.ts";
import { benchSteps } from "./steps.ts";
import { BENCH_SLOTS } from "./stock-slots.ts";

/**
 * The framed bench: its parameters in, everything its Build shows out. Parameters that aren't a
 * bench (a size with no source, a bench too low for its castors) are refused with what's wrong.
 * Its steps follow the owner's tools when they're given, and keep the ways the steps started were
 * done (#777).
 */
export const deriveBench = (
  input: unknown,
  setting: BuildSetting = {},
): Result<Build, string[]> => {
  const parsed = BenchParameters.safeParse(input);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "parameters"}: ${issue.message}`,
      ),
    );
  }
  const parameters = oneSheetEach(parsed.data, BENCH_SLOTS);
  const own = new Set(setting.tools === undefined ? parameters.tools : toolsFrom(setting.tools));
  // What the owner has besides Your tools stands in for a tool they haven't: a step stool (#763).
  const have = setting.have ?? [];
  const standIns = new Map(
    Tool.options.flatMap((tool) => {
      const thing = own.has(tool) ? undefined : standInFor(tool, have);
      return thing === undefined ? [] : [[tool, thing] as const];
    }),
  );
  // With no Your tools saved, the Build's own spanner is two of them, as its steps first said.
  const kit =
    setting.tools !== undefined
      ? spannerKitFrom(setting.tools)
      : parameters.tools.includes("spanner")
        ? { ...NO_SPANNERS, spanners: 2 }
        : NO_SPANNERS;
  const benchOf = benchWith({
    toHand: new Set([...own, ...standIns.keys()]),
    standIns,
    have,
    bitSets: bitSetsFrom(setting.sizes ?? []),
    buying: setting.buying ?? [],
    kit,
    kept: setting.kept ?? [],
    started: setting.started ?? [],
    capacities: capacitiesFrom(setting.sizes ?? []),
    square: squareKindFrom(setting.tools ?? []),
  });
  const build = benchOf(parameters);
  if (!build.ok) return build;
  return ok({
    ...build.value,
    options: stockOptions({
      parameters,
      slots: BENCH_SLOTS,
      prices: parameters.prices,
      damp: parameters.damp,
      build: build.value,
      derive: benchOf,
    }),
  });
};

/** What the bench is worked out with besides its parameters, as `deriveBench` reads its setting. */
type Setting = {
  readonly toHand: ReadonlySet<Tool>;
  readonly standIns: ReadonlyMap<Tool, string>;
  readonly have: readonly string[];
  readonly bitSets: readonly string[];
  readonly buying: readonly Tool[];
  /** What the owner has that holds a bolt's head and turns its nut (#783). */
  readonly kit: SpannerKit;
  readonly kept: readonly KeptWay[];
  /** The steps with a line ticked, by ID: a step started keeps its lines (#783). */
  readonly started: readonly string[];
  readonly capacities: Capacities;
  /** The kind of square the owner has, for the close-ups (#813). */
  readonly square: SquareKind | undefined;
};

/**
 * Everything but the options, which each work the bench out again with one swapped in, with the
 * tools to hand and the ways kept.
 */
const benchWith =
  ({ toHand, standIns, have, bitSets, buying, kit, kept, started, capacities, square }: Setting) =>
  (parameters: BenchParameters): Result<Omit<Build, "options">, string[]> => {
    const shape = shapeOf(parameters);
    const problems = shapeProblems(shape);
    if (problems.length > 0) return err(problems);

    const parts = benchParts(parameters, shape);
    const timbers = [parameters.frame.timber, parameters.frame.wide];
    const sheets = [parameters.top.sheet, parameters.shelf.sheet, parameters.braces.sheet];
    const planned = cutPlanOf({ parts, timbers, sheets, kerf: parameters.kerf.value });
    const castors = parameters.castors;
    const thread = castors ? `M${castors.bolt.diameter.value}` : "";
    const bolts = castors
      ? boltLength({
          thread: castors.bolt.diameter.value,
          length: castors.bolt.length.value,
          pitch: castors.bolt.pitch.value,
          have,
          through: [
            { what: "castor plate", mm: castors.plate.thickness.value },
            { what: "castor base", mm: shape.wideThick },
            ...Array.from({ length: castors.washer.perBolt }, () => ({
              what: `${thread} washer`,
              mm: castors.washer.thickness.value,
            })),
            { what: `${thread} lock nut`, mm: castors.nut.height.value },
          ],
        })
      : null;
    // Bolts too short are never what the steps fit or the buy list buys: the length to use is.
    const use = bolts?.use ?? 0;
    const corrected = castors ? use !== castors.bolt.length.value : false;
    const fitted = benchFitted(parameters, shape);
    const steps = benchSteps({
      parameters,
      shape,
      cutPlan: planned.cutPlan,
      boltLength: use,
      parts,
      fitted,
      toHand,
      kit,
      standIns,
      bitSets,
      kept,
      started,
      capacities,
      square,
    });

    const { frameScrews, sheetScrews, brackets, bracketScrews } = parameters.fixings;
    const fixingPrices = new Map<string, Price | undefined>([
      [frameScrews.name, frameScrews.price],
      [sheetScrews.name, sheetScrews.price],
      [brackets.name, brackets.price],
      ...(bracketScrews ? [[bracketScrews.name, bracketScrews.price] as const] : []),
    ]);
    const boltNames = castors && castorFixingNames(castors, use).bolts;
    if (castors) {
      const names = castorFixingNames(castors, use);
      // The price given is for the bolts given, so the longer ones to use have none yet.
      fixingPrices.set(names.bolts, corrected ? undefined : castors.bolt.price);
      fixingPrices.set(names.washers, castors.washer.price);
      fixingPrices.set(names.nuts, castors.nut.price);
    }
    const fixingCounts = new Map<string, { count: number; steps: string[] }>();
    for (const step of steps) {
      for (const fixing of step.fixings) {
        const counted = fixingCounts.get(fixing.name) ?? { count: 0, steps: [] };
        fixingCounts.set(fixing.name, {
          count: counted.count + fixing.count,
          steps: [...counted.steps, step.title.toLowerCase()],
        });
      }
    }

    const buyList = buyListOf([
      ...stockLines({
        cutPlan: planned.cutPlan,
        timbers,
        sheets,
        names: new Map(parts.map((part) => [part.label, part.name])),
      }),
      ...(castors
        ? [
            buyLine({
              item: castors.name,
              kind: "fitted",
              for: "under the castor bases",
              needed: 4,
              price: castors.price,
            }),
          ]
        : []),
      ...[...fixingCounts].map(([name, counted]) => {
        const line = buyLine({
          item: name,
          kind: "fixing",
          for: counted.steps.join(", "),
          needed: counted.count,
          price: fixingPrices.get(name),
        });
        return name === boltNames && bolts ? { ...line, length: bolts.length } : line;
      }),
      ...toolsToBuy(steps, buying),
    ]);

    const findings: Finding[] = [
      ...planned.findings,
      ...wrongStock({ parameters, slots: BENCH_SLOTS, damp: parameters.damp, build: { parts } }),
    ];
    const missing = toolsMissing(steps);
    if (missing) findings.push(missing);
    const assumed = assumedSizes(parameters);
    if (assumed) findings.push(assumed);

    return ok({
      template: "framed-bench",
      size: { length: shape.length, depth: shape.depth, height: shape.height },
      parts,
      fitted,
      cutPlan: planned.cutPlan,
      buyList,
      steps,
      glossary: glossaryOf(steps.flatMap((step) => step.words)),
      findings,
      print: null,
    });
  };
