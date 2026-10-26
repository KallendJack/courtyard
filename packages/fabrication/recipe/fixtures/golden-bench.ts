import { goldenBench } from "../../bench/fixtures/golden.ts";

// The golden bench (#696) as a recipe (#769), written by hand as a model would write it: its stock,
// its legs, end frames and long rails, the top and its support, the shelf, the braces, the castor
// bases with a castor fitted under each end (#770), and the joints that hold them. Its stock is the
// golden bench's own, so its Build must be the golden bench's to the last number.

const { frame, top, shelf, castors, fixings } = goldenBench;
const { boltsEach, bolt, washer, nut, ...castor } = castors;

export const goldenBenchRecipe = {
  size: { length: goldenBench.length, depth: goldenBench.depth, height: goldenBench.height },
  kerf: goldenBench.kerf,
  stock: [
    { kind: "timber", id: "45-95-c16", ...frame.timber },
    { kind: "timber", id: "45-145-c16", ...frame.wide },
    { kind: "sheet", id: "18-mm-plywood", ...top.sheet },
    { kind: "fixing", id: "5-80-screws", ...fixings.frameScrews },
    { kind: "fixing", id: "4-40-screws", ...fixings.sheetScrews },
    { kind: "fixing", id: "40-mm-angle-brackets", ...fixings.brackets },
    { kind: "fixing", id: "4-30-screws", ...fixings.bracketScrews },
    { kind: "castor", id: "wheelwright-td60-castors", ...castor },
  ],
  groups: [
    { kind: "legs", id: "legs", stock: "45-95-c16", at: "corners" },
    {
      kind: "frame",
      id: "end-frames",
      stock: "45-95-c16",
      legs: "legs",
      sides: "ends",
      lower: shelf.height,
    },
    {
      kind: "frame",
      id: "long-rails",
      stock: "45-95-c16",
      legs: "legs",
      sides: "front-and-back",
      lower: shelf.height,
    },
    { kind: "shelf", id: "shelf", stock: "18-mm-plywood", on: "long-rails", rests: "rails" },
    {
      kind: "brace",
      id: "braces",
      stock: "18-mm-plywood",
      on: "end-frames",
      sides: ["back", "ends"],
    },
  ],
  pieces: [
    { kind: "panel", id: "top", stock: "18-mm-plywood", place: "top", overhang: top.overhang },
    {
      kind: "member",
      id: "top-support",
      stock: "45-145-c16",
      place: "across-the-middle",
      under: "top",
    },
    {
      kind: "member",
      id: "castor-bases",
      stock: "45-145-c16",
      place: "under-each-end",
      under: "end-frames",
    },
    {
      kind: "fitted",
      id: "castors",
      stock: "wheelwright-td60-castors",
      at: "each-end",
      under: "castor-bases",
    },
    {
      kind: "member",
      id: "shelf-support",
      stock: "45-95-c16",
      place: "across-the-middle",
      under: "shelf",
    },
  ],
  joints: [
    { kind: "screwed", joins: ["legs", "end-frames"], fixing: "5-80-screws" },
    { kind: "screwed", joins: ["end-frames", "long-rails"], fixing: "5-80-screws" },
    {
      kind: "bracket",
      joins: ["legs", "castor-bases"],
      fixing: "40-mm-angle-brackets",
      screws: "4-30-screws",
    },
    {
      kind: "bolted",
      joins: ["castors", "castor-bases"],
      each: boltsEach,
      bolt,
      washer,
      nut,
    },
    {
      kind: "bracket",
      joins: ["top-support", "long-rails"],
      fixing: "40-mm-angle-brackets",
      screws: "4-30-screws",
    },
    {
      kind: "bracket",
      joins: ["shelf-support", "long-rails"],
      fixing: "40-mm-angle-brackets",
      screws: "4-30-screws",
    },
    { kind: "sheet-screwed", joins: ["shelf", "long-rails"], fixing: "4-40-screws" },
    { kind: "sheet-screwed", joins: ["braces", "end-frames"], fixing: "4-40-screws" },
    { kind: "sheet-screwed", joins: ["top", "long-rails"], fixing: "4-40-screws" },
  ],
  damp: false,
  prices: goldenBench.prices,
  tools: goldenBench.tools,
} as const;
