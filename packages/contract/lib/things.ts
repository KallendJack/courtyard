import { z } from "zod";
import { ChangeId } from "./change-id.ts";

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
export const THING_DETAILS = [
  "brand",
  "bought",
  "price",
  "shop",
  "condition",
  "size",
  "where",
] as const;
export type ThingDetailName = (typeof THING_DETAILS)[number];

/** The longest line saying why an upcoming part was picked, in characters. */
export const THING_WHY_MAX_CHARACTERS = 120;

/**
 * A Thing's upcoming replacement (#602, ADR 0032): the one the owner means to fit next in its
 * place, such as new pedals for the pedals, never a Thing of its own. Its name as the owner would
 * call it (its make and model), what it costs, the shop and the page it's sold on, and one line
 * saying why it was picked.
 */
export const ThingUpcoming = z.object({
  name: oneLine(THING_FIELD_MAX_CHARACTERS, "upcoming part's name"),
  price: oneLine(THING_FIELD_MAX_CHARACTERS, "upcoming part's price").optional(),
  shop: oneLine(THING_FIELD_MAX_CHARACTERS, "upcoming part's shop").optional(),
  /** The page it's sold on, as found on the web. */
  link: z
    .url({ protocol: /^https?$/, error: "Give the link as a web address." })
    .max(500)
    .optional(),
  why: oneLine(THING_WHY_MAX_CHARACTERS, "line saying why").optional(),
});
export type ThingUpcoming = z.infer<typeof ThingUpcoming>;

/**
 * Where a part sits on the photo of the Thing it's part of (#208): how far across and how far
 * down, each a percentage of the photo, to one decimal place.
 */
export const ThingPin = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});
export type ThingPin = z.infer<typeof ThingPin>;

/** A pin as a Thing's file writes it: across, then down, such as `42.5, 61`. */
const PIN_TEXT = /^(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)$/;

/** A pin's text read, or `undefined` when it isn't one: off the photo, say. */
export const pinOf = (text: string): ThingPin | undefined => {
  const [, x, y] = PIN_TEXT.exec(text.trim()) ?? [];
  const pin = ThingPin.safeParse({ x: Number(x), y: Number(y) });
  return x === undefined || !pin.success ? undefined : pin.data;
};

/** A pin as a Thing's file writes it, each to one decimal place. */
export const pinText = (pin: ThingPin) => {
  const tenths = (value: number) => Math.round(value * 10) / 10;
  return `${tenths(pin.x)}, ${tenths(pin.y)}`;
};

/**
 * A Thing's fields as its file's front matter holds them: its name and status, then the details
 * it has, the Thing it's part of (by its file's name, one level only), what it needs next (#208),
 * its pin on that Thing's photo, and its photo.
 */
export const ThingFields = z
  .object({
    name: oneLine(THING_FIELD_MAX_CHARACTERS, "name"),
    status: ThingStatus,
    brand: oneLine(THING_FIELD_MAX_CHARACTERS, "brand").optional(),
    bought: ThingBought.optional(),
    price: oneLine(THING_FIELD_MAX_CHARACTERS, "price").optional(),
    /** Where it was bought (#245), such as Tredz. */
    shop: oneLine(THING_FIELD_MAX_CHARACTERS, "shop").optional(),
    condition: oneLine(THING_FIELD_MAX_CHARACTERS, "condition").optional(),
    size: oneLine(THING_FIELD_MAX_CHARACTERS, "size").optional(),
    where: oneLine(THING_FIELD_MAX_CHARACTERS, "where").optional(),
    partOf: ThingSlug.optional(),
    /**
     * The next thing to do about it, in a few words ("Pump it up before Saturday"), until it's
     * done: what a page shows of it (#208, #220), never background.
     */
    needs: oneLine(THING_FIELD_MAX_CHARACTERS, "next step").optional(),
    /** A part's pin, as `pinText` writes it. */
    pin: z
      .string()
      .refine(
        (text) => pinOf(text) !== undefined,
        "Give the pin as across, then down, each 0 to 100.",
      )
      .optional(),
    photo: ThingPhotoPath.optional(),
    /** Its upcoming replacement's name (#602), and the rest of it: see `ThingUpcoming`. */
    upcoming: ThingUpcoming.shape.name.optional(),
    upcomingPrice: ThingUpcoming.shape.price,
    upcomingShop: ThingUpcoming.shape.shop,
    upcomingLink: ThingUpcoming.shape.link,
    upcomingWhy: ThingUpcoming.shape.why,
  })
  .strict();
export type ThingFields = z.infer<typeof ThingFields>;

/**
 * A Thing as lists show it: its fields, where its file is, whether it has a photo, a part's pin
 * on its Thing's photo (`null` when it has none), and its upcoming replacement, if it has one.
 */
export const ThingSummary = ThingFields.omit({
  photo: true,
  pin: true,
  upcoming: true,
  upcomingPrice: true,
  upcomingShop: true,
  upcomingLink: true,
  upcomingWhy: true,
}).extend({
  pin: ThingPin.nullable(),
  upcoming: ThingUpcoming.optional(),
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

/**
 * A field the owner's form can leave blank (`""`) or out: either way it has none. Kept to Zod
 * features the first load already has, since every Zod feature any page uses loads with it.
 */
const blankable = <T extends z.ZodType>(schema: T) => schema.or(z.literal("")).optional();

/**
 * A Thing as the owner's Add Thing and Edit form gives it: every field, a blank or missing one
 * cleared. Its history and photo are kept as they are.
 */
export const ThingForm = z.object({
  name: oneLine(THING_FIELD_MAX_CHARACTERS, "name"),
  status: ThingStatus,
  brand: blankable(oneLine(THING_FIELD_MAX_CHARACTERS, "brand")),
  bought: blankable(ThingBought),
  price: blankable(oneLine(THING_FIELD_MAX_CHARACTERS, "price")),
  shop: blankable(oneLine(THING_FIELD_MAX_CHARACTERS, "shop")),
  condition: blankable(oneLine(THING_FIELD_MAX_CHARACTERS, "condition")),
  size: blankable(oneLine(THING_FIELD_MAX_CHARACTERS, "size")),
  where: blankable(oneLine(THING_FIELD_MAX_CHARACTERS, "where")),
  /** The Thing it's part of, by its file's name; one that's a part itself can't be. */
  partOf: blankable(ThingSlug).nullable(),
});
export type ThingForm = z.infer<typeof ThingForm>;

/** A part's pin moved by the owner, dragged on its Thing's photo (#208). */
export const ThingPinMove = z.object({ pin: ThingPin });
export type ThingPinMove = z.infer<typeof ThingPinMove>;

/**
 * A part's card on Home (#481): Done it (what it needed is done, and it's had again), or Add to
 * wanted (one the owner has, to replace); or its card's "… fitted" (#602), which swaps its
 * upcoming replacement in, the one it had going to its history.
 */
export const ThingMark = z.object({ mark: z.enum(["done", "wanted", "fitted"]) });
export type ThingMark = z.infer<typeof ThingMark>;

/** The multipart field a Thing's new photo is uploaded in. */
export const THING_PHOTO_FIELD = "photo";

/**
 * The multipart field that holds the form's fields as JSON, when Add Thing or Edit sends a photo
 * with them: the form and the photo go as one request, so they're one change with one Undo.
 */
export const THING_FORM_FIELD = "thing";

/** A Thing saved by the owner, as it is now, and the change that saved it (`null` when git couldn't keep it). */
export const ThingChanged = z.object({ change: z.nullable(ChangeId), thing: ThingSummary });
export type ThingChanged = z.infer<typeof ThingChanged>;

/** A Thing deleted by the owner, and the change that deleted it, which Undo names. */
export const ThingDeleted = z.object({ change: z.nullable(ChangeId) });
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
      shop: z.string().nullable(),
      condition: z.string().nullable(),
      size: z.string().nullable(),
      where: z.string().nullable(),
      /** The name of the Thing it's now part of. */
      partOf: z.string().nullable(),
      needs: z.string().nullable(),
      /** Its pin, as `pinText` writes it. */
      pin: z.string().nullable(),
      /** Its upcoming replacement's name (#602), and the rest of it. */
      upcoming: z.string().nullable(),
      upcomingPrice: z.string().nullable(),
      upcomingShop: z.string().nullable(),
      upcomingLink: z.string().nullable(),
      upcomingWhy: z.string().nullable(),
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
