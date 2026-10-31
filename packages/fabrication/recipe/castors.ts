import type { BuildRecipe, RecipeStock } from "@courtyard/contract";
import {
  baseForScrews,
  CASTOR_INSET,
  castorPlaces,
  footBrackets,
  nutsOn,
  screwsFromBelow,
  type Taken,
  type ThroughBolt,
} from "../assembly/space.ts";
import { bracketArm } from "../close-ups/bracket.ts";
import { box } from "./geometry.ts";
import { type Placed, type PlacedFitted, said } from "./layout.ts";

// Any recipe's castors as one with the rest (#835): each a fingernail in from its base's end, or
// moved along the base until its bolts' nuts clear what stands on it (legs, a box's sides, the
// brackets at their feet); else on coach screws up from below, where the base holds them; else
// where they were, and the clash check says so.

type Castor = Extract<RecipeStock, { kind: "castor" }>;

/** The bolts through a castor's plate and its base, as a recipe's bolted joint gives them. */
const boltOf = (recipe: BuildRecipe, fitted: string, base: string, castor: Castor) => {
  const joint = recipe.joints.find(
    (each) =>
      each.kind === "bolted" &&
      (each.joins as readonly string[]).includes(fitted) &&
      (each.joins as readonly string[]).includes(base),
  );
  if (joint?.kind !== "bolted") return undefined;
  const bolt: ThroughBolt = {
    diameter: joint.bolt.diameter.value,
    length: joint.bolt.length.value,
    washers: joint.washer.perBolt,
    washer: joint.washer.thickness.value,
    nut: joint.nut.height.value,
    plate: castor.plate.thickness.value,
  };
  return { bolt, count: joint.each };
};

/** What stands on a base's top: the pieces whose feet are on it. */
const standingOn = (base: Placed, placed: readonly Placed[]) =>
  placed
    .filter((piece) => piece !== base)
    .flatMap((piece) =>
      piece.boxes.filter((at) =>
        base.boxes.some(
          (under) =>
            Math.abs(under.z + under.h - at.z) < 0.05 &&
            Math.min(under.x + under.w, at.x + at.w) > Math.max(under.x, at.x) &&
            Math.min(under.y + under.d, at.y + at.d) > Math.max(under.y, at.y),
        ),
      ),
    );

/** The brackets at the feet on a base, when a bracket joint holds what stands there to it. */
export const bracketsOnBase = (recipe: BuildRecipe, base: Placed, placed: readonly Placed[]) => {
  const joint = recipe.joints.find(
    (each) => each.kind === "bracket" && (each.joins as readonly string[]).includes(base.from),
  );
  if (joint?.kind !== "bracket") return [];
  const fixing = recipe.stock.find((item) => item.id === joint.fixing);
  const xs = base.boxes.flatMap((at) => [at.x, at.x + at.w]);
  const [first] = base.boxes;
  if (first === undefined) return [];
  return footBrackets({
    feet: standingOn(base, placed),
    bases: base.boxes,
    middle: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: first.y + first.d / 2 },
    arm: bracketArm(fixing?.name ?? ""),
  });
};

/**
 * The castors under each of a base's pieces, one at each end, as `PlacedFitted` boxes; and the
 * coach screws' length when they're fixed from below instead of bolted.
 */
export const castorsUnder = (options: {
  recipe: BuildRecipe;
  placed: readonly Placed[];
  base: Placed;
  fitted: string;
  castor: Castor;
}): Pick<PlacedFitted, "boxes" | "screws"> => {
  const { recipe, placed, base, castor } = options;
  const height = castor.height.value;
  const plate = { length: castor.plate.length.value, width: castor.plate.width.value };
  const through = boltOf(recipe, options.fitted, base.from, castor);
  const standing = [...standingOn(base, placed), ...bracketsOnBase(recipe, base, placed)];
  const at = (inset: number) =>
    base.boxes.flatMap((on) =>
      on.d >= on.w
        ? [on.y + inset, on.y + on.d - inset - plate.length].map((y) =>
            box(on.x + (on.w - plate.width) / 2, y, 0, plate.width, plate.length, height),
          )
        : [on.x + inset, on.x + on.w - inset - plate.length].map((x) =>
            box(x, on.y + (on.d - plate.width) / 2, 0, plate.length, plate.width, height),
          ),
    );
  if (through === undefined) return { boxes: at(CASTOR_INSET) };
  const places = base.boxes.map((on) =>
    castorPlaces({ base: on, plate, bolt: through.bolt, count: through.count, standing }),
  );
  if (places.every((each) => each !== undefined)) {
    return {
      boxes: places.flatMap((each) =>
        (each?.plates ?? []).map((spot) => ({ ...spot, z: 0, h: height })),
      ),
    };
  }
  const [thick] = base.boxes.map((on) => Math.min(on.w, on.d, on.h));
  const screws = screwsFromBelow({
    diameter: through.bolt.diameter,
    plate: through.bolt.plate,
    base: thick ?? 0,
  });
  return { boxes: at(CASTOR_INSET), ...(screws === undefined ? {} : { screws }) };
};

/**
 * What a recipe's castors' fixings take once it's all built: the bolted ones' nuts and ends on
 * their bases' tops, by their thread, with the plain fixes when they meet what stands there; and
 * the brackets at the feet on each base.
 */
export const castorFixingsTaken = (
  recipe: BuildRecipe,
  layout: { placed: readonly Placed[]; fitted: readonly PlacedFitted[] },
): (Taken & { readonly fixes?: readonly string[] })[] =>
  layout.fitted.flatMap((each) => {
    const base = layout.placed.find((piece) => piece.from === each.under);
    const castor = recipe.stock.find((item) => item.id === each.stock);
    if (base === undefined || castor?.kind !== "castor") return [];
    const through = boltOf(recipe, each.from, base.from, castor);
    const nuts =
      through === undefined || each.screws !== undefined
        ? []
        : each.boxes.flatMap((plate) => {
            const under = base.boxes.find(
              (on) =>
                plate.x >= on.x - 0.05 &&
                plate.x + plate.w <= on.x + on.w + 0.05 &&
                plate.y >= on.y - 0.05 &&
                plate.y + plate.d <= on.y + on.d + 0.05,
            );
            return under ? nutsOn(plate, under, through.bolt, through.count) : [];
          });
    const brackets = bracketsOnBase(recipe, base, layout.placed);
    const diameter = through?.bolt.diameter ?? 0;
    const bases = said(base.name);
    return [
      ...(nuts.length > 0
        ? [
            {
              name: `M${diameter} bolts' nuts and ends`,
              boxes: nuts,
              fixes: [
                `Make it deeper, so the castors sit clear of what stands on the ${bases}`,
                `Use ${bases} ${baseForScrews(diameter)} mm thick or more, for coach screws from below`,
              ],
            },
          ]
        : []),
      ...(brackets.length > 0 ? [{ name: "Brackets at the feet", boxes: brackets }] : []),
    ];
  });
