import { pdfOf, pngOf, type TestFile } from "../test/testing.ts";

// The made-up photos and PDFs the context eval's scenarios attach (#78). Everything here is invented.

/**
 * A made-up photo for the attachment scenarios: a landscape, blue sky over green grass, with a
 * yellow sun in the top right corner.
 */
export const LANDSCAPE: TestFile = {
  name: "IMG_3107.png",
  type: "image/png",
  bytes: pngOf(400, 300, (x, y) => {
    if ((x - 320) ** 2 + (y - 60) ** 2 < 35 ** 2) return [250, 210, 40];
    return y < 180 ? [110, 170, 230] : [60, 150, 60];
  }),
};

/** Ink, a window's blue and the paper of the brochure plan below. */
const INK = [30, 30, 30] as const;
const GLASS = [90, 150, 220] as const;
const PAPER = [255, 255, 255] as const;

/** A room's walls on the brochure plan, in cm from its left and back walls. */
const BROCHURE_ROOMS = [
  { left: 0, back: 0, right: 700, front: 784 },
  { left: 0, back: 0, right: 179, front: 153 },
  { left: 0, back: 163, right: 170, front: 253 },
  { left: 191, back: 0, right: 460, front: 252 },
  { left: 460, back: 0, right: 700, front: 252 },
  { left: 0, back: 270, right: 274, front: 784 },
  { left: 274, back: 300, right: 393, front: 600 },
  { left: 274, back: 600, right: 393, front: 784 },
  { left: 393, back: 264, right: 700, front: 710 },
];

/** Its windows and French doors, along the back or front wall. */
const BROCHURE_GLASS = [
  { from: 450, to: 632, at: 784 },
  { from: 500, to: 647, at: 0 },
  { from: 250, to: 350, at: 0 },
];

/**
 * A made-up developer's brochure plan of a ground floor (#661), drawn as brochures are, with no
 * words or sizes: rooms, windows and French doors in blue, the garage door's dashed gap, and the
 * stairs hatched. Nothing on it is a size anyone gave.
 */
export const BROCHURE_PLAN: TestFile = {
  name: "ground-floor-brochure.png",
  type: "image/png",
  bytes: pngOf(600, 680, (px, py) => {
    const x = (px - 20) * 1.25;
    const y = (py - 20) * 1.25;
    const near = (a: number, b: number) => Math.abs(a - b) <= 3;
    const between = (v: number, from: number, to: number) => v >= from && v <= to;
    if (BROCHURE_GLASS.some((glass) => near(y, glass.at) && between(x, glass.from, glass.to))) {
      return GLASS;
    }
    if (near(y, 784) && between(x, 30, 243)) return Math.floor(x / 12) % 2 === 0 ? INK : PAPER;
    if (between(x, 274, 393) && between(y, 300, 600) && Math.round(y) % 15 < 2) return INK;
    const wall = BROCHURE_ROOMS.some(
      (room) =>
        ((near(x, room.left) || near(x, room.right)) && between(y, room.back, room.front)) ||
        ((near(y, room.back) || near(y, room.front)) && between(x, room.left, room.right)),
    );
    return wall ? INK : PAPER;
  }),
};

/**
 * A made-up photo of an end frame laid out on a grey floor, from above (#784): two pale legs on
 * their edges, narrow from above, with a wider rail across their tops, half size.
 */
export const END_FRAME: TestFile = {
  name: "IMG_5120.png",
  type: "image/png",
  bytes: pngOf(330, 475, (px, py) => {
    const x = px - 50;
    const y = py - 50;
    const leg = y >= 0 && y < 375 && ((x >= 0 && x < 22) || (x >= 208 && x < 230));
    const rail = x >= 0 && x < 230 && y >= 0 && y < 48;
    return leg || rail ? [222, 190, 140] : [120, 120, 125];
  }),
};

/** A made-up rack manual for the attachment scenarios. */
export const RACK_MANUAL: TestFile = {
  name: "titan-t3-manual.pdf",
  type: "application/pdf",
  bytes: pdfOf([
    "Titan T-3 Power Rack: owner's manual",
    "Assembly takes about 90 minutes with two people.",
    "Safety: the J-hooks are rated to a maximum load of 340 kg each.",
    "The J-hook cup is 64 mm across, for bars with a 28-32 mm shaft.",
    "Bolt torque for the uprights: 45 Nm.",
  ]),
};

/** A made-up photo of an alcove: a plain wall between two darker sides, nothing of a known size. */
export const ALCOVE: TestFile = {
  name: "IMG_4410.png",
  type: "image/png",
  bytes: pngOf(300, 400, (x) => (x < 60 || x > 240 ? [150, 140, 130] : [215, 210, 200])),
};

/** A made-up spec sheet for a car the owner doesn't have: the estate, not their hatchback. */
export const ESTATE_SPEC: TestFile = {
  name: "kestrel-k7-estate-spec.pdf",
  type: "application/pdf",
  bytes: pdfOf([
    "Kestrel K7 Estate (2019-2023): technical data",
    "Boot length, seats up: 1080 mm",
    "Boot width between the wheel arches: 1010 mm",
    "Boot opening height: 720 mm",
  ]),
};
