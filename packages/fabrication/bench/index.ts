import { baseForScrews, clashesOf, screwsFromBelow } from "../assembly/space.ts";
import {
  type Build,
  type BuildSetting,
  err,
  type Finding,
  type Fitted,
  type KeptWay,
  ok,
  type Part,
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
import {
  benchFitted,
  benchParts,
  benchTaken,
  castorPlacesOf,
  type Shape,
  shapeOf,
  shapeProblems,
} from "./frame.ts";
import { type BenchParameters, castorFixingNames } from "./parameters.ts";
import { benchSteps } from "./steps.ts";
import { BENCH_SLOTS } from "./stock-slots.ts";

/**
 * The framed bench worked out from its checked parameters: everything its Build shows. A bench of
 * sizes that can't be built (too low for its castors) is refused with what's wrong. Its steps
 * follow the owner's tools when they're given, and keep the ways the steps started were done
 * (#777). Its recipe (#769) is worked out with this until any recipe is (#770).
 */
export const workOutBench = (
  checked: BenchParameters,
  setting: BuildSetting = {},
): Result<Build, string[]> => {
  const parameters = oneSheetEach(checked, BENCH_SLOTS);
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

/** The deepest a bench is tried at, looking for the depth its castors sit clear of its legs. */
const DEEPEST = 1500;

/**
 * The bench as one (#835): whatever takes another's space once it's all built. Its castors' nuts
 * on a leg say the plain fixes: deep enough for the castors to sit clear, or coach screws from
 * below where the bases are thick enough to hold them.
 */
const benchClashes = (
  parameters: BenchParameters,
  shape: Shape,
  built: { parts: readonly Part[]; fitted: readonly Fitted[]; boltLength: number },
): Finding[] => {
  const castors = parameters.castors;
  const taken = benchTaken(parameters, shape, built);
  const nuts = taken.find((each) => each.name.endsWith("nuts and ends"))?.name;
  const castorFixes = () => {
    if (!castors) return [];
    const deep = (depth: number) =>
      castorPlacesOf(
        parameters,
        shapeOf({ ...parameters, depth: { ...parameters.depth, value: depth } }),
      );
    let depth = Math.ceil(parameters.depth.value / 10) * 10;
    while (depth < DEEPEST && deep(depth) === undefined) depth += 10;
    const diameter = castors.bolt.diameter.value;
    const screws = screwsFromBelow({
      diameter,
      plate: castors.plate.thickness.value,
      base: shape.wideThick,
    });
    return [
      ...(depth < DEEPEST
        ? [`Make the bench at least ${depth} deep, so the castors sit clear of the legs`]
        : []),
      screws === undefined
        ? `Use castor bases ${baseForScrews(diameter)} thick or more, for coach screws from below`
        : `Fix the castors with ${diameter} × ${screws} coach screws from below, nothing through the top`,
    ];
  };
  return clashesOf(taken).map((clash) => ({
    kind: "clashes",
    ...clash,
    fixes: clash.what === nuts ? castorFixes() : ["Change their sizes so each keeps its own space"],
  }));
};

/** What the bench is worked out with besides its parameters, as `workOutBench` reads its setting. */
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
    const { steps, outOfReach } = benchSteps({
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
    findings.push(
      ...benchClashes(parameters, shape, { parts, fitted, boltLength: use }),
      ...outOfReach,
    );
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
