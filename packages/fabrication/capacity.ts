import type { SourcedSize } from "@courtyard/contract";
import { type Tool, toolsFrom } from "./tools.ts";

// What a powered saw can cut (#780): a mitre saw's width at 90° and its depth, a circular saw's
// depth. The owner gives it once in Your tools, from the saw's label or its maker's page; until
// then each is assumed, as small as the common ones cut, so a step never sends a cut to a saw that
// can't take it.

/** The saws a cut can be too big for. A hand saw cuts anything a bench is made of. */
export type PoweredSaw = Extract<Tool, "mitre-saw" | "circular-saw">;

/** How wide and deep a saw cuts; a width of `null` is no limit, as a circular saw's. */
export type Capacity = { readonly width: SourcedSize | null; readonly depth: SourcedSize };

export type Capacities = Partial<Record<PoweredSaw, Capacity>>;

/** A tool's size as Your tools saves it, by any of its names (its own, or its tile's). */
export type ToolSize = { readonly name: string; readonly size: string };

const assumed = (value: number): SourcedSize => ({
  value,
  unit: "mm",
  source: { kind: "assumed" },
});
const given = (value: number): SourcedSize => ({
  value,
  unit: "mm",
  source: { kind: "specified", reference: "Your tools" },
});

/**
 * What a saw is assumed to cut until its capacity is given: a mitre saw anything up to 100 mm
 * wide (a 210 mm one cuts about 120), a circular saw 45 mm deep (a 140 mm blade's).
 */
const ASSUMED: Readonly<Record<PoweredSaw, Capacity>> = {
  "mitre-saw": { width: assumed(100), depth: assumed(60) },
  "circular-saw": { width: null, depth: assumed(45) },
};

/**
 * A saw's capacity, read from its size as the owner gave it: a mitre saw's "120 × 60 mm" is 120
 * wide and 60 deep, a circular saw's "55 mm" 55 deep. What isn't given stays assumed.
 */
const capacityOf = (saw: PoweredSaw, size: string): Capacity => {
  const numbers = (size.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((mm) => mm > 0);
  const [first, second] = numbers;
  const fallback = ASSUMED[saw];
  if (saw === "circular-saw") {
    return { width: null, depth: first === undefined ? fallback.depth : given(first) };
  }
  return {
    width: first === undefined ? fallback.width : given(first),
    depth: second === undefined ? fallback.depth : given(second),
  };
};

/** The powered saws' capacities, from the owner's tools' sizes. */
export const capacitiesFrom = (sizes: readonly ToolSize[]): Capacities => {
  const capacities: Capacities = {};
  for (const { name, size } of sizes) {
    for (const tool of toolsFrom([name])) {
      if (tool === "mitre-saw" || tool === "circular-saw") {
        capacities[tool] = capacityOf(tool, size);
      }
    }
  }
  return capacities;
};

/** A saw's capacity: as given, or as assumed. */
export const capacityFor = (capacities: Capacities, saw: PoweredSaw): Capacity =>
  capacities[saw] ?? ASSUMED[saw];

/** Why a timber lying flat is too big for a saw: too wide, too deep, or `null` when it fits. */
export const tooBig = (
  capacity: Capacity,
  section: { readonly wide: number; readonly thick: number },
): { readonly way: "wide" | "deep"; readonly limit: SourcedSize } | null => {
  if (capacity.width !== null && section.wide > capacity.width.value) {
    return { way: "wide", limit: capacity.width };
  }
  if (section.thick > capacity.depth.value) return { way: "deep", limit: capacity.depth };
  return null;
};
