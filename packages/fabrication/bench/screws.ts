import type { Action } from "../build.ts";
import { bracketArm } from "../close-ups/bracket.ts";
import type { Word } from "../glossary.ts";
import type { Tool } from "../tools.ts";
import { jointFromEnd, SCREW_INSET } from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import type { BenchParameters } from "./parameters.ts";
import { act } from "./preparing.ts";

// When a screw needs a pilot hole first (#789). Modern wood screws, with a self-drilling tip, go
// straight into softwood and pull their heads flush, so the steps drill only where it matters:
// near a piece's end, where the wood splits; into MDF or hardwood, too dense to push aside; and
// for thick screws. Said once, at the screws, where it's needed.

/** Within this of a piece's end a screw can split it, mm: the end zone driving a screw shows. */
export const SPLIT_RISK = 25;
/** Screws thicker than this need a pilot hole whatever they go into, mm. */
const THICK_SCREW = 6;
/** Stock too dense for a screw to push its own way in. */
const DENSE = /\b(mdf|hardwood|oak|beech|ash|sapele|walnut|maple)\b/i;

/** A screw's thickness from its name as shops give it, "5 × 80 screws"; none when it doesn't say. */
const screwDiameter = (name: string): number | undefined => {
  const [, diameter] = /(\d+(?:\.\d+)?)\s*×/.exec(name) ?? [];
  return diameter === undefined ? undefined : Number(diameter);
};

/** Whether a screw needs a pilot hole first. */
const needsPilot = (joint: {
  screw: string;
  /** The stock it passes through and goes into, by name. */
  into: readonly string[];
  /** The closest it comes to a piece's end, mm. */
  fromEnd: number;
}) =>
  joint.fromEnd < SPLIT_RISK ||
  joint.into.some((stock) => DENSE.test(stock)) ||
  (screwDiameter(joint.screw) ?? 0) > THICK_SCREW;

/** An angle bracket's screws: two through each of its arms. */
export const SCREWS_PER_BRACKET = 4;

/** Which of the bench's joints drill a pilot hole first: what each screw goes into, and how near an end. */
export const benchPilots = (p: BenchParameters, s: Shape) => {
  const { frameScrews, sheetScrews, brackets } = p.fixings;
  const bracketScrews = p.fixings.bracketScrews ?? sheetScrews;
  const frame = p.frame.timber.name;
  const sheet = (name: string) =>
    needsPilot({ screw: sheetScrews.name, into: [name, frame], fromEnd: SCREW_INSET });
  return {
    endFrames: needsPilot({
      screw: frameScrews.name,
      into: [frame],
      fromEnd: jointFromEnd(s.thick, s.wide),
    }),
    longRails: needsPilot({
      screw: frameScrews.name,
      into: [frame],
      fromEnd: jointFromEnd(s.wide, s.wide),
    }),
    // A bracket's holes sit about halfway along its arm, from the corner where two pieces meet.
    brackets: needsPilot({
      screw: bracketScrews.name,
      into: [frame, p.frame.wide.name],
      fromEnd: bracketArm(brackets.name) / 2,
    }),
    shelf: sheet(p.shelf.sheet.name),
    braces: sheet(p.braces.sheet.name),
    top: sheet(p.top.sheet.name) || DENSE.test(p.frame.wide.name),
  };
};
export type Pilots = ReturnType<typeof benchPilots>;

/** A joint's screws: marked by eye where they must hit, a pilot hole first only where needed. */
export const screwing = (pilot: boolean, marking: string, numbers: string): Action =>
  act(
    `${marking} ${pilot ? "Drill a small 3 mm pilot hole at each mark, then drive the screw." : "Drive a screw straight in at each."}`,
    pilot ? `${numbers} 3 mm pilots.` : numbers,
  );

/** Each bracket marked through its holes, then screwed. */
export const bracketing = (pilot: boolean) =>
  screwing(
    pilot,
    "Hold each bracket tight into its corner and mark through its holes.",
    `${SCREWS_PER_BRACKET} screws a bracket.`,
  );

/** The drill, and its bits only when the step drills a pilot hole. */
export const drilling = (pilot: boolean): Tool[] =>
  pilot ? ["drill-driver", "drill-bits"] : ["drill-driver"];

/** The tip for screws driven with no pilot hole: what to do if the wood starts to split. */
export const SPLIT_TIP =
  "Wood starting to split at a screw? Back it out, drill a 3 mm pilot hole there, then drive it again.";

/** A step's words: those it always uses, and "pilot hole" when it drills one. */
export const wordsWith = (pilot: boolean, ...words: Word[]): Word[] =>
  pilot ? [...words, "pilot hole"] : words;
