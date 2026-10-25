import { z } from "zod";

// A sourced size (ADR 0036, #696): the one value-with-source shape a Build's sizes use. Never free
// text: a number, its unit and where it came from, each checked. A size record (`records.ts`,
// #708) holds the same `{ value, unit }` with a source of its own; a Build's size points at its
// record only once records take over (#711), checked then that the record is there.

/** A size record's ID, given by the worker, and its file's name (`sizes/<id>.json`). */
export const SizeRecordId = z.uuid().brand<"SizeRecordId">();
export type SizeRecordId = z.infer<typeof SizeRecordId>;

/** From a maker's page or a spec, as a Build's size and a size record both have it. */
export const SpecifiedSource = z.object({
  kind: z.literal("specified"),
  /** The maker's page, product code or spec it was read from. */
  reference: z.string().trim().min(1).max(300),
});

/** Where a size came from: measured by the owner, from a maker's page or a spec, or assumed. */
export const SizeSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measured") }),
  SpecifiedSource,
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
