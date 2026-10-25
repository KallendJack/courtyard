import { z } from "zod";
import { SessionId } from "../session.ts";
import { SubjectId, ThingSlug } from "../things.ts";
import { SizeRecordId, SpecifiedSource } from "./size.ts";

// Size records (ADR 0037, #708): a measurement Fabrication owns and a planning workspace hosts, a
// JSON file each in its `sizes` folder, so a measured size can be told from a guess. A record is
// never changed but to say what superseded it: a correction is a record of its own, the next
// revision, and two different values for the same thing are both kept, with nothing winning.

/** The units a recorded quantity is given in: lengths, a weight, a volume, an angle. */
export const RecordUnit = z.enum(["mm", "cm", "m", "kg", "l", "deg"]);
export type RecordUnit = z.infer<typeof RecordUnit>;

/** The longest a property's name or a text value gets, in characters. */
const SIZE_TEXT_MAX_CHARACTERS = 80;

const oneLine = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Give the ${what}.`)
    .max(SIZE_TEXT_MAX_CHARACTERS, `Keep the ${what} to ${SIZE_TEXT_MAX_CHARACTERS} characters.`)
    .refine((text) => !/[\r\n]/.test(text), `Keep the ${what} to one line.`);

/**
 * What was recorded: a quantity and its unit, the same `{ value, unit }` a Build's size has
 * (#696); a few words ("stud partition"); or yes or no ("has a socket").
 */
export const SizeValue = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("quantity"),
    value: z.number().nonnegative().max(1_000_000),
    unit: RecordUnit,
  }),
  z.object({ kind: z.literal("text"), text: oneLine("value") }),
  z.object({ kind: z.literal("yes-no"), yes: z.boolean() }),
]);
export type SizeValue = z.infer<typeof SizeValue>;

/** The owner's message a measurement was given in: its session and its event's number. */
const SaidIn = z.object({ session: SessionId, seq: z.number().int().positive() });

/**
 * Where a record's value came from: measured by the owner, linked by the worker to the message
 * they gave it in, never by a model; from a maker's page (specified); said roughly, "about 140"
 * (reported); or worked out from a photo or a description (estimated).
 */
export const RecordSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measured"), said: SaidIn }),
  SpecifiedSource,
  z.object({ kind: z.literal("reported") }),
  z.object({ kind: z.literal("estimated") }),
]);
export type RecordSource = z.infer<typeof RecordSource>;

/** The kinds of source, as a model gives them. */
export const RecordSourceKind = z.enum(["measured", "specified", "reported", "estimated"]);
export type RecordSourceKind = z.infer<typeof RecordSourceKind>;

/** The day something was measured or read: `2026-10-24`. */
export const ObservedDay = z.iso.date();

/**
 * A size record's file: what it's of (a Thing's subject ID) and which of its sizes, its value and
 * source, the day it was observed and when it was recorded, its revision (1, and one more for each
 * correction), and the record that corrected it, once one has.
 */
export const SizeRecord = z.strictObject({
  id: SizeRecordId,
  subject: SubjectId,
  property: oneLine("property"),
  value: SizeValue,
  source: RecordSource,
  observed: ObservedDay,
  recorded: z.iso.datetime(),
  revision: z.number().int().positive(),
  supersededBy: SizeRecordId.optional(),
});
export type SizeRecord = z.infer<typeof SizeRecord>;

/**
 * A record as Fabrication's API answers it: the record, the Thing it's of (none when no Thing has
 * its subject now), and the records it conflicts with, each standing and of the same thing with a
 * different value.
 */
export const SizeRow = z.object({
  record: SizeRecord,
  path: z.string(),
  thing: z.object({ slug: ThingSlug, name: z.string() }).nullable(),
  conflicts: z.array(SizeRecordId),
});
export type SizeRow = z.infer<typeof SizeRow>;

/** A workspace's size records, oldest first, and each file that can't be read as one. */
export const Sizes = z.object({
  sizes: z.array(SizeRow),
  problems: z.array(z.object({ path: z.string(), problem: z.string() })),
});
export type Sizes = z.infer<typeof Sizes>;

/**
 * What one size save did, for its note: recorded a size or corrected one, the Thing and property
 * it's of, the value as the owner reads it ("5137 mm") and its source's kind.
 */
export const SizeSave = z.object({
  action: z.enum(["add", "correct"]),
  size: z.object({ id: SizeRecordId, thing: z.string(), property: z.string() }),
  value: z.string(),
  source: RecordSourceKind,
});
export type SizeSave = z.infer<typeof SizeSave>;

/** A change to sizes as Recent changes lists it: what it did, and the size by its Thing and property. */
export const SizeChange = z.object({
  did: z.enum(["added", "changed", "removed"]),
  name: z.string(),
});
export type SizeChange = z.infer<typeof SizeChange>;
