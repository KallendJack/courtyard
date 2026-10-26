import type { Step } from "../build.ts";
import type { SquareKind } from "../tools.ts";
import { type Driving, drivingCloseUp } from "./driving.ts";
import { type Marking, markCloseUp } from "./measure.ts";
import {
  type Countersink,
  countersinkCloseUp,
  type Pilot,
  pilotHoleCloseUp,
  type SquareFrame,
  screwLength,
  squareFrameCloseUp,
} from "./skills.ts";

// The techniques a Build's steps use (#813), whatever its template: each drawn in full the first
// time the steps use it, and a "how?" tap after, so a beginner sees it once, when it's new. The
// first-time skills (#778) are techniques too: a pilot hole, a countersink, squaring a frame.

/**
 * A technique a step uses: marking a piece at a number, or driving a screw into a piece, by the
 * screw's name, whose length decides whether the drill's clutch is shown; drilling a pilot hole,
 * countersinking a screw, or squaring a frame.
 */
export type Technique =
  | { readonly type: "measure-mark"; readonly piece: Marking["piece"]; readonly at: number }
  | { readonly type: "driving-screw"; readonly piece: Driving["piece"]; readonly screw: string }
  | ({ readonly type: "pilot-hole" } & Pilot)
  | ({ readonly type: "countersink" } & Countersink)
  | ({ readonly type: "square-frame" } & SquareFrame);

/** A screw at least this long drives hard enough to need the drill's clutch turned up, mm. */
const LONG_SCREW = 60;

/** Whether a screw is long, from its name as shops give it, "5 × 80 screws". */
export const isLongScrew = (name: string) => screwLength(name) >= LONG_SCREW;

/**
 * Each step's techniques as their close-ups, in the steps' order: each type in full the first
 * time a step uses it, a "how?" tap after; the drill's clutch with the first long screw, in full
 * there too. Drawn with the owner's square, as theirs when their marking kit and drill are to
 * hand, and the end zone `zone` from each end, where the pilot rule drills first.
 */
export const techniquesOf = (
  steps: readonly { readonly techniques?: readonly Technique[] }[],
  kit: { square: SquareKind | undefined; marking: boolean; drill: boolean; zone: number },
): Step["techniques"][] => {
  const seen = new Set<string>();
  let clutchShown = false;
  return steps.map((step) =>
    (step.techniques ?? []).map((technique) => {
      const first = !seen.has(technique.type);
      seen.add(technique.type);
      switch (technique.type) {
        case "measure-mark":
          return {
            first,
            closeUp: markCloseUp({ ...technique, square: kit.square, yours: kit.marking }),
          };
        case "pilot-hole":
          return { first, closeUp: pilotHoleCloseUp(technique) };
        case "countersink":
          return { first, closeUp: countersinkCloseUp(technique) };
        case "square-frame":
          return { first, closeUp: squareFrameCloseUp(technique) };
        default: {
          // Driving a screw.
          const clutch = !clutchShown && isLongScrew(technique.screw);
          clutchShown ||= clutch;
          return {
            first: first || clutch,
            closeUp: drivingCloseUp({
              piece: technique.piece,
              zone: kit.zone,
              clutch,
              yours: kit.drill,
            }),
          };
        }
      }
    }),
  );
};
