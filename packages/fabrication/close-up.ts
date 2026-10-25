// A step's close-up (#699): a flat drawing of what it makes, out of build.ts (over 400 lines).

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
 * A step's close-up: a flat view of what it makes, in mm from the view's top left corner (`y`
 * down), with its key sizes as dimension lines and where each fixing goes.
 */
export type CloseUp = {
  readonly title: string;
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
  }[];
};
