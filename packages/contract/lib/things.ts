import { z } from "zod";
import { ChangeId } from "./session.ts";

// A workspace's Things (ADR 0020): the owner's kit, a Markdown file each in its `things` folder,
// with fixed fields in front matter and a dated history as the body. Only the pages that show
// them load these.

/** Whether the owner has a Thing, wants one, or means to replace the one they have. */
export const ThingStatus = z.enum(["have", "want", "replace"]);
export type ThingStatus = z.infer<typeof ThingStatus>;

/** A Thing's file name without `.md`: its name's letters and digits, words joined by dashes. */
export const ThingSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80)
  .brand<"ThingSlug">();
export type ThingSlug = z.infer<typeof ThingSlug>;

/** The longest a Thing's field gets, in characters: a few words, never a paragraph. */
export const THING_FIELD_MAX_CHARACTERS = 100;

/** The longest line of a Thing's history, in characters. */
export const THING_HISTORY_MAX_CHARACTERS = 250;

/** One line of free text, as each of a Thing's fields is. */
const oneLine = (max: number, what: string) =>
  z
    .string()
    .trim()
    .min(1, `Give the ${what}.`)
    .max(max, `Keep the ${what} to ${max} characters.`)
    .refine((text) => !/[\r\n]/.test(text), `Keep the ${what} to one line.`);

/** When a Thing was bought: a year, a month (`2026-03`) or a day (`2026-10-09`). */
export const ThingBought = z
  .string()
  .trim()
  .regex(
    /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/,
    "Give the date bought as a year, a month or a day, such as 2026, 2026-03 or 2026-10-09.",
  );

/** A Thing's photo, as its file names it: `photos/<slug>.jpg`, beside the Thing's file. */
export const ThingPhotoPath = z.string().regex(/^photos\/[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/);

/** The fields a Thing may have besides its name and status, all free text but bought. */
export const THING_DETAILS = ["brand", "bought", "price", "condition", "size", "where"] as const;
export type ThingDetailName = (typeof THING_DETAILS)[number];

/**
 * A Thing's fields as its file's front matter holds them: its name and status, then the details
 * it has, the Thing it's part of (by its file's name, one level only) and its photo.
 */
export const ThingFields = z
  .object({
    name: oneLine(THING_FIELD_MAX_CHARACTERS, "name"),
    status: ThingStatus,
    brand: oneLine(THING_FIELD_MAX_CHARACTERS, "brand").optional(),
    bought: ThingBought.optional(),
    price: oneLine(THING_FIELD_MAX_CHARACTERS, "price").optional(),
    condition: oneLine(THING_FIELD_MAX_CHARACTERS, "condition").optional(),
    size: oneLine(THING_FIELD_MAX_CHARACTERS, "size").optional(),
    where: oneLine(THING_FIELD_MAX_CHARACTERS, "where").optional(),
    partOf: ThingSlug.optional(),
    photo: ThingPhotoPath.optional(),
  })
  .strict();
export type ThingFields = z.infer<typeof ThingFields>;

/** A Thing as lists show it: its fields, where its file is, and whether it has a photo. */
export const ThingSummary = ThingFields.omit({ photo: true }).extend({
  slug: ThingSlug,
  /** Its path in the workspace's folder: `things/<slug>.md`. */
  path: z.string(),
  /** Whether it has a photo, which `GET /api/workspaces/:id/things/:slug/photo` gives. */
  photo: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ThingSummary = z.infer<typeof ThingSummary>;

/** A Thing's file that isn't a Thing as written, by hand say, and what's wrong with it. */
export const ThingProblem = z.object({ path: z.string(), problem: z.string() });
export type ThingProblem = z.infer<typeof ThingProblem>;

/**
 * A workspace's Things, each part straight after the Thing it's part of, both in order of name;
 * and the files that couldn't be read as Things.
 */
export const ThingList = z.object({
  things: z.array(ThingSummary),
  problems: z.array(ThingProblem),
});
export type ThingList = z.infer<typeof ThingList>;

/** One line of a Thing's history: its date (`2026-10-09`), when it has one, and what happened. */
export const ThingHistoryEntry = z.object({ date: z.string().nullable(), text: z.string() });
export type ThingHistoryEntry = z.infer<typeof ThingHistoryEntry>;

/** One Thing for its card: what lists show, and its history, newest first. */
export const ThingDetail = z.object({
  thing: ThingSummary,
  history: z.array(ThingHistoryEntry),
});
export type ThingDetail = z.infer<typeof ThingDetail>;

/** A field the owner's form can leave blank: blank is none. */
const blankIsNone = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );

/**
 * A Thing as the owner's Add Thing and Edit form gives it: every field, a blank one left out.
 * Its history and photo are kept as they are.
 */
export const ThingForm = z.object({
  name: oneLine(THING_FIELD_MAX_CHARACTERS, "name"),
  status: ThingStatus,
  brand: blankIsNone(oneLine(THING_FIELD_MAX_CHARACTERS, "brand")),
  bought: blankIsNone(ThingBought),
  price: blankIsNone(oneLine(THING_FIELD_MAX_CHARACTERS, "price")),
  condition: blankIsNone(oneLine(THING_FIELD_MAX_CHARACTERS, "condition")),
  size: blankIsNone(oneLine(THING_FIELD_MAX_CHARACTERS, "size")),
  where: blankIsNone(oneLine(THING_FIELD_MAX_CHARACTERS, "where")),
  /** The Thing it's part of, by its file's name; one that's a part itself can't be. */
  partOf: blankIsNone(ThingSlug).or(z.null()),
});
export type ThingForm = z.infer<typeof ThingForm>;

/** The multipart field a Thing's new photo is uploaded in. */
export const THING_PHOTO_FIELD = "photo";

/** A Thing saved by the owner, as it is now, and the change that saved it (`null` when git couldn't keep it). */
export const ThingChanged = z.object({ change: ChangeId.nullable(), thing: ThingSummary });
export type ThingChanged = z.infer<typeof ThingChanged>;

/** A Thing deleted by the owner, and the change that deleted it, which Undo names. */
export const ThingDeleted = z.object({ change: ChangeId.nullable() });
export type ThingDeleted = z.infer<typeof ThingDeleted>;

/**
 * What one Thing save did (ADR 0020), by the Thing's file's name and its name then: added it,
 * changed it or removed it. For an add or a change, the fields it set (`null` for one it cleared),
 * the line it added to the history, and whether it set the photo.
 */
export const ThingSave = z.object({
  action: z.enum(["add", "change", "remove"]),
  thing: z.object({ slug: ThingSlug, name: z.string() }),
  fields: z
    .object({
      name: z.string(),
      status: ThingStatus,
      brand: z.string().nullable(),
      bought: z.string().nullable(),
      price: z.string().nullable(),
      condition: z.string().nullable(),
      size: z.string().nullable(),
      where: z.string().nullable(),
      /** The name of the Thing it's now part of. */
      partOf: z.string().nullable(),
    })
    .partial()
    .optional(),
  history: z.string().optional(),
  photo: z.literal(true).optional(),
});
export type ThingSave = z.infer<typeof ThingSave>;

/**
 * A change to a Thing as Recent changes lists it: what it did, the Thing's name, and its file's
 * name while it's still there to open.
 */
export const ThingChange = z.object({
  did: z.enum(["added", "changed", "removed"]),
  name: z.string(),
  slug: ThingSlug.nullable(),
});
export type ThingChange = z.infer<typeof ThingChange>;
