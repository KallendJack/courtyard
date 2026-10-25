// The golden printed parts (#702): a battery holster and a castor shim, with invented sizes,
// names and references. Every real thing's size says where it came from, as a Build's must.

const measured = (value: number) => ({ value, unit: "mm", source: { kind: "measured" } }) as const;
const specified = (value: number, reference: string) =>
  ({ value, unit: "mm", source: { kind: "specified", reference } }) as const;
const assumed = (value: number) => ({ value, unit: "mm", source: { kind: "assumed" } }) as const;

/** A holster for an 18 V battery: its width assumed, the rest measured, two countersunk screws. */
export const goldenHolster = {
  holds: { name: "battery", width: assumed(76), depth: measured(115), height: measured(66) },
  walls: 4,
  screws: {
    screw: { name: "4 × 30 mm wood screws", diameter: specified(4, "Screwshop's page") },
    count: 2,
    countersunk: true,
  },
  tools: ["pencil", "drill-driver", "drill-bits", "safety-glasses"],
};

/** A 10 mm shim for a castor whose plate is 80 × 60, its M8 bolts 60 × 40 apart. */
export const goldenShim = {
  plate: { width: specified(80, "Castor Co's page"), depth: specified(60, "Castor Co's page") },
  thickness: 10,
  bolts: {
    screw: { name: "M8 bolts", diameter: specified(8, "Castor Co's page") },
    across: specified(60, "Castor Co's page"),
    back: specified(40, "Castor Co's page"),
  },
  count: 4,
};
