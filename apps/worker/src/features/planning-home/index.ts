import {
  BIKE_PLACES,
  type BikePlace,
  type DrawnPart,
  type HomeSubject,
  type ThingSummary,
} from "@courtyard/contract";
import type { ReadSize } from "../fabrication/sizes.ts";
import { checkedPlan, recordedSpaces, spaceToDraw } from "./records.ts";

/**
 * A planning workspace's main subject (#603): a Thing drawn as its kind of thing, its parts on the
 * places saved on them (#711), or by name while they have none; else its newest floor plan.
 * Decided here, once, for every screen.
 */

/** A Thing is drawn as a mountain bike once this many of its parts have a place on it. */
const PARTS_TO_DRAW = 2;

const drawnPart = (part: ThingSummary): DrawnPart => ({
  thing: part.slug,
  name: part.name,
  ...(part.upcoming === undefined ? {} : { upcoming: part.upcoming.name }),
});

/**
 * The words in a part's name that put it on each place of the drawing, in the order they're tried
 * (a rear tyre before any tyre, so "Tyres" takes the front one): only for a part saved before
 * places were (#711), so a bike drawn then stays drawn until the model gives its parts places.
 */
const BIKE_WORDS: readonly (readonly [BikePlace, RegExp])[] = [
  ["seatpost", /\bseat ?post\b|\bdropper\b/i],
  ["saddle", /\bsaddle\b/i],
  ["grips", /\bgrips?\b/i],
  ["fork", /\bfork\b/i],
  ["brakes", /\bbrakes?\b|\brotors?\b/i],
  ["drivetrain", /\bdrivetrain\b|\bchain(?:ring)?\b|\bcassette\b|\bderailleur\b|\bcranks?\b/i],
  ["pedals", /\bpedals?\b/i],
  ["rear-tyre", /\b(?:rear|back) (?:tyre|tire)s?\b/i],
  ["front-tyre", /\b(?:tyre|tire)s?\b/i],
];

/** A place's own word, as a part named just for it is named ("Pedals", "Front tyre"). */
const placeWord = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .replace(/s$/, "");

/**
 * A Thing's fitted parts on the mountain bike's drawing (#603): a wanted one isn't on the bike, so
 * it's neither drawn nor listed. In list order, each on the place saved on it (#711); then each
 * part with none saved, from before places were, on a free place by its name: one named just for
 * a place ("Pedals") first, then by the words in its name. Those left, under it.
 */
const onTheBike = (top: ThingSummary, parts: readonly ThingSummary[]) => {
  const fitted = parts.filter(({ status }) => status !== "want");
  const taken = new Map<BikePlace, ThingSummary>();
  for (const part of fitted) {
    if (part.place !== undefined && !taken.has(part.place)) taken.set(part.place, part);
  }
  const unsaved = fitted.filter(({ place }) => place === undefined);
  for (const part of unsaved) {
    const own = BIKE_PLACES.find((place) => placeWord(place) === placeWord(part.name));
    if (own !== undefined && !taken.has(own)) taken.set(own, part);
  }
  for (const part of unsaved) {
    if ([...taken.values()].includes(part)) continue;
    const place = BIKE_WORDS.find(([at, words]) => !taken.has(at) && words.test(part.name))?.[0];
    if (place !== undefined) taken.set(place, part);
  }
  const placed = new Set(taken.values());
  const unplaced = fitted.filter((part) => !placed.has(part));
  return {
    kind: "drawing",
    drawing: "mountain-bike",
    thing: top.slug,
    name: top.name,
    placed: BIKE_PLACES.flatMap((place) => {
      const part = taken.get(place);
      return part === undefined ? [] : [{ place, ...drawnPart(part) }];
    }),
    unplaced: unplaced.map(drawnPart),
  } satisfies HomeSubject;
};

type PlanSubject = Extract<HomeSubject, { kind: "plan" }>;

/** A plan's room that is a floor, and the floor's own name: "Ground floor", "Ground". */
const FLOOR_ROOM = /^\s*(.+?)\s+floor\s*$/i;

/** The floors in the order they're drawn, lowest first; any other floor after them. */
const FLOOR_ORDER = ["basement", "lower ground", "ground", "first", "second", "third", "fourth"];
const levelOf = (floor: string) => {
  const level = FLOOR_ORDER.indexOf(floor.toLowerCase());
  return level === -1 ? FLOOR_ORDER.length : level;
};

/**
 * A house's floors (#670): once two or more of its plans are each a floor's, by their room's name
 * ("Ground floor", "First floor"), all of them, lowest first, each named for its floor; else none.
 */
const floorsOf = (name: string, plans: readonly PlanSubject[]): HomeSubject | undefined => {
  const floors = plans.flatMap(({ document, plan }) => {
    const floor = FLOOR_ROOM.exec(plan.room)?.[1];
    return floor === undefined ? [] : [{ name: floor, document, plan }];
  });
  const [first, second, ...rest] = floors.sort((a, b) => levelOf(a.name) - levelOf(b.name));
  if (first === undefined || second === undefined) return undefined;
  return { kind: "floors", name, floors: [first, second, ...rest] };
};

/**
 * The workspace's main subject: the Thing with the most parts on the mountain bike's drawing, once
 * enough of them have places on it; else its floors, when its plans are a house's (#670); else its
 * newest floor plan (#257), whose views come newest first, checked against its space's floor as
 * recorded (#711); else the space to draw (#604), from its records; else none.
 */
export const subjectOf = (from: {
  /** The workspace's name, which its floors are shown under. */
  name: string;
  things: readonly ThingSummary[];
  plans?: readonly PlanSubject[];
  /** The workspace's size records (#708). */
  sizes?: readonly ReadSize[];
}): HomeSubject | null => {
  const { things, sizes = [] } = from;
  const spaces = recordedSpaces(things, sizes);
  const plans = (from.plans ?? []).map((plan) => checkedPlan(plan, spaces));
  const slugs = new Set(things.map(({ slug }) => slug));
  const drawn = things
    .filter(({ partOf }) => partOf === undefined || !slugs.has(partOf))
    .map((top) =>
      onTheBike(
        top,
        things.filter(({ partOf }) => partOf === top.slug),
      ),
    )
    .filter(({ placed }) => placed.length >= PARTS_TO_DRAW)
    .reduce<ReturnType<typeof onTheBike> | undefined>(
      (most, one) => (most === undefined || one.placed.length > most.placed.length ? one : most),
      undefined,
    );
  return drawn ?? floorsOf(from.name, plans) ?? plans[0] ?? spaceToDraw(spaces);
};
