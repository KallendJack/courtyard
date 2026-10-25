import type { BuildFinding, BuildPart, BuildStep, DerivedBuild } from "@courtyard/contract";

// How a Build's numbers read (#698): money, stock, findings and a part's details, worked out from
// what the engine derived, never by the page itself.

/** Pence as pounds: "£34.00". */
export const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`;

/** A length in metres, as timber is sold: "2.4 m". */
export const metres = (mm: number) => `${mm / 1000} m`;

/** A size in mm, to the whole mm as the owner works to it: 899.6 is "900". */
export const mm = (value: number) => `${Math.round(value)}`;

/** The Build's size, as its title's line says it: "1500 × 600 × 900 mm". */
export const sizeLine = (size: DerivedBuild["size"]) =>
  `${mm(size.length)} × ${mm(size.depth)} × ${mm(size.height)} mm`;

/** What the making rules found that needs the owner: all but the sizes assumed. */
export const toCheck = (findings: readonly BuildFinding[]) =>
  findings.filter((finding) => finding.kind !== "assumed");

/** "A, B and C". */
export const listed = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** A finding as its card says it: a title, and what to do. */
export const findingWords = (
  finding: Exclude<BuildFinding, { kind: "assumed" }>,
): { title: string; detail: string } => {
  switch (finding.kind) {
    case "fixing-too-short": {
      const through = [...new Set(finding.through.map((layer) => layer.what))];
      return {
        title: `${finding.fixing} too short`,
        detail: `They need ${mm(finding.needed)} mm, through the ${listed(through)}. The steps and buy list use ones ${finding.use} mm long.`,
      };
    }
    case "tools-missing":
      return {
        title: `${listed(finding.tools.map((tool) => tool.name))} not to hand`,
        detail: finding.tools
          .map((tool) => `${tool.name}: step ${listed(tool.steps.map(String))}`)
          .join(" · "),
      };
    case "too-big-for-stock":
      return {
        title: `${finding.label} is too big for ${finding.stock}`,
        detail: "Choose a bigger sheet or length, or a smaller size.",
      };
    case "wrong-stock":
      return {
        title: `${finding.stock} is wrong for the ${listed(finding.parts.map((part) => part.toLowerCase()))}`,
        detail: `${finding.why} Pick another from its options.`,
      };
  }
};

/**
 * What the making rules found about one step, for its gold card: a fixing it fits too short, or a
 * part it uses too big for its stock. Its tools not to hand are marked in its tools.
 */
export const stepFindings = (derived: DerivedBuild, step: BuildStep) =>
  derived.findings.filter(
    (finding) =>
      (finding.kind === "fixing-too-short" && finding.steps.includes(step.number)) ||
      (finding.kind === "too-big-for-stock" && step.parts.includes(finding.label)),
  );

/** The sizes the engine assumed rather than was given, as people say them. */
const ASSUMED: Readonly<Record<string, string>> = {
  kerf: "saw cut",
  "top.overhang": "top's overhang",
};
export const assumedSizes = (findings: readonly BuildFinding[]) =>
  findings.flatMap((finding) =>
    finding.kind === "assumed" ? finding.sizes.map((size) => ASSUMED[size] ?? size) : [],
  );

/** What a part is cut from: its length of timber or its sheet, as the shop sells it. */
export const cutFrom = (derived: DerivedBuild, part: BuildPart) => {
  const { stock } = part.material;
  const timber = derived.cutPlan.timber.find((each) => each.stock === stock);
  if (timber !== undefined) return `${stock}, ${metres(timber.stockLength)}`;
  const sheet = derived.cutPlan.sheets.find((each) => each.stock === stock);
  if (sheet !== undefined) return `${stock}, ${sheet.sheetLength} × ${sheet.sheetWidth}`;
  return stock;
};

/** The steps that use a part, by number. */
export const stepsUsing = (derived: DerivedBuild, label: string) =>
  derived.steps.filter((step) => step.parts.includes(label)).map((step) => step.number);

/** A part's cut size: "1450 × 95 × 45 mm". */
export const partSize = (part: BuildPart) =>
  `${mm(part.length)} × ${mm(part.width)} × ${mm(part.thickness)} mm`;

/** Every tool the steps use, once each, in the order they're first needed, with those steps. */
export const toolsNeeded = (derived: DerivedBuild) => {
  const tools = new Map<string, { name: string; toHand: boolean; steps: number[] }>();
  for (const step of derived.steps) {
    for (const tool of [...step.tools, ...step.safety]) {
      const known = tools.get(tool.tool);
      if (known === undefined) {
        tools.set(tool.tool, { name: tool.name, toHand: tool.toHand, steps: [step.number] });
      } else if (!known.steps.includes(step.number)) known.steps.push(step.number);
    }
  }
  return [...tools.entries()].map(([tool, known]) => ({ tool, ...known }));
};
