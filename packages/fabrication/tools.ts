import { z } from "zod";
import type { ToolSize } from "./capacity.ts";

// The tools and safety kit a step can need, which the owner's tools to hand are set against. Kit
// is a tool like any other here, so a missing pair of glasses is listed as a missing saw is.

export const Tool = z.enum([
  "tape-measure",
  "pencil",
  "square",
  "hand-saw",
  "circular-saw",
  "mitre-saw",
  "folding-workbench",
  "long-end-support",
  "clamps",
  "drill-driver",
  "drill-bits",
  "countersink-bit",
  "spanner",
  "spirit-level",
  "sandpaper",
  "safety-glasses",
  "ear-defenders",
]);
export type Tool = z.infer<typeof Tool>;

/** Each tool as a step names it. */
export const TOOL_NAMES: Readonly<Record<Tool, string>> = {
  "tape-measure": "Tape measure",
  pencil: "Pencil",
  square: "Square",
  "hand-saw": "Hand saw",
  "circular-saw": "Circular saw",
  "mitre-saw": "Mitre saw",
  "folding-workbench": "Folding workbench",
  // A sawhorse, a stool or the stack of timber: anything that holds a length's far end level.
  "long-end-support": "Support for the long end",
  clamps: "Clamps",
  "drill-driver": "Drill driver",
  "drill-bits": "Drill bits",
  "countersink-bit": "Countersink bit",
  spanner: "Spanner",
  "spirit-level": "Spirit level",
  sandpaper: "Sandpaper",
  "safety-glasses": "Safety glasses",
  "ear-defenders": "Ear defenders",
};

/**
 * The words in a tool's name, as Your tools saves it (a tile's or the owner's own), that make it
 * one of the steps' tools (#777, #763). One Thing can be several: "Drill and drill bits" is the
 * drill driver and its bits, "Tape, pencil" both. A tile with none (a hammer) is no tool the steps
 * name. Read from the name in lower case, with anything but letters and digits as a space.
 */
const TOOL_WORDS: Readonly<Record<Tool, RegExp>> = {
  "tape-measure": /(?<!(masking|duct|insulating) )\btape\b/,
  pencil: /\bpencil/,
  square: /\bsquare\b/,
  "hand-saw": /\b(hand ?saw|panel saw|tenon saw)/,
  "circular-saw": /\bcircular saw/,
  "mitre-saw": /\b(mitre|miter|chop) saw/,
  "folding-workbench": /\b(workmate|folding (work)?bench)/,
  // A sawhorse, a trestle, a stool or a step: anything that holds a length's far end level.
  "long-end-support":
    /\b(saw ?horse|trestle|stool|step ?ladder|kick ?step|support for the long end)/,
  clamps: /\bclamp/,
  // A drill, but not "drill bits" on their own.
  "drill-driver": /\bdrill\b(?! bits?\b)/,
  "drill-bits": /\b(drill bits?|bit set)\b/,
  "countersink-bit": /\bcountersink/,
  spanner: /\b(spanner|wrench|socket set)/,
  "spirit-level": /\blevel\b/,
  sandpaper: /\b(sand ?paper|sanding (block|sponge|sheets?)|abrasive)/,
  "safety-glasses": /\b(safety (glasses|specs|goggles)|goggles)\b/,
  "ear-defenders": /\bear ?(defenders|muffs|protectors?|protection|plugs)\b/,
};

/** A name as its words are read: lower case, anything but letters and digits a space. */
const wordsOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The steps' tools among the owner's, as Your tools saves them: each its tile's name or theirs. */
export const toolsFrom = (names: readonly string[]): Tool[] => {
  const said = names.map(wordsOf);
  return Tool.options.filter((tool) => said.some((name) => TOOL_WORDS[tool].test(name)));
};

/**
 * The kind of square the owner has (#813), by the words in its name: a speed square (a triangle
 * with a lip) or an L-square (a try, combination or framing square, a blade and a stock). None
 * when Your tools doesn't say, and the close-ups draw a plain one.
 */
export type SquareKind = "speed" | "l-square";

export const squareKindFrom = (names: readonly string[]): SquareKind | undefined => {
  const said = names.map(wordsOf);
  if (said.some((name) => /\b(speed|rafter|triangle) square\b/.test(name))) return "speed";
  if (
    said.some((name) =>
      /\b(l|try|combination|framing|carpenter s?|engineer s?) square\b/.test(name),
    )
  ) {
    return "l-square";
  }
  return undefined;
};

/**
 * The owner's tools that turn or hold a bolt's head and nut (#783), by what each is: fixed
 * spanners, adjustables, a socket set and pliers. Your tools has no tile for these, so they're
 * the owner's own names ("Adjustable spanner", "Pliers", "Socket set"); a name in the plural or a
 * set ("Spanner set", "spanners") is two or more, and anything else is one, so one adjustable is
 * never two spanners.
 */
export type SpannerKit = {
  readonly spanners: number;
  readonly adjustables: number;
  readonly socket: boolean;
  readonly pliers: boolean;
};

export const NO_SPANNERS: SpannerKit = {
  spanners: 0,
  adjustables: 0,
  socket: false,
  pliers: false,
};

const KIT_WORDS = {
  pliers: /\b(pliers|mole grips?|locking grips?)\b/,
  socket: /\b(sockets?|ratchet)\b/,
  adjustable: /\b(adjustables?|shifters?)\b/,
  spanner: /\b(spanners?|wrench(es)?)\b/,
  several: /\b(spanners|wrenches|adjustables|shifters|set)\b/,
} as const;

/** The spanner kit among the owner's tools, as Your tools saves them. */
export const spannerKitFrom = (names: readonly string[]): SpannerKit => {
  const kit = { ...NO_SPANNERS };
  for (const said of names) {
    const name = said
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const count = KIT_WORDS.several.test(name) ? 2 : 1;
    if (KIT_WORDS.socket.test(name)) kit.socket = true;
    else if (KIT_WORDS.adjustable.test(name)) kit.adjustables += count;
    else if (KIT_WORDS.spanner.test(name)) kit.spanners += count;
    else if (KIT_WORDS.pliers.test(name)) kit.pliers = true;
  }
  return kit;
};

/**
 * The only tools something else the owner has can stand in for (#763), by the words in its name.
 * Any other tool counts only from Your tools (#777): a mitre saw in the garage never changes how a
 * step is done until it's saved there.
 */
const STAND_INS: Partial<Record<Tool, RegExp>> = {
  "long-end-support": /\b(saw ?horse|trestle|stool|step ?ladder|kick ?step)/,
};

/** The first of the owner's Things, by name, that will do for a tool, when it's one that can (#763). */
export const standInFor = (tool: Tool, names: readonly string[]): string | undefined => {
  const words = STAND_INS[tool];
  return words && names.find((name) => words.test(wordsOf(name)));
};

/** The sizes the owner's drill bit sets are kept with ("3, 5, 7 mm", "1–10 mm"), among their tools'. */
export const bitSetsFrom = (sizes: readonly ToolSize[]): string[] => [
  ...new Set(
    sizes.filter(({ name }) => toolsFrom([name]).includes("drill-bits")).map(({ size }) => size),
  ),
];

/**
 * Whether the owner's drill bit sets have a bit, by the sizes each is kept with: listed ("3, 5,
 * 7 mm"), a range ("1–10 mm") or both ("1–6 mm, 7 mm"). Left out when no set's sizes are known.
 */
export const bitInSets = (sets: readonly string[], mm: number): boolean | undefined => {
  if (sets.length === 0) return undefined;
  return sets.some((size) =>
    size.split(",").some((part) => {
      const range = /(\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(\d+(?:\.\d+)?)/.exec(part);
      if (range) return mm >= Number(range[1]) && mm <= Number(range[2]);
      return (part.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).includes(mm);
    }),
  );
};
