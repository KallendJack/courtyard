import { z } from "zod";

// A step's close-ups, as Fabrication draws them (#699, #783, #813): out of derived.ts (over 400
// lines), their shapes the engine's close-up.ts.

/** A list as the engine gives it, never changed once worked out. */
const list = <T extends z.ZodType>(item: T) => z.array(item).readonly();

const Point = z.object({ x: z.number(), y: z.number() });

/**
 * What a close-up draws as its shape rather than a block (#783): a nut or a bolt's head (a hex,
 * `across` its flats), a tool on one, its jaw at `x`, `y` and its handle `length` out at
 * `turn` degrees (0 to the right, clockwise), a clockwise arrow round one, or a castor upside
 * down from the side: its plate `w` long from `x`, `y` (its top left), its swivel and its wheel
 * (`wheel` across) standing up from it.
 */
const CloseUpShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hex"), x: z.number(), y: z.number(), across: z.number() }),
  z.object({
    kind: z.enum(["open-spanner", "adjustable", "pliers", "socket"]),
    x: z.number(),
    y: z.number(),
    jaw: z.number(),
    length: z.number(),
    turn: z.number(),
  }),
  z.object({ kind: z.literal("clockwise"), x: z.number(), y: z.number(), r: z.number() }),
  z.object({
    kind: z.literal("castor"),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    plate: z.number(),
    wheel: z.number(),
  }),
]);

/**
 * A step's close-up (#699): a flat view of what it makes, in mm from its top left (`y` down), its
 * key sizes as dimension lines and a dot where each fixing goes; tools drawn as their shape and
 * words on the drawing where it has them (#783).
 */
export const BuildCloseUp = z.object({
  title: z.string(),
  /**
   * Its type, when it's drawn by one (#813): how a fixing is made, or a technique, the same for
   * any Build.
   */
  type: z
    .enum(["bracket", "bolt-through", "screwed-overlap", "measure-mark", "driving-screw"])
    .optional(),
  width: z.number(),
  height: z.number(),
  pieces: list(
    z.object({ label: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  ),
  dimensions: list(z.object({ from: Point, to: Point, mm: z.number() })),
  fixings: list(Point),
  notes: list(z.string()),
  shapes: list(CloseUpShape).optional(),
  labels: list(
    z.object({
      x: z.number(),
      y: z.number(),
      says: z.string(),
      heading: z.boolean().optional(),
      /** What the drawing is about, picked out: the washer under the nut. */
      key: z.boolean().optional(),
    }),
  ).optional(),
  /**
   * What a close-up by type draws in 3D (#813), already laid flat, far to near: each face's
   * corners, what it is, and whether it's a side or an end, drawn darker.
   */
  faces: list(
    z.object({
      points: list(Point),
      fill: z.enum([
        "timber",
        "sheet",
        "steel",
        "tape",
        "tool",
        "ring",
        "drill-first",
        "just-screw",
      ]),
      shade: z.enum(["side", "end"]).optional(),
    }),
  ).optional(),
  /** Lines on it: pencil (a tick, a cross), a piece's edge marked, a screw's way in. */
  strokes: list(
    z.object({ from: Point, to: Point, look: z.enum(["pencil", "edge", "path"]) }),
  ).optional(),
  /**
   * Its labels, 2-3 words in a pill off the drawing, each from its point with a leader to what
   * it's about and the badge of the move it is.
   */
  pills: list(
    z.object({
      x: z.number(),
      y: z.number(),
      says: z.string(),
      to: Point.optional(),
      badge: z.number().int().optional(),
      tone: z.enum(["plain", "warn", "fine"]).optional(),
    }),
  ).optional(),
  /**
   * What its screw spots or mark ask (#826): placed by eye or measured (with its number), and
   * whether to drill first (with its bit) or just screw.
   */
  answers: z
    .object({
      placed: z.enum(["eye", "measure"]),
      mm: z.number().optional(),
      drill: z.object({ first: z.boolean(), bit: z.number().optional() }).optional(),
    })
    .optional(),
});
