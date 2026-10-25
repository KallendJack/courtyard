import type { BoltLength, Finding, Step } from "./build.ts";
import { TOOL_NAMES, type Tool } from "./tools.ts";

// The making rules code can check, for every template (ADR 0036). The rest are in
// docs/ai-conduct.md's planning answers.

/** Bolt lengths a shop usually has, mm. */
const BOLT_LENGTHS = [16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120];
/** The least that holds: two whole threads showing past the nut. */
const THREADS_PAST = 2;

const tenth = (mm: number) => Math.round(mm * 10) / 10;

/** Bolts as a Thing's name says them: "Castor bolts M6 × 60", "M6x60 bolts". */
const BOLT_NAMED = /\bm(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i;
/** What a bolt can be swapped for: a bolt or a set screw, never a wood or machine screw. */
const BOLT_KIND = /\b(bolts?|set ?screws?)\b/i;

/**
 * The lengths of the owner's own bolts of a thread, by their Things' names: "M6 × 16 screws"
 * aren't bolts, and an M8 isn't an M6.
 */
const boltsHad = (have: readonly string[], thread: number) =>
  have.flatMap((name) => {
    const named = BOLT_KIND.test(name) ? BOLT_NAMED.exec(name) : null;
    return named && Number(named[1]) === thread ? [Number(named[2])] : [];
  });

/**
 * A bolt worked out against what it passes through: long enough for every layer and the nut,
 * with two threads past it. The length to use is the one given when that's enough, else the
 * shortest usual length that is, which the steps fit and the buy list buys (#699); the old one is
 * never said (#763). The owner's own bolts of its thread (`have`, their Things' names) are said
 * short, by how much, only when every one they have is: the longest, the nearest to doing.
 */
export const boltLength = (bolt: {
  thread: number;
  length: number;
  pitch: number;
  through: readonly { what: string; mm: number }[];
  have: readonly string[];
}): { use: number; length: BoltLength } => {
  const through = [...bolt.through, { what: "two threads", mm: THREADS_PAST * bolt.pitch }];
  const needed = tenth(through.reduce((sum, layer) => sum + layer.mm, 0));
  const use =
    bolt.length >= needed
      ? bolt.length
      : (BOLT_LENGTHS.find((length) => length >= needed) ?? Math.ceil(needed / 10) * 10);
  const had = boltsHad(bolt.have, bolt.thread);
  const longest = had.length === 0 ? undefined : Math.max(...had);
  return {
    use,
    length: {
      needed,
      through,
      ...(longest !== undefined && longest < needed
        ? { yoursShort: { name: `M${bolt.thread} × ${longest}`, by: tenth(needed - longest) } }
        : {}),
    },
  };
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
