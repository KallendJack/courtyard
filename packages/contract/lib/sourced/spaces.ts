import { z } from "zod";
import { ChangeId } from "../change-id.ts";
import { BuildSlug } from "../fabrication/builds.ts";
import { ThingKind, ThingSlug } from "../things.ts";
import { WorkspaceId } from "../workspace.ts";
import {
  ObservedDay,
  RecordSourceKind,
  SizeQuantity,
  SizeRecord,
  SizeValue,
  sizeProperty,
} from "./records.ts";
import { SizeRecordId } from "./size.ts";

// A space's sizes in Fabrication (#709, ADR 0037): the room's Things panel. Each size with where it
// came from, the ones that disagree side by side, the sizes the room needs with where to measure
// each, and old sizes found in sentences, offered once to confirm with a tick.

/**
 * One size of a Thing as the panel shows it: its property; its standing records, more than one only
 * when they disagree, none for a size the room needs that isn't recorded yet; what the record it
 * corrected said, when that differs ("was about 2735"); where to measure it, for a size the room
 * needs; the Builds whose steps need it, by their files' names; and whether the guided re-measure
 * asks for it (it isn't measured, or its records disagree).
 */
export const SizeLine = z.object({
  property: z.string(),
  records: z.array(SizeRecord),
  was: z.object({ value: SizeValue, source: RecordSourceKind }).nullable(),
  where: z.string().nullable(),
  builds: z.array(BuildSlug),
  toMeasure: z.boolean(),
});
export type SizeLine = z.infer<typeof SizeLine>;

/** A Thing's sizes: the Thing, by its file's name, name and kind, and its size lines. */
export const ThingSizes = z.object({
  thing: z.object({ slug: ThingSlug, name: z.string(), kind: ThingKind }),
  lines: z.array(SizeLine),
});
export type ThingSizes = z.infer<typeof ThingSizes>;

/**
 * A size found in a sentence written before sizes were records (a Facts line, a project's or the
 * Thing's history, its size): where it was found ("Facts", "Split the garage") and the day it was
 * written, if known; the size it reads as, named by the words around it; and whether it was said
 * roughly ("about 2735"). Its key names it to confirm.
 */
export const OldSize = z.object({
  key: z.string(),
  sentence: z.string(),
  from: z.string(),
  day: ObservedDay.nullable(),
  property: z.string(),
  value: SizeQuantity,
  rough: z.boolean(),
});
export type OldSize = z.infer<typeof OldSize>;

/**
 * A space as Fabrication's room opens it: its workspace, its own sizes, those of the Things in it
 * that have any, the old sizes still to confirm (none once confirmed), and each size file that
 * can't be read.
 */
export const SpaceSizes = z.object({
  workspace: z.object({ id: WorkspaceId, name: z.string() }),
  space: ThingSizes,
  parts: z.array(ThingSizes),
  oldSizes: z.array(OldSize),
  problems: z.array(z.object({ path: z.string(), problem: z.string() })),
});
export type SpaceSizes = z.infer<typeof SpaceSizes>;

/** The sizes a Build's steps need, by the space each is of: the same lines its space shows. */
export const BuildSizes = z.object({ spaces: z.array(ThingSizes) });
export type BuildSizes = z.infer<typeof BuildSizes>;

/** Where a size the owner gives in Fabrication came from: measured, or about. */
export const OwnerSizeSource = z.enum(["measured", "reported"]);
export type OwnerSizeSource = z.infer<typeof OwnerSizeSource>;

/** + Size: a new size of the space or a Thing in it, its value, and measured or about. */
export const SizeAdd = z.object({
  thing: ThingSlug,
  property: sizeProperty,
  value: SizeValue,
  source: OwnerSizeSource,
});
export type SizeAdd = z.infer<typeof SizeAdd>;

/** A size tapped and corrected: the revision read, its new value, and measured or about. */
export const SizeCorrection = z.object({
  revision: z.number().int().positive(),
  value: SizeValue,
  source: OwnerSizeSource,
});
export type SizeCorrection = z.infer<typeof SizeCorrection>;

/**
 * Two answers settled: the record kept, and each other one by the revision read, corrected to the
 * kept one's value and source.
 */
export const SizeKeep = z.object({
  others: z
    .array(z.object({ id: SizeRecordId, revision: z.number().int().positive() }))
    .min(1),
});
export type SizeKeep = z.infer<typeof SizeKeep>;

/**
 * The old sizes confirmed, once: each kept by its key, named as the owner left it, ticked as
 * measured or not (then it's about). One left out isn't recorded.
 */
export const OldSizesConfirm = z.object({
  picks: z.array(z.object({ key: z.string(), property: sizeProperty, measured: z.boolean() })),
});
export type OldSizesConfirm = z.infer<typeof OldSizesConfirm>;

/** A change to a space's sizes: the change, which Undo names (`null` when git couldn't keep it), and the space now. */
export const SpaceChanged = z.object({ change: z.nullable(ChangeId), sizes: SpaceSizes });
export type SpaceChanged = z.infer<typeof SpaceChanged>;
