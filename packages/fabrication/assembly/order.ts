import type { Box } from "../build.ts";
import { overlaps } from "./space.ts";

// Every step still doable after the ones before it (#835): nothing an earlier step fitted stands
// where a later one marks, drills, screws or turns a nut, nor where its drill or spanner has to
// be. A step that can't reach is moved before the step that's in its way, when nothing it needs
// comes after that; else it stays, and says why.

/** How far a drill and its bit reach out from where they drill, mm: a drill driver's length. */
export const DRILL_REACH = 200;
/** How far a spanner or socket stands up from the nut it turns, mm. */
export const SPANNER_REACH = 60;

/**
 * A step as the order sees it: what it puts on the Build, the space its tools need to reach its
 * work (each a box out from where it's done, along the way the tool comes in), and the steps it
 * needs done first, by ID.
 */
export type Planned = {
  readonly id: string;
  readonly adds: readonly Box[];
  readonly reaches: readonly Box[];
  readonly needs: readonly string[];
};

/** A step that can't reach its work, and the step whose pieces are in the way, by ID. */
export type Blocked = { readonly step: string; readonly by: string };

/**
 * The steps in an order each can be done in: by ID, and those that can't be, each with what's in
 * its way. A step moves to just before the first step in its way, when what it needs is done by
 * then and nothing between needs it.
 */
export const inOrder = (
  steps: readonly Planned[],
): { order: readonly string[]; blocked: readonly Blocked[] } => {
  const order = [...steps];
  const blocked: Blocked[] = [];
  const stuck = new Set<string>();
  for (let tries = 0; tries <= steps.length * steps.length; tries++) {
    const found = firstBlocked(order, stuck);
    if (found === undefined) break;
    const { at, by } = found;
    const step = order[at] as Planned;
    const before = order.slice(0, by).map((each) => each.id);
    const between = order.slice(by, at);
    const movable =
      step.needs.every((id) => before.includes(id)) &&
      between.every((each) => !each.needs.includes(step.id));
    if (movable) {
      order.splice(at, 1);
      order.splice(by, 0, step);
      continue;
    }
    stuck.add(step.id);
    blocked.push({ step: step.id, by: (order[by] as Planned).id });
  }
  return { order: order.map((each) => each.id), blocked };
};

/** The first step whose reach an earlier step's pieces stand in, and the first such step. */
const firstBlocked = (order: readonly Planned[], stuck: ReadonlySet<string>) => {
  for (const [at, step] of order.entries()) {
    if (stuck.has(step.id)) continue;
    const by = order
      .slice(0, at)
      .findIndex((earlier) =>
        earlier.adds.some((piece) => step.reaches.some((reach) => overlaps(piece, reach))),
      );
    if (by >= 0) return { at, by };
  }
  return undefined;
};
