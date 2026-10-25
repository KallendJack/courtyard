import type { Box } from "./build.ts";

// What a step's picture is made of (#754): its pieces and the marks over them, in the Build's mm.

/** A point in a step's scene, in mm, as a box's corner is: `x` along, `y` back, `z` up. */
export type At = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Something drawn in a step's scene: a part (with its letter), something fitted, a tool, or the
 * offcut on the waste side. This step's own are lit, those put on before are faint (built), and
 * the rest plain.
 */
export type ScenePiece = {
  readonly kind: "part" | "fitted" | "tool" | "offcut";
  readonly name: string;
  readonly label: string | null;
  readonly tone: "lit" | "built" | "plain";
  readonly boxes: readonly Box[];
};

/**
 * What's drawn over a scene, each from the Build's numbers: a size as a dimension line, a pencil
 * line on a piece, an arrow (where the saw runs, where a screw goes in), a corner-to-corner check,
 * a note at a place (where the support goes, the waste side), and a callout: words off the model
 * with a short leader to what they're about, in the owner's colour for their own tools and where
 * things go, or the next action's (#783).
 */
export type SceneMark =
  | { readonly kind: "size"; readonly from: At; readonly to: At; readonly mm: number }
  | { readonly kind: "line"; readonly from: At; readonly to: At; readonly says: string }
  | { readonly kind: "arrow"; readonly from: At; readonly to: At; readonly says: string }
  | { readonly kind: "check"; readonly from: At; readonly to: At; readonly mm: number }
  | {
      readonly kind: "note";
      readonly at: At;
      readonly says: string;
      readonly tone: "plain" | "waste" | "check";
    }
  | {
      readonly kind: "callout";
      readonly at: At;
      /** A few words, then a line more under them. */
      readonly says: string;
      readonly more?: string;
      readonly tone: "yours" | "next";
    };

/**
 * A step's picture (#754): the job as it's done (the length in the Workmate, an end frame flat on
 * the floor, the frame so far), in its own mm, with where it opens from.
 */
export type Scene = {
  /** What it shows, as the picture's heading: "In the Workmate". */
  readonly title: string;
  /**
   * Where it opens from, in degrees: turned from the front (towards the right end is +) and up
   * from level, between 15 and 60.
   */
  readonly view: { readonly turn: number; readonly tilt: number };
  readonly pieces: readonly ScenePiece[];
  readonly marks: readonly SceneMark[];
};
