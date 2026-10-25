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
 * The tools each of Your tools' tiles is (#707), where its name isn't one of the steps' own: the
 * Workmate is a folding workbench, sawhorses hold the long end. A tile with none (a hammer) is no
 * tool the steps name.
 */
const TILE_TOOLS: Readonly<Record<string, readonly Tool[]>> = {
  "tape, pencil": ["tape-measure", "pencil"],
  workmate: ["folding-workbench"],
  sawhorses: ["long-end-support"],
  "drill / driver": ["drill-driver"],
};

/**
 * The steps' tools among the owner's, as Your tools saves them: each by its tile's name or the
 * owner's own, matched without minding capitals (#777).
 */
export const toolsFrom = (names: readonly string[]): Tool[] => {
  const byName = new Map(Tool.options.map((tool) => [TOOL_NAMES[tool].toLowerCase(), tool]));
  const found = names.flatMap((name) => {
    const said = name.trim().toLowerCase();
    const one = byName.get(said);
    return TILE_TOOLS[said] ?? (one === undefined ? [] : [one]);
  });
  return Tool.options.filter((tool) => found.includes(tool));
};
