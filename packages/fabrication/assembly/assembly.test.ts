import { describe, expect, it } from "vitest";
import type { Box } from "../build.ts";
import { inOrder, type Planned } from "./order.ts";
import {
  castorPlaces,
  clashesOf,
  footBrackets,
  nutsOn,
  overlaps,
  screwsFromBelow,
  type ThroughBolt,
} from "./space.ts";

// The whole Build as one (#835): parts and fixings at their real size keep their own space, the
// castors go clear of what stands on their bases, and each step can still be done after the ones
// before it. Made-up pieces, worked out by hand.

const box = (x: number, y: number, z: number, w: number, d: number, h: number): Box => ({
  x,
  y,
  z,
  w,
  d,
  h,
});

/** M6 × 60 through a 4 mm plate, a washer and a lock nut. */
const m6: ThroughBolt = { diameter: 6, length: 60, washers: 1, washer: 1.6, nut: 5, plate: 4 };

/** A base 145 wide and 45 thick, 550 long front to back, its top at 131.6. */
const base = box(0, 0, 86.6, 145, 550, 45);
/** A 95 × 45 leg standing on it, 45 in from the front, as a framed bench's is. */
const leg = box(0, 45, 131.6, 95, 45, 700);
const plate = { length: 80, width: 60 };

describe("what a castor's bolts leave on its base", () => {
  it("is each nut, a washer wide, standing as high as the bolt's end past the wood", () => {
    // 60 less the plate's 4 and the base's 45: 11 up, more than the washer and nut's 6.6.
    const [first] = nutsOn(box(42.5, 10, 86.6, 60, 80, 0), base, m6, 4);
    expect(first).toEqual(box(46.5, 14, 131.6, 12, 12, 11));
  });
});

describe("where a castor goes", () => {
  it("goes a fingernail in when nothing stands over its nuts", () => {
    const placed = castorPlaces({ base, plate, bolt: m6, count: 4, standing: [] });
    expect(placed?.insets).toEqual([10, 10]);
  });

  it("moves along the base until its nuts are clear of the leg standing there", () => {
    const back = box(0, 460, 131.6, 95, 45, 700);
    const placed = castorPlaces({ base, plate, bolt: m6, count: 4, standing: [leg, back] });
    // The leg's inner face is 90 in; the nearest washer's edge is 4 in from the plate's end, and
    // stays 5 clear: 91, and 95 to say.
    expect(placed?.insets).toEqual([95, 95]);
    for (const at of placed?.plates ?? []) {
      for (const nut of nutsOn(at, base, m6, 4)) {
        expect(overlaps(nut, leg) || overlaps(nut, back)).toBe(false);
      }
    }
  });

  it("can't move when the base is too short for two castors clear of its legs", () => {
    const short = box(0, 0, 86.6, 145, 250, 45);
    const legs = [box(0, 45, 131.6, 95, 45, 700), box(0, 160, 131.6, 95, 45, 700)];
    expect(castorPlaces({ base: short, plate, bolt: m6, count: 4, standing: legs })).toBe(
      undefined,
    );
  });

  it("goes on coach screws from below in a base thick enough to hold them, nothing through", () => {
    // 6 diameters into the wood, and its point 5 short of the top: 40 through a 4 mm plate.
    expect(screwsFromBelow({ diameter: 6, plate: 4, base: 45 })).toBe(40);
    expect(screwsFromBelow({ diameter: 6, plate: 4, base: 22 })).toBe(undefined);
  });
});

describe("the brackets at a foot", () => {
  it("go towards the middle and towards the base's end, clear of the castor moved past the leg", () => {
    const brackets = footBrackets({
      feet: [leg],
      bases: [base],
      middle: { x: 700, y: 275 },
      arm: 40,
    });
    // One up the leg's face towards the middle (x 95), one up its face towards the front (y 45).
    expect(brackets.some((plate) => plate.x === 95)).toBe(true);
    expect(brackets.some((plate) => plate.y + plate.d === 45 && plate.d === 40)).toBe(true);
    const placed = castorPlaces({
      base,
      plate,
      bolt: m6,
      count: 4,
      standing: [leg, ...brackets],
    });
    expect(placed?.insets[0]).toBe(95);
  });

  it("go towards the other foot when the base's end has no room for an arm", () => {
    const atEnd = box(0, 0, 131.6, 95, 45, 700);
    const brackets = footBrackets({
      feet: [atEnd],
      bases: [base],
      middle: { x: 700, y: 275 },
      arm: 40,
    });
    expect(brackets.every((plate) => plate.y >= 0)).toBe(true);
  });
});

describe("clashes", () => {
  it("are what takes another's space; touching face to face isn't one", () => {
    const nuts = { name: "M6 nuts", boxes: nutsOn(box(42.5, 10, 86.6, 60, 80, 0), base, m6, 4) };
    expect(
      clashesOf([{ name: "Castor bases", boxes: [base] }, { name: "Legs", boxes: [leg] }, nuts]),
    ).toEqual([{ what: "Legs", with: "M6 nuts" }]);
  });
});

describe("the steps' order", () => {
  /** Screwing down into a base's top from above: the drill's reach over the spot. */
  const from = (x: number, y: number, z: number) => box(x - 15, y - 15, z, 30, 30, 200);
  const cut: Planned = { id: "cut", adds: [], reaches: [], needs: [] };

  it("moves a step that can't reach its screws before the step whose piece is in the way", () => {
    const shelf: Planned = {
      id: "shelf",
      adds: [box(0, 0, 250, 600, 400, 18)],
      reaches: [],
      needs: ["cut"],
    };
    // A cleat screwed from above at 100 up: the shelf over it, fitted first, covers its screws.
    const cleat: Planned = {
      id: "cleat",
      adds: [box(0, 0, 80, 600, 45, 20)],
      reaches: [from(100, 20, 100)],
      needs: ["cut"],
    };
    expect(inOrder([cut, shelf, cleat])).toEqual({
      order: ["cut", "cleat", "shelf"],
      blocked: [],
    });
  });

  it("says so when the step it needs is the one in its way", () => {
    const frame: Planned = {
      id: "frame",
      adds: [box(0, 0, 250, 600, 400, 18)],
      reaches: [],
      needs: ["cut"],
    };
    const fixing: Planned = {
      id: "fixing",
      adds: [],
      reaches: [from(100, 20, 100)],
      needs: ["frame"],
    };
    expect(inOrder([cut, frame, fixing])).toEqual({
      order: ["cut", "frame", "fixing"],
      blocked: [{ step: "fixing", by: "frame" }],
    });
  });
});
