import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ChangeId,
  type RecordSource,
  SizeRecord,
  type SizeRecordId,
  type SizeSave,
  type SizeValue,
  SubjectId,
  type ThingSlug,
} from "@courtyard/contract";
import { writeTextFileIn } from "../../../lib/files.ts";
import { err, ok, type Result } from "../../../lib/result.ts";
import {
  type PlanningFilesTarget,
  planningChange,
  planningFolder,
} from "../../planning-files/index.ts";
import {
  type ReadThing,
  readThingsIn,
  readThingText,
  thingPath,
  thingText,
} from "../../things/index.ts";
import {
  type ReadSize,
  type ReadSizes,
  readSizesIn,
  recordText,
  SIZES_FOLDER,
  type SizeRefusal,
  sameName,
  sameValue,
  sizePath,
  standing,
  thingsBySubject,
  valueText,
} from "./index.ts";

// Saving sizes (#708, #709): records added or corrected, several as one change with one Undo,
// a Thing given its subject ID with its first record in the same change.

/**
 * A size to record: a new one of a Thing (by its file's name), or a correction of a standing
 * record, by its ID and the revision read, with its value, source and the day it was observed.
 * Or one of two answers settled: a standing record corrected to another of the same size, kept,
 * by the revision of it that was read.
 */
export type SizeEdit =
  | ({
      readonly value: SizeValue;
      readonly source: RecordSource;
      readonly observed: string;
    } & (
      | { readonly kind: "add"; readonly thing: ThingSlug; readonly property: string }
      | { readonly kind: "correct"; readonly id: SizeRecordId; readonly revision: number }
    ))
  | {
      readonly kind: "settle";
      readonly id: SizeRecordId;
      readonly revision: number;
      readonly kept: { readonly id: SizeRecordId; readonly revision: number };
    };

/** A saved size: its note, the change it was committed as (if git kept it), and the record. */
export type SizeSaved = {
  readonly save: SizeSave;
  readonly change: ChangeId | undefined;
  readonly size: ReadSize;
};

/** Where the old sizes found for a Thing are kept as confirmed, once (#709), by its subject. */
export const confirmedPath = (subject: SubjectId) => `${SIZES_FOLDER}/confirmed/${subject}.json`;

/** What a batch of edits works against: the records and Things as they are, as each edit leaves them. */
type Working = {
  sizes: ReadSize[];
  readonly problems: ReadSizes["problems"];
  readonly things: readonly ReadThing[];
  /** The subject IDs given in this change, by the Thing's file's name, each written once. */
  readonly given: Map<ThingSlug, SubjectId>;
  readonly writes: Map<string, string>;
  readonly now: number;
};

/** A Thing's subject ID, given now (its file written with it) when it has none yet (ADR 0037). */
const subjectOf = (working: Working, thing: ReadThing): Result<SubjectId, SizeRefusal> => {
  const { slug, subject } = thing.summary;
  const had = subject ?? working.given.get(slug);
  if (had !== undefined) return ok(had);
  const fields = readThingText(thing.text);
  if (!fields.ok) return err({ kind: "storage" });
  const given = SubjectId.parse(randomUUID());
  working.given.set(slug, given);
  working.writes.set(
    thingPath(slug),
    thingText({ ...fields.value.fields, subject: given }, fields.value.history),
  );
  return ok(given);
};

/** One edit worked out against `working`, which it leaves as the edit does: its note. */
const applyEdit = (
  working: Working,
  edit: SizeEdit,
): Result<Omit<SizeSaved, "change">, SizeRefusal> => {
  if (edit.kind === "settle") {
    // The one kept must still stand as read, and be an answer for the same size.
    const kept = working.sizes.find(({ record }) => record.id === edit.kept.id);
    if (kept === undefined) return err({ kind: "not-found", id: edit.kept.id });
    if (!standing(kept) || kept.record.revision !== edit.kept.revision) {
      return err({ kind: "stale", size: kept });
    }
    const other = working.sizes.find(({ record }) => record.id === edit.id)?.record;
    if (
      other !== undefined &&
      (other.id === kept.record.id ||
        other.subject !== kept.record.subject ||
        sameName(other.property) !== sameName(kept.record.property))
    ) {
      return err({ kind: "invalid", problem: "Only another answer for the same size is settled." });
    }
    const { value, source, observed } = kept.record;
    const { id, revision } = edit;
    return applyEdit(working, { kind: "correct", id, revision, value, source, observed });
  }
  const bySubject = thingsBySubject(working.things);
  let subject: SubjectId;
  let property: string;
  let revision = 1;
  let thingName = "a Thing";
  let corrected: ReadSize | undefined;
  if (edit.kind === "add") {
    const thing = working.things.find(({ summary }) => summary.slug === edit.thing);
    if (thing === undefined) return err({ kind: "no-thing", thing: edit.thing });
    const given = subjectOf(working, thing);
    if (!given.ok) return given;
    subject = given.value;
    property = edit.property;
    thingName = thing.summary.name;
    const there = working.sizes.find(
      (size) =>
        standing(size) &&
        size.record.subject === subject &&
        size.record.property.toLowerCase() === property.trim().toLowerCase() &&
        sameValue(size.record.value, edit.value) &&
        size.record.source.kind === edit.source.kind,
    );
    if (there !== undefined) return err({ kind: "unchanged", size: there });
  } else {
    const editing = edit.id;
    corrected = working.sizes.find(({ record }) => record.id === editing);
    if (corrected === undefined) {
      const problem = working.problems.find(({ path }) => path === sizePath(editing));
      return problem === undefined
        ? err({ kind: "not-found", id: editing })
        : err({ kind: "unreadable", ...problem });
    }
    const { record } = corrected;
    if (!standing(corrected) || record.revision !== edit.revision) {
      return err({ kind: "stale", size: corrected });
    }
    if (sameValue(record.value, edit.value) && record.source.kind === edit.source.kind) {
      return err({ kind: "unchanged", size: corrected });
    }
    subject = record.subject;
    property = record.property;
    revision = record.revision + 1;
    thingName = bySubject.get(subject)?.name ?? thingName;
  }
  const made = SizeRecord.safeParse({
    id: randomUUID(),
    subject,
    property,
    value: edit.value,
    source: edit.source,
    observed: edit.observed,
    recorded: new Date(working.now).toISOString(),
    revision,
  });
  if (!made.success) {
    return err({ kind: "invalid", problem: made.error.issues[0]?.message ?? "" });
  }
  const record = made.data;
  const size = { record, path: sizePath(record.id) };
  working.writes.set(size.path, recordText(record));
  working.sizes.push(size);
  if (corrected !== undefined) {
    const was = { ...corrected.record, supersededBy: record.id };
    working.writes.set(corrected.path, recordText(was));
    working.sizes = working.sizes.map((one) => (one === corrected ? { ...one, record: was } : one));
  }
  return ok({
    save: {
      action: edit.kind,
      size: { id: record.id, thing: thingName, property: record.property },
      value: valueText(record.value),
      source: record.source.kind,
    },
    size,
  });
};

/**
 * Records sizes, or corrects them, as one change with one Undo (#709): the old sizes confirmed,
 * or two answers settled. A Thing gets its subject ID with its first record, in the same change.
 * `confirmed` marks a Thing's old sizes confirmed, giving it a subject ID if need be. Nothing is
 * written when any edit is refused.
 */
export const saveSizes = async (
  target: PlanningFilesTarget,
  edits: readonly SizeEdit[],
  options: { readonly now: number; readonly title?: string; readonly confirmed?: ThingSlug },
): Promise<Result<{ saves: SizeSaved[]; change: ChangeId | undefined }, SizeRefusal>> => {
  let title = "";
  const paths: string[] = [];
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<Omit<SizeSaved, "change">[], SizeRefusal>> => {
      const folder = await planningFolder(target);
      if (!folder.ok) return folder;
      const [read, things] = await Promise.all([
        readSizesIn(folder.value),
        readThingsIn(folder.value),
      ]);
      if (!read.ok) return read;
      if (!things.ok) return err({ kind: "storage" });
      const working: Working = {
        sizes: [...read.value.sizes],
        problems: read.value.problems,
        things: things.value.things,
        given: new Map(),
        writes: new Map(),
        now: options.now,
      };
      const saves: Omit<SizeSaved, "change">[] = [];
      for (const edit of edits) {
        const one = applyEdit(working, edit);
        if (!one.ok) return one;
        saves.push(one.value);
      }
      if (options.confirmed !== undefined) {
        const thing = working.things.find(({ summary }) => summary.slug === options.confirmed);
        if (thing === undefined) return err({ kind: "no-thing", thing: options.confirmed });
        const subject = subjectOf(working, thing);
        if (!subject.ok) return subject;
        const confirmed = { confirmed: new Date(options.now).toISOString() };
        working.writes.set(confirmedPath(subject.value), `${JSON.stringify(confirmed)}\n`);
      }
      for (const [path, text] of working.writes) {
        if (!(await writeTextFileIn(join(folder.value, path), text))) {
          return err({ kind: "storage" });
        }
        paths.push(path);
      }
      const [first] = saves;
      title =
        options.title ??
        (first === undefined
          ? "Sizes"
          : `${first.save.action === "add" ? "Record" : "Correct"} size: ${first.save.size.thing}, ${first.save.size.property}`);
      return ok(saves);
    },
    () => planningChange(target, { kind: "size", title, paths }),
  );
  if (!saved.ok) return saved;
  const change = saved.value.id;
  return ok({ saves: saved.value.value.map((one) => ({ ...one, change })), change });
};

/** Records a size, or corrects one, as one change: the size tool's save. */
export const saveSize = async (
  target: PlanningFilesTarget,
  edit: SizeEdit,
  options: { readonly now: number },
): Promise<Result<SizeSaved, SizeRefusal>> => {
  const saved = await saveSizes(target, [edit], options);
  if (!saved.ok) return saved;
  const [one] = saved.value.saves;
  return one === undefined ? err({ kind: "storage" }) : ok(one);
};
