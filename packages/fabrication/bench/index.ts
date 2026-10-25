import { type Build, err, type Finding, ok, type Result } from "../build.ts";
import { buyLine, buyListOf, stockLines } from "../buy-list.ts";
import { cutPlanOf } from "../cut-plan.ts";
import { assumedSizes, boltCheck, toolsMissing } from "../findings.ts";
import { glossaryOf } from "../glossary.ts";
import type { Price } from "../stock.ts";
import { benchFitted, benchParts, shapeOf, shapeProblems } from "./frame.ts";
import { BenchParameters, castorFixingNames } from "./parameters.ts";
import { benchSteps } from "./steps.ts";

/**
 * The framed bench: its parameters in, everything its Build shows out. Parameters that aren't a
 * bench (a size with no source, a bench too low for its castors) are refused with what's wrong.
 */
export const deriveBench = (input: unknown): Result<Build, string[]> => {
  const parsed = BenchParameters.safeParse(input);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "parameters"}: ${issue.message}`,
      ),
    );
  }
  const parameters = parsed.data;
  const shape = shapeOf(parameters);
  const problems = shapeProblems(shape);
  if (problems.length > 0) return err(problems);

  const parts = benchParts(parameters, shape);
  const timbers = [parameters.frame.timber, parameters.frame.wide];
  const sheets = [parameters.top.sheet, parameters.shelf.sheet, parameters.braces.sheet];
  const planned = cutPlanOf({ parts, timbers, sheets, kerf: parameters.kerf.value });
  const castors = parameters.castors;
  const thread = castors ? `M${castors.bolt.diameter.value}` : "";
  const tooShort = castors
    ? boltCheck({
        name: `${thread} × ${castors.bolt.length.value} bolts`,
        length: castors.bolt.length.value,
        pitch: castors.bolt.pitch.value,
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
  const boltLength = tooShort?.use ?? castors?.bolt.length.value ?? 0;
  const fitted = benchFitted(parameters, shape);
  const steps = benchSteps({
    parameters,
    shape,
    cutPlan: planned.cutPlan,
    boltLength,
    parts,
    fitted,
  });

  const { frameScrews, sheetScrews, brackets, bracketScrews } = parameters.fixings;
  const fixingPrices = new Map<string, Price | undefined>([
    [frameScrews.name, frameScrews.price],
    [sheetScrews.name, sheetScrews.price],
    [brackets.name, brackets.price],
    ...(bracketScrews ? [[bracketScrews.name, bracketScrews.price] as const] : []),
  ]);
  if (castors) {
    const names = castorFixingNames(castors, boltLength);
    // The price given is for the bolts given, so the longer ones to use have none yet.
    fixingPrices.set(names.bolts, tooShort ? undefined : castors.bolt.price);
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
    ...[...fixingCounts].map(([name, counted]) =>
      buyLine({
        item: name,
        kind: "fixing",
        for: counted.steps.join(", "),
        needed: counted.count,
        price: fixingPrices.get(name),
      }),
    ),
  ]);

  const findings: Finding[] = [...planned.findings];
  if (castors && tooShort) {
    const bolts = castorFixingNames(castors, boltLength).bolts;
    findings.push({
      ...tooShort,
      steps: steps
        .filter((step) => step.fixings.some((fixing) => fixing.name === bolts))
        .map((step) => step.number),
    });
  }
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
  });
};
