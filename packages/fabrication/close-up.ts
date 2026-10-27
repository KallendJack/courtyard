// A step's close-up (#699): a flat drawing of what it makes, out of build.ts (over 400 lines).

/**
 * The close-ups drawn by type (#813), the same for any Build, each from the pieces it joins and
 * their sizes: how a fixing is made (`close-ups/`), shown on every step that makes one, and a
 * technique, shown in full the first time the steps use it and a "how?" tap after.
 */
export const FIXING_TYPES = ["bracket", "bolt-through", "screwed-overlap"] as const;
export const TECHNIQUE_TYPES = [
  "measure-mark",
  "driving-screw",
  // The first-time skills (#778).
  "pilot-hole",
  "countersink",
  "square-frame",
] as const;
export type FixingType = (typeof FIXING_TYPES)[number];
export type TechniqueType = (typeof TECHNIQUE_TYPES)[number];
export type CloseUpType = FixingType | TechniqueType;

type Point = { readonly x: number; readonly y: number };

/**
 * A face of something drawn in 3D (#813), already projected: timber, sheet, steel (a bracket),
 * a tape's blade, a tool, the clutch ring, or the area to drill first or just screw; a side or an
 * end drawn darker than a top.
 */
export type CloseUpFace = {
  readonly points: readonly Point[];
  readonly fill:
    | "timber"
    | "sheet"
    | "steel"
    | "tape"
    | "tool"
    | "ring"
    | "drill-first"
    | "just-screw";
  readonly shade?: "side" | "end";
};

/** A line drawn on it (#813): in pencil (a tick, a cross), a piece's edge marked, or a screw's way in. */
export type CloseUpStroke = {
  readonly from: Point;
  readonly to: Point;
  readonly look: "pencil" | "edge" | "path";
};

/**
 * A label of 2-3 words in a pill off the drawing (#813), from its point (its left end, centred up
 * and down), with a leader to what it's about and the badge of the move it is, when it's one:
 * plain, or the place to drill first (`warn`) or just screw (`fine`).
 */
export type CloseUpPill = {
  readonly x: number;
  readonly y: number;
  readonly says: string;
  readonly to?: Point;
  readonly badge?: number;
  readonly tone?: "plain" | "warn" | "fine";
};

/**
 * What a close-up draws as its shape rather than a block (#783): a nut or a bolt's head (a hex,
 * `across` its flats); a tool on one, its jaw at `x`, `y` and its handle `length` out at `turn`
 * degrees (0 to the right, clockwise); a clockwise arrow round one; or a castor upside down from
 * the side, its plate `w` long from `x`, `y` (its top left), its swivel and its wheel (`wheel`
 * across) standing up from it.
 */
export type CloseUpShape =
  | { readonly kind: "hex"; readonly x: number; readonly y: number; readonly across: number }
  | {
      readonly kind: "open-spanner" | "adjustable" | "pliers" | "socket";
      readonly x: number;
      readonly y: number;
      readonly jaw: number;
      readonly length: number;
      readonly turn: number;
      /** Turned from underneath, in red as the castors' board draws it (#826). */
      readonly under?: boolean;
    }
  | { readonly kind: "clockwise"; readonly x: number; readonly y: number; readonly r: number }
  | {
      readonly kind: "castor";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly plate: number;
      readonly wheel: number;
    };

/**
 * What a close-up's screw spots or mark ask, said by code so it's never left to guess (#826):
 * placed by eye or measured (a measured mark with its number), and for screw spots whether to
 * drill a pilot hole first (with its bit) or just screw, by the pilot rule (#789).
 */
export type CloseUpAnswers = {
  readonly placed: "eye" | "measure";
  readonly mm?: number;
  readonly drill?: { readonly first: boolean; readonly bit?: number };
};

/**
 * A step's close-up: a flat view of what it makes, in mm from the view's top left corner (`y`
 * down), with its key sizes as dimension lines and where each fixing goes.
 */
export type CloseUp = {
  readonly title: string;
  /** Its type, when it's drawn by one (#813); none for a drawing of what one step makes. */
  readonly type?: CloseUpType;
  readonly width: number;
  readonly height: number;
  readonly pieces: readonly {
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }[];
  readonly dimensions: readonly {
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
    readonly mm: number;
  }[];
  readonly fixings: readonly { readonly x: number; readonly y: number }[];
  readonly notes: readonly string[];
  /** Tools, nuts and castors drawn as their shape (#783). */
  readonly shapes?: readonly CloseUpShape[];
  /**
   * Words on the drawing, a few each (#783), each starting at its point and centred on it up and
   * down, at a size to read whatever the drawing's scale: a heading ("Underneath"), a label
   * ("washer"), or what the drawing is about, picked out (`key`).
   */
  readonly labels?: readonly {
    readonly x: number;
    readonly y: number;
    readonly says: string;
    readonly heading?: boolean;
    readonly key?: boolean;
    /**
     * What's done or goes underneath, in red (#826, the castors' board); a quiet note under the
     * drawing; or a piece's name, in its wood's colour (the end frames' board).
     */
    readonly tone?: "under" | "note" | "wood";
  }[];
  /** What's drawn in 3D, projected, far to near (#813). */
  readonly faces?: readonly CloseUpFace[];
  readonly strokes?: readonly CloseUpStroke[];
  readonly pills?: readonly CloseUpPill[];
  readonly answers?: CloseUpAnswers;
};
