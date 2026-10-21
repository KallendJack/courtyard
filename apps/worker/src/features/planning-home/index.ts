import {
  BIKE_PLACES,
  type BikePlace,
  type DrawnPart,
  type HomeSubject,
  type ThingSummary,
} from "@courtyard/contract";

/**
 * A planning workspace's main subject (#603): a Thing drawn as its kind of thing, its parts placed
 * by name; else its newest floor plan. Decided here, once, for every screen.
 */

/**
 * The words in a part's name that put it on each place of the mountain bike's drawing, in the
 * order they're tried: a rear tyre before any tyre, so "Tyres" takes the front one.
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

/** A Thing is drawn as a mountain bike once this many of its parts have a place on it. */
const PARTS_TO_DRAW = 2;

const drawnPart = (part: ThingSummary): DrawnPart => ({
  thing: part.slug,
  name: part.name,
  ...(part.upcoming === undefined ? {} : { upcoming: part.upcoming.name }),
});

/**
 * A Thing's parts on the mountain bike's drawing, in list order: each on the first free place its
 * name fits, in the drawing's order; those with none, or whose place is taken, under it.
 */
const onTheBike = (top: ThingSummary, parts: readonly ThingSummary[]) => {
  const taken = new Map<BikePlace, ThingSummary>();
  const unplaced: ThingSummary[] = [];
  for (const part of parts) {
    const place = BIKE_WORDS.find(([at, words]) => !taken.has(at) && words.test(part.name))?.[0];
    if (place === undefined) unplaced.push(part);
    else taken.set(place, part);
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

/**
 * The workspace's main subject: the Thing with the most parts on the mountain bike's drawing, once
 * enough of them fit it; else its newest floor plan (#257), whose views come newest first; else
 * none.
 */
export const subjectOf = (
  things: readonly ThingSummary[],
  plans: readonly Extract<HomeSubject, { kind: "plan" }>[] = [],
): HomeSubject | null => {
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
  return drawn ?? plans[0] ?? null;
};
