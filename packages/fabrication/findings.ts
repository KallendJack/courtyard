import type { Finding, Step } from "./build.ts";
import { TOOL_NAMES, type Tool } from "./tools.ts";

// The making rules code can check, for every template (ADR 0036). The rest are in
// docs/ai-conduct.md's planning answers.

/** Bolt lengths a shop usually has, mm. */
const BOLT_LENGTHS = [16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120];
/** The least that holds: two whole threads showing past the nut. */
const THREADS_PAST = 2;

const tenth = (mm: number) => Math.round(mm * 10) / 10;

/**
 * A bolt checked against what it passes through: long enough for every layer and the nut, with
 * two threads past it. `null` when it is.
 */
export const boltCheck = (bolt: {
  name: string;
  length: number;
  pitch: number;
  through: readonly { what: string; mm: number }[];
}): Finding | null => {
  const through = [...bolt.through, { what: "two threads", mm: THREADS_PAST * bolt.pitch }];
  const needed = tenth(through.reduce((sum, layer) => sum + layer.mm, 0));
  if (bolt.length >= needed) return null;
  const use = BOLT_LENGTHS.find((length) => length >= needed) ?? Math.ceil(needed / 10) * 10;
  return { kind: "fixing-too-short", fixing: bolt.name, length: bolt.length, needed, through, use };
};

/** The tools and kit the steps need that aren't to hand, each with the steps that need it. */
export const toolsMissing = (steps: readonly Step[]): Finding | null => {
  const missing = new Map<Tool, number[]>();
  for (const step of steps) {
    for (const { tool, toHand } of [...step.tools, ...step.safety]) {
      if (toHand) continue;
      const numbers = missing.get(tool) ?? [];
      if (!numbers.includes(step.number)) missing.set(tool, [...numbers, step.number]);
    }
  }
  if (missing.size === 0) return null;
  return {
    kind: "tools-missing",
    tools: [...missing].map(([tool, steps]) => ({ tool, name: TOOL_NAMES[tool], steps })),
  };
};

const isAssumed = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  "source" in value &&
  typeof value.source === "object" &&
  value.source !== null &&
  "kind" in value.source &&
  value.source.kind === "assumed";

/** Every size in the parameters nobody measured or read from a maker, by where it is. */
export const assumedSizes = (parameters: unknown): Finding | null => {
  const sizes: string[] = [];
  const walk = (value: unknown, path: readonly string[]) => {
    if (isAssumed(value)) {
      sizes.push(path.join("."));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, inner] of Object.entries(value)) walk(inner, [...path, key]);
  };
  walk(parameters, []);
  return sizes.length === 0 ? null : { kind: "assumed", sizes };
};
