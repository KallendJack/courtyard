import type {
  BuildFinding,
  BuildPart,
  BuildStep,
  BuildStepTool,
  DerivedBuild,
} from "@courtyard/contract";

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

/**
 * A printed part's size in mm, to the tenth (#702): a printer works finer than a saw, and its
 * clearance is a fraction of a mm. 0.2 is "0.2", 84.4 is "84.4".
 */
export const tenths = (value: number) => `${Math.round(value * 10) / 10}`;

/** A printed part's size, as its title's line says it: "84.4 × 119.2 × 70.2 mm". */
export const printSizeLine = (size: DerivedBuild["size"]) =>
  `${tenths(size.length)} × ${tenths(size.depth)} × ${tenths(size.height)} mm`;

/** "A, B and C". */
export const listed = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** A finding as its card says it: a title, and what to do. */
type Card = { readonly title: string; readonly detail: string };

/**
 * What the making rules found that needs the owner, each as its card says it: for a bench, all
 * but the sizes assumed, which its cut plan says, and the tools missing, which its Tools tab says
 * once with what to do (#763); for a printed part (#702), each size assumed too, since nothing
 * else shows it before it's printed.
 */
export const checkCards = (
  findings: readonly BuildFinding[],
  print: DerivedBuild["print"],
): Card[] =>
  findings.flatMap((finding) => {
    if (finding.kind === "tools-missing" && print === null) return [];
    if (finding.kind !== "assumed") return [findingWords(finding)];
    if (print === null) return [];
    return finding.sizes.map((name) => {
      const says = print.sizes.find((size) => size.name === name)?.says ?? "It";
      return {
        title: `${name} assumed`,
        detail: `${says} isn't measured. Measure yours before printing: too tight and it won't fit.`,
      };
    });
  });

const findingWords = (finding: Exclude<BuildFinding, { kind: "assumed" }>): Card => {
  switch (finding.kind) {
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
    case "cannot-make":
      return { title: "Can't be made as it is", detail: finding.problems.join(" ") };
    case "too-big-for-plate":
      return {
        title: "Too big for the plate",
        detail: `It's ${printSizeLine(finding.size)}, and the plate takes ${printSizeLine({ length: finding.plate.width, depth: finding.plate.depth, height: finding.plate.height })}. Make it smaller, or print it in parts.`,
      };
    case "wall-too-thin":
      return {
        title: `${finding.where} is too thin`,
        detail: `${tenths(finding.mm)} mm, less than the ${tenths(finding.least)} mm the nozzle prints well. Make it thicker.`,
      };
    case "wrong-stock":
      return {
        title: `${finding.stock} is wrong for the ${listed(finding.parts.map((part) => part.toLowerCase()))}`,
        detail: `${finding.why} Pick another from its options.`,
      };
    case "sags":
      return {
        title: `${finding.name} sags under ${finding.load.said ?? "a heavy load"}`,
        detail: `${mm(finding.thickness)} mm over ${mm(finding.span)} mm sags ${tenths(finding.sag)} mm; ${tenths(finding.allowed)} mm is the most it should. ${fixesSaid(finding.fixes)}`,
      };
    case "tips":
      return {
        title: "It can tip over",
        detail: `${mm(finding.height)} mm tall on feet ${mm(finding.feet)} mm apart ${finding.way}. ${fixesSaid(finding.fixes)} ${finding.advice}`,
      };
    case "racks":
      return {
        title: "The frame can lean over",
        detail: `Nothing braces the ${finding.frame}. ${fixesSaid(finding.fixes)}`,
      };
    case "screw-length":
      return {
        title: `The ${finding.screws} are ${finding.problem} for the ${finding.joint}`,
        detail: `${finding.problem === "too long" ? `They'd come out the far side of the ${mm(finding.room)} mm they go into.` : `They go ${mm(finding.into)} mm in, and grip from ${mm(finding.least)} mm.`} ${fixesSaid(finding.fixes)}`,
      };
    case "clashes":
      return {
        title: `The ${finding.what.toLowerCase()} meet the ${finding.with.toLowerCase()}`,
        detail: `Built as it is, they take the same space. ${fixesSaid(finding.fixes)}`,
      };
    case "out-of-reach":
      return {
        title: `${finding.step}: its work is covered`,
        detail: `${finding.by} puts pieces where it drills or screws. ${fixesSaid(finding.fixes)}`,
      };
  }
};

/** A check's fixes as its card says them: "Use 18 mm, or add a centre support." */
const fixesSaid = (fixes: readonly string[]) => {
  const said = fixes.map((fix, index) =>
    index === 0 ? fix : fix.charAt(0).toLowerCase() + fix.slice(1),
  );
  return `${said.join(", or ")}.`;
};

/** The printer's clearance, as the plate's foot says it (#702). */
export const clearanceLine = (print: NonNullable<DerivedBuild["print"]>) =>
  `holes allow ${tenths(print.clearance.value)} mm${print.clearance.source.kind === "assumed" ? " (assumed until the printer's calibrated)" : ""}`;

/**
 * What the making rules found about one step, for its gold card: a part it uses too big for its
 * stock. Its tools not to hand are marked in its tools.
 */
export const stepFindings = (derived: DerivedBuild, step: BuildStep) =>
  derived.findings.filter(
    (finding) => finding.kind === "too-big-for-stock" && step.parts.includes(finding.label),
  );

/** A photo of a step sent to be checked (#699), with what it's of and how it's checked. */
export const checkQuestion = (step: BuildStep) =>
  `Step ${step.number}, ${step.title}: ${step.check.photo} ${step.check.says} Does it look right?`;
/**
 * What's changed in how the steps are done since the owner's tools did (#777), a line a step:
 * "Cut and label the timber now uses your mitre saw, not the hand saw."
 */
export const wayChanges = (derived: DerivedBuild) =>
  derived.steps.flatMap((step) =>
    step.wayChanged === null
      ? []
      : [
          `${step.title} now uses your ${step.wayChanged.now.toLowerCase()}, not the ${step.wayChanged.was.toLowerCase()}.`,
        ],
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

/** A drill bit a step needs, as the engine gives it. */
type Bit = NonNullable<BuildStepTool["bits"]>[number];

/** A tool the steps use, once: whether it's to hand, the steps it's for, and its bits. */
export type ToolNeeded = {
  readonly tool: string;
  readonly name: string;
  readonly toHand: boolean;
  readonly standIn?: string;
  /** The first step it's for, by title, and each step by number. */
  readonly firstStep: string;
  readonly steps: readonly number[];
  /** Drill bits' sizes, each once, the largest first. */
  readonly bits: readonly Bit[];
};

/** Every tool the steps use, once each, in the order they're first needed, with those steps. */
export const toolsNeeded = (derived: DerivedBuild): ToolNeeded[] => {
  const tools = new Map<string, ToolNeeded & { steps: number[]; bits: Bit[] }>();
  for (const step of derived.steps) {
    for (const tool of [...step.tools, ...step.safety]) {
      let known = tools.get(tool.tool);
      if (known === undefined) {
        known = {
          tool: tool.tool,
          name: tool.name,
          toHand: tool.toHand,
          ...(tool.standIn === undefined ? {} : { standIn: tool.standIn }),
          firstStep: step.title,
          steps: [],
          bits: [],
        };
        tools.set(tool.tool, known);
      } else if (known.toHand && !tool.toHand) {
        // One tool twice, as the castors' spanners (#783): it's to sort while either isn't to hand.
        known = { ...known, name: tool.name, toHand: false };
        tools.set(tool.tool, known);
      }
      if (!known.steps.includes(step.number)) known.steps.push(step.number);
      for (const bit of tool.bits ?? []) {
        if (!known.bits.some((each) => each.mm === bit.mm)) known.bits.push(bit);
      }
    }
  }
  return [...tools.values()].map((tool) => ({
    ...tool,
    bits: [...tool.bits].sort((a, b) => b.mm - a.mm),
  }));
};

/**
 * Whether a tool needs the owner (#763): one not to hand, or drill bits whose sizes their set
 * isn't known to have.
 */
export const toSort = (tool: ToolNeeded) =>
  !tool.toHand || tool.bits.some((bit) => bit.have !== true);

/** Drill bits' sizes as said: "7 mm and 3 mm". */
export const bitSizes = (bits: readonly Bit[]) => listed(bits.map((bit) => `${bit.mm} mm`));

/**
 * A step's bit as its chip says it, when the owner's set isn't known to have it: "a 7 mm bit:
 * check your set", or "7 mm bit?" when it's known not to.
 */
export const bitToCheck = (bit: Bit) =>
  bit.have === undefined ? `a ${bit.mm} mm bit: check your set` : `${bit.mm} mm bit?`;

/**
 * A step's tool as its chip says it (#763): drill bits by the size the step drills with, "a 7 mm
 * bit: check your set" while the set's sizes aren't known; and what will do for a tool the owner
 * hasn't, "Support for the long end: your step stool".
 */
export const chipOf = (tool: BuildStepTool): { says: string; ready: boolean } => {
  const bits = tool.bits ?? [];
  const unsure = bits.filter((bit) => bit.have !== true);
  if (!tool.toHand) {
    return {
      says: bits.length === 0 ? `${tool.name}?` : listed(bits.map((bit) => `${bit.mm} mm bit?`)),
      ready: false,
    };
  }
  if (unsure.length > 0) return { says: listed(unsure.map(bitToCheck)), ready: false };
  if (bits.length > 0) return { says: listed(bits.map((bit) => `${bit.mm} mm bit`)), ready: true };
  if (tool.standIn !== undefined) {
    return { says: `${tool.name}: your ${tool.standIn.toLowerCase()}`, ready: true };
  }
  return { says: tool.name, ready: true };
};

/**
 * What every step that marks or cuts has to hand, so the bench's chips leave it out (#826, its
 * boards): the tape, the pencil and the glasses. Show me how and I don't have… still list them.
 */
const EVERYDAY = new Set(["tape-measure", "pencil", "safety-glasses", "ear-defenders"]);

/**
 * A step's tools as the bench's chips say them (#826; "Fabrication · Castors in 3D, your kit ·
 * Fold (#783)"): the ones particular to it, and the drill with the bit it drills with, as one
 * ("Drill driver, 7 mm bit"), gold while the owner's set isn't known to have it.
 */
export const benchChips = (step: BuildStep): { key: string; says: string; ready: boolean }[] => {
  const bits = step.tools.find((tool) => tool.tool === "drill-bits");
  const drill = step.tools.some((tool) => tool.tool === "drill-driver");
  return step.tools.flatMap((tool) => {
    // The bits are said with the drill when it's listed, and on their own ("Drill, 7 mm bit") when not.
    if (EVERYDAY.has(tool.tool) || (tool.tool === "drill-bits" && drill)) return [];
    const key = `${tool.tool} ${tool.name}`;
    if (tool.tool !== "drill-driver" || bits === undefined) return [{ key, ...chipOf(tool) }];
    const sizes = bits.bits ?? [];
    return [
      {
        key,
        says: `${tool.name}, ${listed(sizes.map((bit) => `${bit.mm} mm`))} bit`,
        ready: tool.toHand && bits.toHand && sizes.every((bit) => bit.have === true),
      },
    ];
  });
};
