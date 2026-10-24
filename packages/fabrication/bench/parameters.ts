import { SourcedSize } from "@courtyard/contract";
import { z } from "zod";
import { Fixing, Price, Sheet, Timber, Words } from "../stock.ts";
import { Tool } from "../tools.ts";

// The framed bench's parameters (ADR 0036): what the owner and model choose. Every size carries
// its source, so a size without one is refused here, before anything is worked out.

/**
 * Castors on bases under each end frame: each castor's height and plate, and the bolts, washers
 * and nuts that hold a plate to its base.
 */
export const Castors = z.object({
  name: Words,
  /** From the floor to the top of the plate. */
  height: SourcedSize,
  price: Price.optional(),
  plate: z.object({ length: SourcedSize, width: SourcedSize, thickness: SourcedSize }),
  boltsEach: z.number().int().positive().max(8),
  bolt: z.object({
    diameter: SourcedSize,
    /** The thread's pitch: two threads past the nut is the least that holds. */
    pitch: SourcedSize,
    length: SourcedSize,
    price: Price.optional(),
  }),
  washer: z.object({
    thickness: SourcedSize,
    perBolt: z.number().int().nonnegative().max(4),
    price: Price.optional(),
  }),
  nut: z.object({ height: SourcedSize, price: Price.optional() }),
});
export type Castors = z.infer<typeof Castors>;

export const BenchParameters = z.object({
  /** The top's size and the height to its top surface, mm. */
  length: SourcedSize,
  depth: SourcedSize,
  height: SourcedSize,
  /** What the saw's cut takes. */
  kerf: SourcedSize,
  /** The top, and how far it reaches past the frame on every side. */
  top: z.object({ sheet: Sheet, overhang: SourcedSize }),
  frame: z.object({
    /** Four legs, one in each corner; a middle pair joins this when a longer bench needs one. */
    legs: z.enum(["corners"]),
    /** The legs, the rails and the shelf's support. */
    timber: Timber,
    /** The wider timber: the top's middle support and the castor bases. */
    wide: Timber,
  }),
  /**
   * The lower rails sit `height` above the legs' feet (their undersides). The shelf, when on,
   * rests on the lower long rails between the end frames.
   */
  shelf: z.object({ on: z.boolean(), height: SourcedSize, sheet: Sheet }),
  /** Panels that stop the frame racking: one across the back, one on each end. */
  braces: z.object({ rear: z.boolean(), ends: z.boolean(), sheet: Sheet }),
  /** None when left out, so a change that takes them out (a merge patch's `null`) leaves none. */
  castors: Castors.nullable().default(null),
  fixings: z.object({ frameScrews: Fixing, sheetScrews: Fixing, brackets: Fixing }),
  /** The tools and kit the owner has to hand. */
  tools: z.array(Tool),
});
export type BenchParameters = z.infer<typeof BenchParameters>;

/** The bolts, washers and nuts, as the steps and the buy list name them. */
export const castorFixingNames = (castors: Castors) => {
  const thread = `M${castors.bolt.diameter.value}`;
  return {
    bolts: `${thread} × ${castors.bolt.length.value} bolts`,
    washers: `${thread} washers`,
    nuts: `${thread} lock nuts`,
  };
};
