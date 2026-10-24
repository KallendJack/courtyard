import { FloorPlan } from "@courtyard/contract";
import type { ExpectedPlan } from "./scenarios.ts";

/**
 * An answer's `plan` blocks (#257), each checked by the contract's `FloorPlan` schema as the web
 * app checks it: the plan, or why it can't be drawn.
 */
export const plansIn = (answer: string) =>
  [...answer.matchAll(/^[ \t]*```[ \t]*plan[ \t]*\n([\s\S]*?)\n[ \t]*```/gim)].map((found) => {
    const source = found[1] ?? "";
    let json: unknown;
    try {
      json = JSON.parse(source);
    } catch {
      return { problem: `its JSON doesn't parse: ${source.slice(0, 160)}` };
    }
    const plan = FloorPlan.safeParse(json);
    return plan.success
      ? { plan: plan.data }
      : { problem: `the web app can't draw it (${plan.error.issues[0]?.message})` };
  });

/**
 * What a plan holds as sizes (#661), each named: its outline when it says it is a known size, its
 * zones' and floor things' sides, its wall things' lengths, and its doors', windows' and
 * doorways' widths. Where things are (`fromLeft`, `fromBack`, `at`) isn't a size.
 */
const sizesOn = (plan: FloorPlan) => {
  const sizes: { name: string; cm: number }[] = [];
  const add = (name: string, ...cms: (number | undefined)[]) => {
    for (const cm of cms) if (cm !== undefined) sizes.push({ name, cm });
  };
  if (plan.measured === true) add(`${plan.room}'s outline`, plan.width, plan.depth);
  for (const zone of plan.zones ?? []) add(zone.name, zone.width, zone.depth);
  for (const item of plan.items ?? []) {
    if ("wall" in item) add(item.name, item.length);
    else add(item.name, item.width, item.depth);
  }
  for (const opening of plan.openings ?? []) {
    add(`${opening.kind}${opening.name === undefined ? "" : ` (${opening.name})`}`, opening.width);
  }
  for (const partition of plan.partitions ?? []) add("doorway", partition.doorway?.width);
  return sizes;
};

/**
 * What's wrong with an answer's floor plans (#661), or null: none drawn, one the web app can't
 * draw, a size on one that it wasn't given (give or take 1 cm), a size on something nobody gave
 * one, or its outline said to be a known size, or not, other than expected.
 */
export const planMiss = (expected: ExpectedPlan, plans: ReturnType<typeof plansIn>) => {
  if (plans.length === 0) return "expected a floor plan; the answer has no plan block";
  const misses: string[] = [];
  for (const one of plans) {
    if (!("plan" in one)) {
      misses.push(`expected a plan it can draw; ${one.problem}`);
      continue;
    }
    const { plan } = one;
    for (const { name, cm } of sizesOn(plan)) {
      const lower = name.toLowerCase();
      const unsized = expected.unsized.find((word) => lower.includes(word));
      if (unsized !== undefined)
        misses.push(`${plan.room}: gave ${name} ${cm} cm; nobody gave one`);
      else if (!expected.sizes.some((given) => Math.abs(given - cm) <= 1)) {
        misses.push(`${plan.room}: gave ${name} ${cm} cm, a size it wasn't given`);
      }
    }
    if (expected.measured !== undefined && (plan.measured === true) !== expected.measured) {
      misses.push(
        `${plan.room}: expected its outline ${expected.measured ? "" : "not "}said to be a known size`,
      );
    }
  }
  return misses.length === 0 ? null : misses.join("; ");
};
