import { z } from "zod";

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
  // A sawhorse, a trestle or a stool: anything that holds a length's far end level.
  "long-end-support": /\b(saw ?horse|trestle|stool|support for the long end)/,
  clamps: /\bclamp/,
  // A drill, but not "drill bits" on their own.
  "drill-driver": /\bdrill\b(?! bits?\b)/,
  "drill-bits": /\b(drill bits?|bit set)\b/,
  "countersink-bit": /\bcountersink/,
  spanner: /\b(spanner|wrench|socket set)/,
  "spirit-level": /\blevel\b/,
  "safety-glasses": /\b(safety (glasses|specs|goggles)|goggles)\b/,
  "ear-defenders": /\bear ?(defenders|muffs|protectors?|protection|plugs)\b/,
};

/** The steps' tools among the owner's, as Your tools saves them: each its tile's name or theirs. */
export const toolsFrom = (names: readonly string[]): Tool[] => {
  const said = names.map((name) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  );
  return Tool.options.filter((tool) => said.some((name) => TOOL_WORDS[tool].test(name)));
};
