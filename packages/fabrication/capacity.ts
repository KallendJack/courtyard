import type { SourcedSize } from "@courtyard/contract";
import { type Tool, toolsFrom } from "./tools.ts";

// What a powered saw can cut (#780): a mitre saw's width at 90° and its depth, a circular saw's
// depth. It's read from the size line on the owner's tool, as they gave it from the saw's label or
// its maker's page; until then each is assumed, as small as the common ones cut, so a step never
// sends a cut to a saw that can't take it.

/** The saws a cut can be too big for. A hand saw cuts anything a bench is made of. */
export type PoweredSaw = Extract<Tool, "mitre-saw" | "circular-saw">;

/**
 * A capacity's size with its source: what the owner said it cuts is **reported** (the source the
 * planning Facts bring to `SizeSource`, #701), anything else assumed.
 */
export type CapacitySize = Omit<SourcedSize, "source"> & {
  readonly source: { readonly kind: "reported" } | { readonly kind: "assumed" };
};

/** How wide and deep a saw cuts; a width of `null` is no limit, as a circular saw's. */
export type Capacity = { readonly width: CapacitySize | null; readonly depth: CapacitySize };

export type Capacities = Partial<Record<PoweredSaw, Capacity>>;

/** A tool's size as Your tools saves it, by any of its names (its own, or its tile's). */
export type ToolSize = { readonly name: string; readonly size: string };

const assumed = (value: number): CapacitySize => ({
  value,
  unit: "mm",
  source: { kind: "assumed" },
});
const reported = (value: number): CapacitySize => ({
  value,
  unit: "mm",
  source: { kind: "reported" },
});

/**
 * What a saw is assumed to cut until its capacity is given: a mitre saw anything up to 100 mm
 * wide (a 210 mm one cuts about 120), a circular saw 45 mm deep (a 140 mm blade's).
 */
const ASSUMED: Readonly<Record<PoweredSaw, Capacity>> = {
  "mitre-saw": { width: assumed(100), depth: assumed(60) },
  "circular-saw": { width: null, depth: assumed(45) },
};

const MM = String.raw`(\d+(?:\.\d+)?)`;
/** A width by a depth, as a label gives them: "120 × 60 mm", "120x60". */
const PAIR = new RegExp(String.raw`${MM}\s*(?:mm)?\s*[×xX*]\s*${MM}`);
/** A depth said as one: "54 mm deep", "depth: 54 mm". */
const DEPTH = new RegExp(String.raw`${MM}\s*(?:mm)?\s*deep|depth\D*?${MM}`, "i");

/**
 * A saw's capacity, read from its size as the owner gave it, past any angle ("90°: 120 x 60 mm"):
 * a mitre saw's only as a width by a depth ("120 × 60 mm"), a circular saw's as that or a depth
 * said as one ("54 mm deep"). Anything else, such as a lone "210 mm blade", leaves it assumed.
 */
const capacityOf = (saw: PoweredSaw, size: string): Capacity | undefined => {
  const said = size.replace(/\d+(?:\.\d+)?\s*°/g, " ");
  const pair = PAIR.exec(said);
  const [width, depth] = pair === null ? [] : [Number(pair[1]), Number(pair[2])];
  if (saw === "mitre-saw") {
    return width === undefined || depth === undefined || width <= 0 || depth <= 0
      ? undefined
      : { width: reported(width), depth: reported(depth) };
  }
  const deep = DEPTH.exec(said);
  const alone = deep === null ? undefined : Number(deep[1] ?? deep[2]);
  const given = depth ?? alone;
  return given === undefined || given <= 0 ? undefined : { width: null, depth: reported(given) };
};

/** The powered saws' capacities, from the owner's tools' sizes. */
export const capacitiesFrom = (sizes: readonly ToolSize[]): Capacities => {
  const capacities: Capacities = {};
  for (const { name, size } of sizes) {
    for (const tool of toolsFrom([name])) {
      if (tool !== "mitre-saw" && tool !== "circular-saw") continue;
      const capacity = capacityOf(tool, size);
      if (capacity !== undefined) capacities[tool] = capacity;
    }
  }
  return capacities;
};

/** A saw's capacity: as given, or as assumed. */
export const capacityFor = (capacities: Capacities, saw: PoweredSaw): Capacity =>
  capacities[saw] ?? ASSUMED[saw];

/** Why a timber is too big for a saw: too wide or too deep, and the saw's limit it's past. */
export type TooBig = { readonly way: "wide" | "deep"; readonly limit: CapacitySize };

/** Why a timber lying flat is too big for a saw, or `null` when it fits. */
export const tooBig = (
  capacity: Capacity,
  section: { readonly wide: number; readonly thick: number },
): TooBig | null => {
  if (capacity.width !== null && section.wide > capacity.width.value) {
    return { way: "wide", limit: capacity.width };
  }
  if (section.thick > capacity.depth.value) return { way: "deep", limit: capacity.depth };
  return null;
};
