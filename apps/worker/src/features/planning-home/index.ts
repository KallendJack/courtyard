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
 * places saved on them (#711); else its newest floor plan. Decided here, once, for every screen.
 */

/** A Thing is drawn as a mountain bike once this many of its parts have a place on it. */
const PARTS_TO_DRAW = 2;

const drawnPart = (part: ThingSummary): DrawnPart => ({
  thing: part.slug,
  name: part.name,
  ...(part.upcoming === undefined ? {} : { upcoming: part.upcoming.name }),
});

/**
 * A Thing's fitted parts on the mountain bike's drawing (#603): a wanted one isn't on the bike, so
 * it's neither drawn nor listed. In list order, each on the place saved on it (#711); those with
 * none, or whose place another has taken, under it.
 */
const onTheBike = (top: ThingSummary, parts: readonly ThingSummary[]) => {
  const fitted = parts.filter(({ status }) => status !== "want");
  const taken = new Map<BikePlace, ThingSummary>();
  const unplaced: ThingSummary[] = [];
  for (const part of fitted) {
    if (part.place === undefined || taken.has(part.place)) unplaced.push(part);
    else taken.set(part.place, part);
  }
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
