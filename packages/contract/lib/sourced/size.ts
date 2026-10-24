import { z } from "zod";

// A sourced size (ADR 0036, #696): the one value-with-source shape, which a Build's sizes use now
// and the planning restructure's sourced Facts use once they exist (#701), so a Build's size can
// then point at a Fact rather than hold its own. Never free text: a number, its unit and where it
// came from, each checked. The Facts' own sources (reported, estimated) join `SizeSource` with
// their ADR.

/** Where a size came from: measured by the owner, from a maker's page or a spec, or assumed. */
export const SizeSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measured") }),
  z.object({
    kind: z.literal("specified"),
    /** The maker's page, product code or spec it was read from. */
    reference: z.string().trim().min(1).max(300),
  }),
  z.object({ kind: z.literal("assumed") }),
]);
export type SizeSource = z.infer<typeof SizeSource>;

/** The units a size is given in: millimetres, for now. */
export const SizeUnit = z.enum(["mm"]);
export type SizeUnit = z.infer<typeof SizeUnit>;

/** The biggest size anything here takes: 100 m. */
const MOST = 100_000;

/** A size: its number, its unit and its source, all three required. */
export const SourcedSize = z.object({
  value: z.number().nonnegative().max(MOST),
  unit: SizeUnit,
  source: SizeSource,
});
export type SourcedSize = z.infer<typeof SourcedSize>;
