import type { Box } from "../build.ts";
import type { Scene, SceneMark } from "../scene.ts";
import { TOOL_NAMES } from "../tools.ts";
import { castorInsetOf } from "./frame.ts";
import { castorFixingNames } from "./parameters.ts";
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

// The castor step's picture (#783; Paper, 2 · Agreed, "Fabrication · Castors in 3D, your kit ·
// Fold (#783)"): the base in 3D with a castor on it, the first bolt in and the drill through the
// plate's next hole, its words off the model. Its close-ups are a bolt through a plate's
// (`close-ups/bolt-through.ts`, #813).

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
 * hand, or on two offcuts on the floor. One castor upside down, the same gap both sides, past
 * where the leg stands on the base's other face (#835), with the size from the end; its first
 * bolt in, and the drill's bit through the plate's next hole. Its
 * words are off the model, each with a short leader: the owner's own tools and where things go in
 * their colour, the next thing to do in green.
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
  const inset = castorInsetOf(setting.parameters, s);
  const first = { x: inset + corner, y: plateY + corner };
  const next = { x: inset + plateLength - corner, y: plateY + plateWidth - corner };
  const jawsFrom = inset + plateLength + 60;
  // Where the leg stands on the base's other face: from the long rail's thickness in, a leg thick.
  const legFrom = s.thick;
  const legTo = 2 * s.thick;
  const marks: SceneMark[] = [
    {
      kind: "callout",
      at: at((legFrom + legTo) / 2, s.wideWidth / 2, top),
      says: "leg stands here",
      more: "on the other face: castor past it",
      tone: "yours",
    },
    { kind: "size", from: at(0, -20, top), to: at(inset, -20, top), mm: inset },
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
            kind: "support",
            name: TOOL_NAMES["folding-workbench"],
            label: null,
            tone: "plain",
            // The jaws hold the base clear of the castor's end.
            boxes: workmate(jawsFrom, s.wideWidth),
          }
        : {
            kind: "support",
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
          box(inset, plateY, top, plateLength, plateWidth, plate),
          box(
            inset + plateLength / 4,
            plateY + plateWidth / 4,
            top + plate,
            plateLength / 2,
            plateWidth / 2,
            12,
          ),
          box(
            inset + plateLength / 2 - 12,
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
