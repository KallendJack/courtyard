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
  const steps = benchSteps({ parameters, shape, cutPlan: planned.cutPlan });

  const castors = parameters.castors;
  const fixingPrices = new Map<string, Price | undefined>([
    [parameters.fixings.frameScrews.name, parameters.fixings.frameScrews.price],
    [parameters.fixings.sheetScrews.name, parameters.fixings.sheetScrews.price],
    [parameters.fixings.brackets.name, parameters.fixings.brackets.price],
  ]);
  if (castors) {
    const names = castorFixingNames(castors);
    fixingPrices.set(names.bolts, castors.bolt.price);
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
  if (castors) {
    const thread = `M${castors.bolt.diameter.value}`;
    const tooShort = boltCheck({
      name: castorFixingNames(castors).bolts,
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
    });
    if (tooShort) findings.push(tooShort);
  }
  const missing = toolsMissing(steps);
  if (missing) findings.push(missing);
  const assumed = assumedSizes(parameters);
  if (assumed) findings.push(assumed);

  return ok({
    template: "framed-bench",
    size: { length: shape.length, depth: shape.depth, height: shape.height },
    parts,
    fitted: benchFitted(parameters, shape),
    cutPlan: planned.cutPlan,
    buyList,
    steps,
    glossary: glossaryOf(steps.flatMap((step) => step.words)),
    findings,
    print: null,
  });
};
