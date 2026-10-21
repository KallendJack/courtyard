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

/** A place's own word, as a part named just for it is named ("Pedals", "Front tyre"). */
const placeWord = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .replace(/s$/, "");

/** A Thing is drawn as a mountain bike once this many of its parts have a place on it. */
const PARTS_TO_DRAW = 2;

const drawnPart = (part: ThingSummary): DrawnPart => ({
  thing: part.slug,
  name: part.name,
  ...(part.upcoming === undefined ? {} : { upcoming: part.upcoming.name }),
});

/**
 * A Thing's fitted parts on the mountain bike's drawing (#603): a wanted one isn't on the bike, so
 * it's neither drawn nor listed. A part named just for a place ("Pedals") has it first; then, in
 * list order, each on the first free place its name fits, in the drawing's order; those with none,
 * or whose place is taken, under it.
 */
const onTheBike = (top: ThingSummary, parts: readonly ThingSummary[]) => {
  const fitted = parts.filter(({ status }) => status !== "want");
  const taken = new Map<BikePlace, ThingSummary>();
  for (const part of fitted) {
    const own = BIKE_PLACES.find((place) => placeWord(place) === placeWord(part.name));
    if (own !== undefined && !taken.has(own)) taken.set(own, part);
  }
  const unplaced: ThingSummary[] = [];
  for (const part of fitted) {
    if ([...taken.values()].includes(part)) continue;
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

/** A length as saved: a number, then its unit, or none when the next one's says it ("5.14 × 2.74 m"). */
const LENGTH = String.raw`(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?`;
/**
 * A floor's two sides, "5.14 × 2.74 m", "240cm x 180cm": the second with its unit. Facts are
 * sentences, so a few words may come between them, "5.137 m long × 2.735 m" (#658).
 */
const FLOOR = new RegExp(
  String.raw`${LENGTH}(?:\s+[A-Za-z]+){0,3}\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b`,
);
/** Any length with its unit, "2.45 m high": what makes a fact a measurement. */
const MEASURED = /\d\s*(?:mm|cm|m)\b/;

/**
 * A space to draw (#604): a workspace whose facts give a floor's two sides, named from the
 * workspace ("Draw the garage"), with its size as first saved and every fact that holds a
 * measurement, which its plan is drawn from; `null` for a workspace whose facts give no floor.
 */
export const spaceOf = (workspace: {
  name: string;
  facts: readonly string[];
}): Extract<HomeSubject, { kind: "space" }> | null => {
  const floor = workspace.facts.map((fact) => FLOOR.exec(fact)).find((found) => found !== null);
  if (floor === undefined || floor === null) return null;
  const [, across = "", acrossUnit, along = "", unit = "m"] = floor;
  return {
    kind: "space",
    name: workspace.name.toLowerCase(),
    size: `${across} ${acrossUnit ?? unit} × ${along} ${unit}`,
    measurements: workspace.facts.filter((fact) => MEASURED.test(fact)),
  };
};

/**
 * The workspace's main subject: the Thing with the most parts on the mountain bike's drawing, once
 * enough of them fit it; else its newest floor plan (#257), whose views come newest first; else
 * the space to draw (#604); else none.
 */
export const subjectOf = (
  things: readonly ThingSummary[],
  plans: readonly Extract<HomeSubject, { kind: "plan" }>[] = [],
  space: Extract<HomeSubject, { kind: "space" }> | null = null,
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
  return drawn ?? plans[0] ?? space;
};
