import { z } from "zod";
import { SourcedSize } from "../sourced/size.ts";

// A part recipe (#702, ADR 0036): a printed part as data, a base and the features cut into it or
// raised on it, which `packages/fabrication` checks and makes into a solid. A model fills one from
// what the owner said; nothing it writes is run. A new shape is a new recipe, never new code.
//
// Every place is in mm from the base's front left bottom corner: `x` across, `y` back, `z` up.

/** The longest a recipe's words get: an object's name, a screw's, a line of lettering. */
const Words = z.string().trim().min(1).max(80);

/** A chosen size, mm: one the owner decides (a wall's thickness), so it has no source. */
const Mm = z.number().positive().max(1000);

/** A place on a face, mm, from its lower left corner as you look at it: `u` across, `v` up. */
const FacePoint = z.object({
  u: z.number().min(0).max(1000),
  v: z.number().min(0).max(1000),
});

/**
 * A face of the part's box, as you look at it from that side: top and bottom (`u` along `x`, `v`
 * along `y`), front and back (`u` along `x`, `v` up), left and right (`u` along `y`, `v` up).
 */
export const Face = z.enum(["top", "bottom", "front", "back", "left", "right"]);
export type Face = z.infer<typeof Face>;

/**
 * What the part starts as: a box, a flat plate, a cylinder standing up, or an L-bracket (a flat
 * leg `depth` deep along the front, and an upright leg at its back, `height` tall).
 */
export const PartBase = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("box"), width: Mm, depth: Mm, height: Mm }),
  z.strictObject({ kind: z.literal("plate"), width: Mm, depth: Mm, thickness: Mm }),
  z.strictObject({ kind: z.literal("cylinder"), diameter: Mm, height: Mm }),
  z.strictObject({
    kind: z.literal("l-bracket"),
    width: Mm,
    depth: Mm,
    height: Mm,
    thickness: Mm,
  }),
]);
export type PartBase = z.infer<typeof PartBase>;

/** A screw a hole is for: its name as bought, and its shank's diameter, with where that came from. */
export const PartScrew = z.strictObject({ name: Words, diameter: SourcedSize });
export type PartScrew = z.infer<typeof PartScrew>;

/** Something a pocket holds, with its size each way and where each came from. */
const PocketObject = z.strictObject({
  name: Words,
  /** Across the face. */
  width: SourcedSize,
  /** Up the face. */
  height: SourcedSize,
  /** Into the face. */
  depth: SourcedSize,
});

/** The sides of a face a pocket runs out through, as you look at it, so it's open that way. */
const FaceSide = z.enum(["up", "down", "left", "right"]);

/**
 * What's done to the base, in order: holes (plain, or countersunk so a screw's head sits flush),
 * slots, pockets sized from an object, fillets and chamfers on the base's upright corners, and
 * lettering raised on a face or cut into it. A hole or slot goes right through, from the face;
 * where it first meets the part, a countersink is cut.
 */
export const PartFeature = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("hole"),
    face: Face,
    at: FacePoint,
    screw: PartScrew,
    countersunk: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal("slot"),
    face: Face,
    /** Its middle. */
    at: FacePoint,
    /** End to end, across the face (`u`), round ends included. */
    length: Mm,
    screw: PartScrew,
  }),
  z.strictObject({
    kind: z.literal("pocket"),
    face: Face,
    object: PocketObject,
    /** Its middle; the face's middle when left out. */
    at: FacePoint.optional(),
    open: z.array(FaceSide).max(4).default([]),
  }),
  z.strictObject({ kind: z.literal("fillet"), radius: Mm }),
  z.strictObject({ kind: z.literal("chamfer"), size: Mm }),
  z.strictObject({
    kind: z.literal("text"),
    face: Face,
    text: Words,
    /** Its middle; the face's middle when left out. */
    at: FacePoint.optional(),
    /** A capital's height. */
    size: Mm,
    depth: Mm,
    style: z.enum(["raised", "cut"]),
  }),
]);
export type PartFeature = z.infer<typeof PartFeature>;

/** The kinds of feature a recipe can have. */
export const PART_FEATURES = PartFeature.options.map((option) => option.shape.kind.value);

/**
 * The printer a part is made for: its plate, how much its holes and pockets need on top of an
 * object's size to fit (calibrated, or assumed until it is), and its nozzle, which sets the
 * thinnest wall it prints well. The plate is the P1S's until the printer's Thing gives its own.
 */
export const PrinterSpec = z.strictObject({
  plate: z
    .strictObject({ width: Mm, depth: Mm, height: Mm })
    .default({ width: 256, depth: 256, height: 256 }),
  clearance: SourcedSize.default({ value: 0.2, unit: "mm", source: { kind: "assumed" } }),
  nozzle: SourcedSize.default({ value: 0.4, unit: "mm", source: { kind: "assumed" } }),
});
export type PrinterSpec = z.infer<typeof PrinterSpec>;

/** The most features one part has. */
const PART_FEATURES_MOST = 40;

/**
 * A part recipe as written: its base, and its features, each checked on its own so a feature of
 * an unknown kind is found and named rather than the whole recipe refused unread.
 */
export const PartRecipe = z.strictObject({
  base: PartBase,
  features: z
    .array(z.looseObject({ kind: z.string() }))
    .max(PART_FEATURES_MOST)
    .default([]),
});
export type PartRecipe = z.infer<typeof PartRecipe>;
