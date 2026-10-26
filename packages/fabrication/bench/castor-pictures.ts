import type { Box, CloseUp } from "../build.ts";
import type { Scene, SceneMark } from "../scene.ts";
import { TOOL_NAMES } from "../tools.ts";
import { CASTOR_INSET } from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import { type Castors, castorFixingNames } from "./parameters.ts";
import {
  at,
  box,
  JAWS,
  nameOf,
  part,
  type SceneSetting,
  toolIf,
  whole,
  workmate,
} from "./scene-pieces.ts";

// The castor step's pictures (#783; Paper, 2 · Agreed, "Fabrication · Castors in 3D, your kit ·
// Fold (#783)"): the base in 3D with a castor on it, the first bolt in and the drill through the
// plate's next hole, its words off the model; and two close-ups, tightening, with the head held
// and the nut turned by the owner's own tools drawn as their shape, and one bolt taken apart, so
// it's plain which side each piece goes. The close-ups are spaced for their words, which read the
// same size whatever a drawing's scale, so the pieces taken apart are spread wider than they are.

/**
 * A drill held straight up and down, its bit's tip at `tip`: the bit, the chuck, the body above
 * it, the grip out to one side near its top, and the battery on the grip's end.
 */
const drillAt = (tip: { x: number; y: number; z: number }, bit: number): Box[] => {
  const { x, y, z } = tip;
  const body = z + 114;
  return [
    box(x - bit / 2, y - bit / 2, z, bit, bit, 80),
    box(x - 18, y - 18, z + 80, 36, 36, 34),
    box(x - 35, y - 35, body, 70, 70, 170),
    box(x - 155, y - 25, body + 115, 120, 50, 50),
    box(x - 225, y - 45, body + 60, 70, 90, 140),
  ];
};

/**
 * One castor base upside down: held in the Workmate's jaws, castor end out, when there's one to
 * hand, or on two offcuts on the floor. One castor upside down on its end, the same gap both
 * sides and a fingernail from the end; its first bolt in, and the drill's bit through the plate's
 * next hole. Its words are off the model, each with a short leader: the owner's own tools and
 * where things go in their colour, the next thing to do in green.
 */
export const castorScene = (setting: SceneSetting): Scene => {
  const castors = setting.parameters.castors;
  const s = setting.shape;
  if (!castors) return whole(setting, []);
  const plateLength = castors.plate.length.value;
  const plateWidth = castors.plate.width.value;
  const plate = castors.plate.thickness.value;
  const bolt = castors.bolt.diameter.value;
  const bit = bolt + 1;
  const inWorkmate = setting.toHand.has("folding-workbench");
  const hasDrill = setting.toHand.has("drill-driver");
  // The base's underside, now on top: proud of the jaws, or an offcut's thickness off the floor.
  const under = inWorkmate ? JAWS.top + 5 - s.wideThick : s.wideThick;
  const top = under + s.wideThick;
  const plateY = (s.wideWidth - plateWidth) / 2;
  const corner = 10;
  const first = { x: CASTOR_INSET + corner, y: plateY + corner };
  const next = { x: CASTOR_INSET + plateLength - corner, y: plateY + plateWidth - corner };
  const jawsFrom = CASTOR_INSET + plateLength + 60;
  const marks: SceneMark[] = [
    hasDrill
      ? {
          kind: "callout",
          at: at(next.x - 30, next.y, top + plate + 200),
          says: `your drill, ${bit} mm bit`,
          more: "straight down through the plate's hole",
          tone: "yours",
        }
      : {
          kind: "callout",
          at: at(next.x, next.y, top + plate),
          says: `drill ${bit} mm here`,
          more: "straight down through the plate's hole",
          tone: "next",
        },
    {
      kind: "callout",
      at: at(first.x, first.y, top + plate + 8),
      says: "1 bolt in",
      more: "then drill the next hole",
      tone: "next",
    },
    inWorkmate
      ? {
          kind: "callout",
          // The foot of the Workmate's near leg, where there's room beside it.
          at: at(jawsFrom + 55, -JAWS.width, 40),
          says: "your Workmate's jaws",
          more: "hold the base, castor end out",
          tone: "yours",
        }
      : {
          kind: "callout",
          at: at(s.frameDepth - 110, s.wideWidth + 20, s.wideThick),
          says: "two offcuts",
          more: "under the base, castor end clear",
          tone: "yours",
        },
  ];
  return {
    title: inWorkmate ? "In your Workmate" : "On two offcuts",
    view: { turn: -30, tilt: 32 },
    pieces: [
      part("E", nameOf(setting, "E"), "lit", [
        box(0, 0, under, s.frameDepth, s.wideWidth, s.wideThick),
      ]),
      inWorkmate
        ? {
            kind: "tool",
            name: TOOL_NAMES["folding-workbench"],
            label: null,
            tone: "plain",
            // The jaws hold the base clear of the castor's end.
            boxes: workmate(jawsFrom, s.wideWidth),
          }
        : {
            kind: "offcut",
            name: "Offcuts",
            label: null,
            tone: "plain",
            boxes: [80, s.frameDepth - 140].map((x) =>
              box(x, -20, 0, 60, s.wideWidth + 40, s.wideThick),
            ),
          },
      {
        kind: "fitted",
        name: castors.name,
        label: null,
        tone: "plain",
        // The castor's plate on the base, its swivel, and its wheel standing up from them.
        boxes: [
          box(CASTOR_INSET, plateY, top, plateLength, plateWidth, plate),
          box(
            CASTOR_INSET + plateLength / 4,
            plateY + plateWidth / 4,
            top + plate,
            plateLength / 2,
            plateWidth / 2,
            12,
          ),
          box(
            CASTOR_INSET + plateLength / 2 - 12,
            plateY + plateWidth / 2 - (s.castor - plate - 12) / 2,
            top + plate + 12,
            24,
            s.castor - plate - 12,
            s.castor - plate - 12,
          ),
        ],
      },
      {
        kind: "fitted",
        name: castorFixingNames(castors, setting.boltLength).bolts,
        label: null,
        tone: "plain",
        boxes: [
          box(first.x - bolt / 2, first.y - bolt / 2, under - 10, bolt, bolt, s.wideThick + 20),
        ],
      },
      ...toolIf(setting.toHand, "drill-driver", drillAt({ ...next, z: top + plate }, bit)),
    ],
    marks,
  };
};

/** What holds a bolt's head or turns its nut, as the close-ups draw it. */
export type Holder = "open-spanner" | "adjustable" | "pliers" | "socket";

/** How far a spanner's handle reaches from the head to the castor's body, as drawn. */
const REACH = 110;
/** Where the second half of the tightening close-up starts, from the left. */
const UNDER = 200;

/**
 * Tightening a castor's bolt: on top, the head held, its tool's handle resting against the
 * castor's body so it can't spin; underneath, the nut turned clockwise with the owner's tool,
 * named as theirs, until the washer bites.
 */
export const tightenCloseUp = (
  castors: Castors,
  hold: { head: Holder; nut: Holder; size: number | undefined; yours: boolean },
): CloseUp => {
  const across = hold.size ?? 2 * castors.bolt.diameter.value;
  const x = 22;
  const y = 46;
  const body = { x: x + REACH, y: y - 25, w: 56, h: 50 };
  const named: Readonly<Record<Holder, string>> = {
    "open-spanner": hold.size === undefined ? "spanner" : `${hold.size} mm spanner`,
    adjustable: "adjustable",
    pliers: "pliers",
    socket: "socket",
  };
  const bites = castors.washer.perBolt > 0 ? "the washer" : "the nut";
  return {
    title: "Tighten",
    width: UNDER + body.x + body.w - x,
    height: 92,
    pieces: [{ label: "castor", ...body }],
    dimensions: [],
    fixings: [],
    shapes: [
      { kind: hold.head, x, y, jaw: across, length: REACH, turn: 0 },
      { kind: "hex", x, y, across },
      { kind: hold.nut, x: UNDER + x, y, jaw: across, length: REACH, turn: 0 },
      { kind: "hex", x: UNDER + x, y, across },
      { kind: "clockwise", x: UNDER + x, y, r: 2 * across },
    ],
    labels: [
      { x: 0, y: 6, says: "On top: hold the head", heading: true },
      { x: body.x + 6, y, says: "castor" },
      {
        x: 0,
        y: 84,
        says: hold.head === "pliers" ? "handles rest on the castor" : "handle rests on the castor",
      },
      { x: UNDER, y: 6, says: "Under: turn the nut", heading: true },
      {
        x: UNDER,
        y: 84,
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
 * One castor bolt taken apart, from the side: the castor's side on top (the castor upside down,
 * its plate, and the bolt's head), then the base, then underneath (the washer and the nut). The
 * washers are the Build's own, under the nut, against the wood, never under the head: the
 * castor's steel plate takes the head.
 */
export const boltApartCloseUp = (s: Shape, castors: Castors, size: number | undefined): CloseUp => {
  const across = size ?? 2 * castors.bolt.diameter.value;
  const bolt = castors.bolt.diameter.value;
  const washer = castors.washer.thickness.value;
  const nut = castors.nut.height.value;
  const plateLength = castors.plate.length.value;
  // The bolt through the plate's hole near its end, the castor's swivel and wheel beside it.
  const middle = 12;
  const named = plateLength + 12;
  const label = (y: number, says: string, key?: boolean) => ({
    x: named,
    y,
    says,
    ...(key ? { key } : {}),
  });

  const wheel = Math.min(48, s.castor * 0.55);
  const plateY = 22 + wheel + 14;
  const headY = plateY - APART - 4;
  const baseY = plateY + castors.plate.thickness.value + APART;
  const base = Math.min(s.wideThick, 40);
  const under = baseY + base + 14;
  const washers = Array.from(
    { length: castors.washer.perBolt },
    (_, at) => under + APART + at * (washer + 4),
  );
  const nutY = (washers.at(-1) ?? under) + washer + APART;
  return {
    title: "One bolt, apart",
    width: named + 70,
    height: nutY + nut + 6,
    pieces: [
      { label: "E", x: 0, y: baseY, w: plateLength, h: base },
      // The bolt's shank, through the plate and the base, to past the nut.
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
    shapes: [
      {
        kind: "castor",
        x: 0,
        y: plateY,
        w: plateLength,
        plate: castors.plate.thickness.value,
        wheel,
      },
    ],
    dimensions: [],
    fixings: [],
    labels: [
      { x: 0, y: 6, says: "Top · castor side", heading: true },
      label(22 + wheel / 2, "castor"),
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
