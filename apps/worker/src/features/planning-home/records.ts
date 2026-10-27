import type { HomeSubject, PlanCheck, SizeRecord, ThingSummary } from "@courtyard/contract";
import { type ReadSize, standing, valueText } from "../fabrication/sizes.ts";

// What Home reads from a space's size records (ADR 0037, #711): its floor, so the space to draw
// and a floor plan's size come from what the owner recorded, never from a sentence.

/** The properties a space's floor is recorded as, as the size rule tells a model. */
const FLOOR = { length: "floor length", width: "floor width" } as const;

/** Centimetres in each length a record may be in. */
const CM: Readonly<Record<string, number>> = { mm: 0.1, cm: 1, m: 100 };

/** A floor plan's side may be this far off the size recorded, in cm, for a model's rounding. */
const SLACK_CM = 2;

/** A space with its standing records, and its floor's two sides, when both are recorded. */
type RecordedSpace = {
  readonly name: string;
  readonly records: readonly SizeRecord[];
  readonly floor?: { readonly length: SizeRecord; readonly width: SizeRecord };
};

/** A record's length in cm, or none for a record that isn't one. */
const lengthCm = ({ value }: SizeRecord) =>
  value.kind === "quantity" && CM[value.unit] !== undefined
    ? value.value * (CM[value.unit] ?? 0)
    : undefined;

/**
 * The one standing length recorded as this side of the floor: none when there's none, or while two
 * differ, since nothing wins on its own.
 */
const sideOf = (records: readonly SizeRecord[], property: string) => {
  const sides = records.filter(
    (record) => record.property.trim().toLowerCase() === property && lengthCm(record) !== undefined,
  );
  const [first] = sides;
  return sides.every((side) => lengthCm(side) === lengthCm(first ?? side)) ? first : undefined;
};

/** Each space Thing that has records, in list order, with its standing records and its floor. */
export const recordedSpaces = (
  things: readonly ThingSummary[],
  sizes: readonly ReadSize[],
): RecordedSpace[] =>
  things.flatMap((thing) => {
    if (thing.kind !== "space" || thing.subject === undefined) return [];
    const records = sizes
      .filter((size) => standing(size) && size.record.subject === thing.subject)
      .map(({ record }) => record);
    if (records.length === 0) return [];
    const length = sideOf(records, FLOOR.length);
    const width = sideOf(records, FLOOR.width);
    return [
      {
        name: thing.name,
        records,
        ...(length === undefined || width === undefined ? {} : { floor: { length, width } }),
      },
    ];
  });

/** A side in metres, as Home says a room's size, whatever unit it was recorded in: "5.14". */
const metres = (side: SizeRecord) => String(Number(((lengthCm(side) ?? 0) / 100).toFixed(3)));

/** A floor's size as Home says it: "5.14 m × 2.74 m", length first. */
const floorSize = ({ length, width }: NonNullable<RecordedSpace["floor"]>) =>
  `${metres(length)} m × ${metres(width)} m`;

/**
 * The space to draw (#604): the first space whose floor's length and width are recorded, named
 * from it ("Draw the garage"), with its size and each of its records, which its plan is drawn
 * from; none while no space has both.
 */
export const spaceToDraw = (
  spaces: readonly RecordedSpace[],
): Extract<HomeSubject, { kind: "space" }> | null => {
  const space = spaces.find(({ floor }) => floor !== undefined);
  if (space?.floor === undefined) return null;
  const { length, width } = space.floor;
  return {
    kind: "space",
    name: space.name.toLowerCase(),
    size: floorSize(space.floor),
    // The floor first, then the rest as recorded, each as the card says it, a sentence: "Floor
    // length 5140 mm, measured".
    measurements: [
      length,
      width,
      ...space.records.filter((record) => record !== length && record !== width),
    ].map(
      ({ property, value, source }) =>
        `${property.charAt(0).toUpperCase()}${property.slice(1)} ${valueText(value)}, ${source.kind}`,
    ),
  };
};

type PlanSubject = Extract<HomeSubject, { kind: "plan" }>;

/**
 * A floor plan checked against its space's floor as recorded (#711): its space is the one with its
 * room's name, or the only one with a floor. Its size is shown as measured only when it's the size
 * measured (or specified), either way round; drawn as unmeasured when that size is only reported
 * or estimated; and flagged when it isn't the size recorded. With no floor recorded, it's as drawn.
 */
export const checkedPlan = (
  subject: PlanSubject,
  spaces: readonly RecordedSpace[],
): PlanSubject => {
  const floored = spaces.filter(({ floor }) => floor !== undefined);
  const room = subject.plan.room.trim().toLowerCase();
  const space =
    floored.find(({ name }) => name.trim().toLowerCase() === room) ??
    (floored.length === 1 ? floored[0] : undefined);
  const floor = space?.floor;
  if (floor === undefined) return subject;
  const recorded = [lengthCm(floor.length) ?? 0, lengthCm(floor.width) ?? 0].sort((a, b) => a - b);
  const drawn = [subject.plan.width, subject.plan.depth].sort((a, b) => a - b);
  const same = drawn.every((side, index) => Math.abs(side - (recorded[index] ?? 0)) <= SLACK_CM);
  const known = [floor.length, floor.width].every(
    ({ source }) => source.kind === "measured" || source.kind === "specified",
  );
  const check: PlanCheck = !same
    ? { kind: "differs", recorded: floorSize(floor) }
    : known
      ? { kind: "measured" }
      : { kind: "unmeasured" };
  return { ...subject, plan: { ...subject.plan, measured: check.kind === "measured" }, check };
};
