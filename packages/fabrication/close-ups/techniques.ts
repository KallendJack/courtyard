import type { Step } from "../build.ts";
import type { SquareKind } from "../tools.ts";
import { type Driving, drivingCloseUp } from "./driving.ts";
import { type Marking, markCloseUp } from "./measure.ts";

// The techniques a Build's steps use (#813), whatever its template: each drawn in full the first
// time the steps use it, and a "how?" tap after, so a beginner sees it once, when it's new.

/**
 * A technique a step uses: marking a piece at a number, or driving a screw into a piece, by the
 * screw's name, whose length decides whether the drill's clutch is shown.
 */
export type Technique =
  | { readonly type: "measure-mark"; readonly piece: Marking["piece"]; readonly at: number }
  | { readonly type: "driving-screw"; readonly piece: Driving["piece"]; readonly screw: string };

/** A screw at least this long drives hard enough to need the drill's clutch turned up, mm. */
const LONG_SCREW = 60;

/** Whether a screw is long, from its name as shops give it, "5 × 80 screws". */
export const isLongScrew = (name: string) =>
  Number(/×\s*(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0) >= LONG_SCREW;

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
      if (technique.type === "measure-mark") {
        return {
          first,
          closeUp: markCloseUp({ ...technique, square: kit.square, yours: kit.marking }),
        };
      }
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
    }),
  );
};
