// The golden bench (#696): the garage workbench's real sizes, hand-checked, with invented names,
// shops, links and prices. Every size says where it came from, as a Build's must.

const measured = (value: number) => ({ value, unit: "mm", source: { kind: "measured" } }) as const;
const specified = (value: number, reference: string) =>
  ({ value, unit: "mm", source: { kind: "specified", reference } }) as const;
const assumed = (value: number) => ({ value, unit: "mm", source: { kind: "assumed" } }) as const;

const plywood = {
  name: "18 mm plywood",
  thickness: specified(18, "Panel Cutters' page"),
  width: specified(1220, "Panel Cutters' page"),
  length: specified(2440, "Panel Cutters' page"),
  price: { pence: 5000, shop: "Panel Cutters", link: "https://shop.example/plywood-18" },
};

export const goldenBench = {
  length: measured(1500),
  depth: measured(600),
  height: measured(900),
  kerf: assumed(3),
  top: { sheet: plywood, overhang: assumed(25) },
  frame: {
    legs: "corners",
    timber: {
      name: "45 × 95 C16",
      thickness: specified(45, "Woodstore's page"),
      width: specified(95, "Woodstore's page"),
      length: specified(2400, "Woodstore's page"),
      price: { pence: 680, shop: "Woodstore", link: "https://shop.example/c16-45x95" },
    },
    wide: {
      name: "45 × 145 C16",
      thickness: specified(45, "Woodstore's page"),
      width: specified(145, "Woodstore's page"),
      length: specified(2400, "Woodstore's page"),
      price: { pence: 1200, shop: "Woodstore", link: "https://shop.example/c16-45x145" },
    },
  },
  shelf: { on: true, height: measured(250), sheet: plywood },
  braces: { rear: true, ends: true, sheet: plywood },
  castors: {
    name: "Wheelwright TD60 castors",
    height: specified(86.6, "Wheel Works' page"),
    price: { pence: 4999, packOf: 4, shop: "Wheel Works", link: "https://shop.example/td60" },
    plate: {
      length: specified(80, "Wheel Works' page"),
      width: specified(60, "Wheel Works' page"),
      thickness: specified(4, "Wheel Works' page"),
    },
    boltsEach: 4,
    bolt: {
      diameter: specified(6, "M6"),
      pitch: specified(1, "M6 coarse thread"),
      length: specified(50, "Fixings Direct's page"),
      price: { pence: 15, shop: "Fixings Direct" },
    },
    washer: {
      thickness: specified(1.6, "M6 washer"),
      perBolt: 2,
      price: { pence: 365, packOf: 100, shop: "Fixings Direct" },
    },
    nut: {
      height: specified(5, "M6 lock nut"),
      price: { pence: 350, packOf: 50, shop: "Fixings Direct" },
    },
  },
  fixings: {
    frameScrews: {
      name: "5 × 80 screws",
      price: { pence: 520, packOf: 100, shop: "Woodstore" },
    },
    sheetScrews: {
      name: "4 × 40 screws",
      price: { pence: 420, packOf: 200, shop: "Woodstore" },
    },
    brackets: { name: "40 mm angle brackets", price: { pence: 89, shop: "Fixings Direct" } },
    bracketScrews: {
      name: "4 × 30 screws",
      price: { pence: 380, packOf: 200, shop: "Woodstore" },
    },
  },
  tools: [
    "tape-measure",
    "pencil",
    "square",
    "hand-saw",
    "folding-workbench",
    "clamps",
    "drill-driver",
    "drill-bits",
    "safety-glasses",
  ],
} as const;
