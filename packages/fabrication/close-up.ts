// A step's close-up (#699): a flat drawing of what it makes, out of build.ts (over 400 lines).

/**
 * What a close-up draws as its shape rather than a block (#783): a nut or a bolt's head (a hex,
 * `across` its flats); a tool on one, its jaw at `x`, `y` and its handle `length` out at `turn`
 * degrees (0 to the right, clockwise); or a clockwise arrow round one.
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
  | { readonly kind: "clockwise"; readonly x: number; readonly y: number; readonly r: number };

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
  /** Tools and nuts drawn as their shape (#783). */
  readonly shapes?: readonly CloseUpShape[];
  /** Words on the drawing, a few each (#783): a heading ("Underneath") or a label ("washer"). */
  readonly labels?: readonly {
    readonly x: number;
    readonly y: number;
    readonly says: string;
    readonly heading?: boolean;
  }[];
};
