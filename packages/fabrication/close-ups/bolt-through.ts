import type { CloseUp } from "../close-up.ts";

// A bolt through a plate (#813, from the castor step's close-ups, #783; Paper, 2 · Agreed,
// "Fabrication · Castors in 3D, your kit · Fold (#783)"): tightening, with the head held and the
// nut turned by the owner's own tools drawn as their shape, and one bolt taken apart, so it's
// plain which side each piece goes. They're spaced for their words, which read the same size
// whatever a drawing's scale, so the pieces taken apart are spread wider than they are.

/** What holds a bolt's head or turns its nut, as the close-ups draw it. */
export type Holder = "open-spanner" | "adjustable" | "pliers" | "socket";

/**
 * A bolt through something's plate (a castor's) and the piece it's fixed to: the bolt's
 * diameter, the plate's length and thickness and what it's on (`name`, upside down, `high`), the
 * piece's label and thickness, the washers under the nut and the nut's height.
 */
export type BoltThrough = {
  readonly bolt: number;
  readonly plate: {
    readonly name: string;
    readonly length: number;
    readonly thick: number;
    readonly high: number;
  };
  readonly piece: { readonly label: string; readonly thick: number };
  readonly washers: { readonly count: number; readonly thick: number };
  readonly nut: number;
};

/** How far a spanner's handle reaches from the head to the plate's body, as drawn. */
const REACH = 110;
/** Where the second half of the tightening close-up starts, from the top: under the first. */
const UNDER = 100;

/**
 * Tightening a bolt, drawn top to bottom as its board has it: on top, the head held, its tool's
 * handle resting against the body on the plate so it can't spin; under it, the nut turned clockwise with the owner's tool, named as
 * theirs, until the washer bites.
 */
export const tightenCloseUp = (
  through: BoltThrough,
  hold: { head: Holder; nut: Holder; size: number | undefined; yours: boolean },
): CloseUp => {
  const across = hold.size ?? 2 * through.bolt;
  const thing = through.plate.name;
  const x = 22;
  const y = 46;
  const body = { x: x + REACH, y: y - 25, w: 56, h: 50 };
  const named: Readonly<Record<Holder, string>> = {
    "open-spanner": hold.size === undefined ? "spanner" : `${hold.size} mm spanner`,
    adjustable: "adjustable",
    pliers: "pliers",
    socket: "socket",
  };
  const bites = through.washers.count > 0 ? "the washer" : "the nut";
  return {
    title: "Tighten",
    type: "bolt-through",
    width: body.x + body.w,
    height: UNDER + 92,
    pieces: [{ label: thing, ...body }],
    dimensions: [],
    fixings: [],
    shapes: [
      { kind: hold.head, x, y, jaw: across, length: REACH, turn: 0 },
      { kind: "hex", x, y, across },
      { kind: hold.nut, x, y: UNDER + y, jaw: across, length: REACH, turn: 0 },
      { kind: "hex", x, y: UNDER + y, across },
      { kind: "clockwise", x, y: UNDER + y, r: 2 * across },
    ],
    labels: [
      { x: 0, y: 6, says: "On top: hold the head", heading: true },
      { x: body.x + 6, y, says: thing },
      {
        x: 0,
        y: 84,
        says:
          hold.head === "pliers" ? `handles rest on the ${thing}` : `handle rests on the ${thing}`,
      },
      { x: 0, y: UNDER + 6, says: "Under: turn the nut", heading: true },
      {
        x: 0,
        y: UNDER + 84,
        says: `${hold.yours ? "your" : "a"} ${named[hold.nut]}, clockwise`,
        key: true,
      },
    ],
    notes: [`Stop when ${bites} bites.`],
  };
};

/** How far apart a bolt's pieces are drawn, taken apart: room for each one's word. */
const APART = 16;

/**
 * One bolt taken apart, from the side: the plate's side on top (what's on it upside down, its
 * plate, and the bolt's head), then the piece, then underneath (the washers and the nut). The
 * washers go under the nut, against the wood, never under the head: the steel plate takes it.
 */
export const boltApartCloseUp = (through: BoltThrough, size: number | undefined): CloseUp => {
  const across = size ?? 2 * through.bolt;
  const { bolt, plate, nut } = through;
  const washer = through.washers.thick;
  // The bolt through the plate's hole near its end, what's on the plate beside it.
  const middle = 12;
  const named = plate.length + 12;
  const label = (y: number, says: string, key?: boolean) => ({
    x: named,
    y,
    says,
    ...(key ? { key } : {}),
  });

  const wheel = Math.min(48, plate.high * 0.55);
  const plateY = 22 + wheel + 14;
  const headY = plateY - APART - 4;
  const baseY = plateY + plate.thick + APART;
  const base = Math.min(through.piece.thick, 40);
  const under = baseY + base + 14;
  const washers = Array.from(
    { length: through.washers.count },
    (_, at) => under + APART + at * (washer + 4),
  );
  const nutY = (washers.at(-1) ?? under) + washer + APART;
  return {
    title: "One bolt, apart",
    type: "bolt-through",
    width: named + 70,
    height: nutY + nut + 6,
    pieces: [
      { label: through.piece.label, x: 0, y: baseY, w: plate.length, h: base },
      // The bolt's shank, through the plate and the piece, to past the nut.
      { label: "bolt", x: middle - bolt / 2, y: headY + 4, w: bolt, h: nutY + nut + 3 - headY - 4 },
      { label: "bolt", x: middle - across / 2, y: headY, w: across, h: 4 },
      ...washers.map((y) => ({
        label: "washer",
        x: middle - 0.9 * across,
        y,
        w: 1.8 * across,
        h: washer,
      })),
      { label: "nut", x: middle - across / 2, y: nutY, w: across, h: nut },
    ],
    shapes: [{ kind: "castor", x: 0, y: plateY, w: plate.length, plate: plate.thick, wheel }],
    dimensions: [],
    fixings: [],
    labels: [
      { x: 0, y: 6, says: `Top · ${plate.name} side`, heading: true },
      label(22 + wheel / 2, plate.name),
      label(headY + 2, "bolt head"),
      label(plateY + 2, "plate"),
      label(baseY + base / 2, "base"),
      { x: named, y: under, says: "Underneath", heading: true },
      ...washers
        .slice(0, 1)
        .map((y) =>
          label(y + washer / 2, washers.length > 1 ? `${washers.length} washers` : "washer", true),
        ),
      label(nutY + nut / 2, "nut"),
    ],
    notes: [
      washers.length === 0
        ? "No washer: the nut goes on against the wood."
        : "Washer only under the nut, against the wood.",
    ],
  };
};
