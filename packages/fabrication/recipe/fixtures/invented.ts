// Invented recipes (#770), none of them a template's: a box, a freestanding rack and a stand, each
// written as a model would write it. Names, shops, links and prices are made up.

const measured = (value: number) => ({ value, unit: "mm", source: { kind: "measured" } }) as const;
const specified = (value: number, reference: string) =>
  ({ value, unit: "mm", source: { kind: "specified", reference } }) as const;

const plywood = {
  kind: "sheet",
  id: "18-mm-plywood",
  name: "18 mm plywood",
  thickness: specified(18, "Panel Cutters' page"),
  width: specified(1220, "Panel Cutters' page"),
  length: specified(2440, "Panel Cutters' page"),
  price: { pence: 5000, shop: "Panel Cutters", link: "https://shop.example/plywood-18" },
} as const;

const sheetScrews = {
  kind: "fixing",
  id: "4-40-screws",
  name: "4 × 40 screws",
  price: { pence: 420, packOf: 200, shop: "Woodstore" },
} as const;

/** A carcass open at the front, 800 × 400 × 900, with two shelves on cleats. */
export const shelfBox = {
  size: { length: measured(800), depth: measured(400), height: measured(900) },
  kerf: specified(3, "Hand saw's set"),
  stock: [plywood, sheetScrews],
  groups: [
    { kind: "box", id: "cupboard", stock: "18-mm-plywood", open: "front", fixing: "4-40-screws" },
    { kind: "shelf", id: "lower-shelf", stock: "18-mm-plywood", on: "cupboard", rests: "cleats" },
    { kind: "shelf", id: "upper-shelf", stock: "18-mm-plywood", on: "cupboard", rests: "cleats" },
  ],
} as const;

const cls = {
  kind: "timber",
  id: "38-89-cls",
  name: "38 × 89 CLS",
  thickness: specified(38, "Woodstore's page"),
  width: specified(89, "Woodstore's page"),
  length: specified(2400, "Woodstore's page"),
  price: { pence: 630, shop: "Woodstore", link: "https://shop.example/cls-38x89" },
} as const;

const osb = {
  kind: "sheet",
  id: "18-mm-osb",
  name: "18 mm OSB",
  thickness: specified(18, "Panel Cutters' page"),
  width: specified(1220, "Panel Cutters' page"),
  length: specified(2440, "Panel Cutters' page"),
  price: { pence: 3200, shop: "Panel Cutters", link: "https://shop.example/osb-18" },
} as const;

/** A rack 1200 × 400 × 1000 standing free: CLS legs and frames, a shelf, an OSB top, a back brace. */
export const rack = {
  size: { length: measured(1200), depth: measured(400), height: measured(1000) },
  kerf: specified(3, "Hand saw's set"),
  stock: [
    cls,
    osb,
    {
      kind: "fixing",
      id: "5-70-screws",
      name: "5 × 70 screws",
      price: { pence: 480, packOf: 100, shop: "Woodstore" },
    },
    sheetScrews,
  ],
  groups: [
    { kind: "legs", id: "legs", stock: "38-89-cls", at: "corners" },
    {
      kind: "frame",
      id: "end-frames",
      stock: "38-89-cls",
      legs: "legs",
      sides: "ends",
      lower: measured(300),
    },
    {
      kind: "frame",
      id: "long-rails",
      stock: "38-89-cls",
      legs: "legs",
      sides: "front-and-back",
      lower: measured(300),
    },
    { kind: "shelf", id: "shelf", stock: "18-mm-osb", on: "long-rails", rests: "rails" },
    { kind: "brace", id: "brace", stock: "18-mm-osb", on: "long-rails", sides: ["back"] },
  ],
  pieces: [{ kind: "panel", id: "top", stock: "18-mm-osb", place: "top", overhang: measured(20) }],
  joints: [
    { kind: "screwed", joins: ["legs", "end-frames"], fixing: "5-70-screws" },
    { kind: "screwed", joins: ["end-frames", "long-rails"], fixing: "5-70-screws" },
    { kind: "sheet-screwed", joins: ["shelf", "long-rails"], fixing: "4-40-screws" },
    { kind: "sheet-screwed", joins: ["brace", "long-rails"], fixing: "4-40-screws" },
    { kind: "sheet-screwed", joins: ["top", "long-rails"], fixing: "4-40-screws" },
  ],
} as const;

/** A saw stand 900 × 500 × 800 on castors: legs and long rails, a top, bases with castors. */
export const sawStand = {
  size: { length: measured(900), depth: measured(500), height: measured(800) },
  kerf: specified(3, "Hand saw's set"),
  stock: [
    {
      kind: "timber",
      id: "45-95-c16",
      name: "45 × 95 C16",
      thickness: specified(45, "Woodstore's page"),
      width: specified(95, "Woodstore's page"),
      length: specified(2400, "Woodstore's page"),
      price: { pence: 680, shop: "Woodstore", link: "https://shop.example/c16-45x95" },
    },
    {
      kind: "timber",
      id: "45-145-c16",
      name: "45 × 145 C16",
      thickness: specified(45, "Woodstore's page"),
      width: specified(145, "Woodstore's page"),
      length: specified(2400, "Woodstore's page"),
      price: { pence: 1200, shop: "Woodstore", link: "https://shop.example/c16-45x145" },
    },
    plywood,
    {
      kind: "fixing",
      id: "5-80-screws",
      name: "5 × 80 screws",
      price: { pence: 520, packOf: 100, shop: "Woodstore" },
    },
    sheetScrews,
    {
      kind: "fixing",
      id: "angle-brackets",
      name: "40 mm angle brackets",
      price: { pence: 89, shop: "Fixings Direct" },
    },
    {
      kind: "castor",
      id: "castors",
      name: "Rollwell 75 castors",
      height: specified(75, "Wheel Works' page"),
      price: { pence: 2999, packOf: 4, shop: "Wheel Works" },
      plate: {
        length: specified(60, "Wheel Works' page"),
        width: specified(60, "Wheel Works' page"),
        thickness: specified(3, "Wheel Works' page"),
      },
    },
  ],
  groups: [
    { kind: "legs", id: "legs", stock: "45-95-c16", at: "corners" },
    {
      kind: "frame",
      id: "long-rails",
      stock: "45-95-c16",
      legs: "legs",
      sides: "front-and-back",
      lower: measured(200),
    },
  ],
  pieces: [
    { kind: "panel", id: "top", stock: "18-mm-plywood", place: "top", overhang: measured(0) },
    { kind: "member", id: "bases", stock: "45-145-c16", place: "under-each-end", under: "legs" },
    { kind: "fitted", id: "wheels", stock: "castors", at: "each-end", under: "bases" },
  ],
  joints: [
    { kind: "screwed", joins: ["legs", "long-rails"], fixing: "5-80-screws" },
    { kind: "bracket", joins: ["legs", "bases"], fixing: "angle-brackets" },
    {
      kind: "bolted",
      joins: ["wheels", "bases"],
      each: 4,
      bolt: {
        diameter: specified(6, "M6"),
        pitch: specified(1, "M6 coarse thread"),
        length: specified(40, "Fixings Direct's page"),
        price: { pence: 12, shop: "Fixings Direct" },
      },
      washer: {
        thickness: specified(1.6, "M6 washer"),
        perBolt: 1,
        price: { pence: 365, packOf: 100, shop: "Fixings Direct" },
      },
      nut: { height: specified(5, "M6 lock nut"), price: { pence: 350, packOf: 50 } },
    },
    { kind: "sheet-screwed", joins: ["top", "long-rails"], fixing: "4-40-screws" },
  ],
} as const;
