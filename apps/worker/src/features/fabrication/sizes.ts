import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ChangeId,
  type RecordSource,
  SizeRecord,
  SizeRecordId,
  type SizeRow,
  type SizeSave,
  type SizeValue,
  SubjectId,
  type ThingSlug,
} from "@courtyard/contract";
import { listFolder, readTextFile, writeTextFileIn } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { undoWholeFiles, type WholeFile } from "../context-folder/index.ts";
import {
  type PlanningFilesTarget,
  type PlanningFolderRefusal,
  pathInWorkspace,
  planningChange,
  planningFolder,
} from "../planning-files/index.ts";
import {
  type ReadThing,
  readThingsIn,
  readThingText,
  thingPath,
  thingText,
} from "../things/index.ts";

/**
 * Size records (ADR 0037, #708), hosted in a planning workspace: a JSON file each in its `sizes`
 * folder, named by its ID. A record is of a Thing, by the subject ID the Thing gets with its first
 * one. A correction is a record of its own, the next revision, and the one it corrects says it
 * was superseded; a different value for the same thing that isn't a correction is kept beside it,
 * and nothing wins on its own. Every write is one change through the context folder, with Undo.
 */

/** The folder in a workspace's folder that holds its size records. */
export const SIZES_FOLDER = "sizes";

/** A record's path in its workspace's folder. */
export const sizePath = (id: SizeRecordId) => `${SIZES_FOLDER}/${id}.json`;

/** A record's file as written: its fields in order, two spaces in, a line ending at the end. */
const recordText = (record: SizeRecord) => `${JSON.stringify(record, null, 2)}\n`;

/** A record's file read, or what's wrong with it. */
export const readSizeText = (text: string): Result<SizeRecord, string> => {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return err("It isn't JSON.");
  }
  const record = SizeRecord.safeParse(json);
  if (record.success) return ok(record.data);
  const [issue] = record.error.issues;
  return err(`It isn't a size record: ${issue?.path.join(".") || "its file"}: ${issue?.message}`);
};

/** A value as the owner reads it: `4260 mm`, `30°`, `stud partition`, `yes`. */
export const valueText = (value: SizeValue) =>
  value.kind === "quantity"
    ? value.unit === "deg"
      ? `${value.value}°`
      : `${value.value} ${value.unit}`
    : value.kind === "text"
      ? value.text
      : value.yes
        ? "yes"
        : "no";

const sameValue = (a: SizeValue, b: SizeValue) => JSON.stringify(a) === JSON.stringify(b);

/** A record as read, and its path in the workspace's folder. */
export type ReadSize = { readonly record: SizeRecord; readonly path: string };

/** A workspace's records, oldest first, and the files that aren't records as written. */
export type ReadSizes = {
  readonly sizes: readonly ReadSize[];
  readonly problems: readonly { readonly path: string; readonly problem: string }[];
};

/** Why a size wasn't read or saved. */
export type SizeRefusal =
  | PlanningFolderRefusal
  /** It doesn't fit: a property too long, say. */
  | { readonly kind: "invalid"; readonly problem: string }
  | { readonly kind: "no-thing"; readonly thing: ThingSlug }
  | { readonly kind: "not-found"; readonly id: SizeRecordId }
  /** Its file isn't a record as written (a hand edit, say), so it can't be corrected. */
  | { readonly kind: "unreadable"; readonly path: string; readonly problem: string }
  /** It's recorded already, with that value and source. */
  | { readonly kind: "unchanged"; readonly size: ReadSize }
  /** It's been corrected since the revision read, or isn't that revision: the record as it is. */
  | { readonly kind: "stale"; readonly size: ReadSize }
  | { readonly kind: "storage" };

const readSizesIn = async (folder: string): Promise<Result<ReadSizes, SizeRefusal>> => {
  const names = await listFolder(join(folder, SIZES_FOLDER));
  if (!names.ok) return err({ kind: "storage" });
  const sizes: ReadSize[] = [];
  const problems: { path: string; problem: string }[] = [];
  for (const name of names.value.sort()) {
    if (!name.endsWith(".json")) continue;
    const path = `${SIZES_FOLDER}/${name}`;
    const text = await readTextFile(join(folder, path));
    if (!text.ok) return err({ kind: "storage" });
    if (text.value === undefined) continue;
    const read = readSizeText(text.value);
    if (!read.ok) {
      problems.push({ path, problem: read.error });
    } else if (name !== `${read.value.id}.json`) {
      problems.push({ path, problem: "Its file name isn't its ID." });
    } else {
      sizes.push({ record: read.value, path });
    }
  }
  sizes.sort((a, b) => a.record.recorded.localeCompare(b.record.recorded));
  return ok({ sizes, problems });
};

/** A planning workspace's size records, oldest first, and the files that aren't records. */
export const readSizes = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
): Promise<Result<ReadSizes, SizeRefusal>> => {
  const folder = await planningFolder(target);
  return folder.ok ? readSizesIn(folder.value) : folder;
};

/** Whether a record stands: nothing has corrected it. */
export const standing = ({ record }: ReadSize) => record.supersededBy === undefined;

/**
 * Each standing record's conflicts: the other standing records of the same thing (its subject and
 * property) with a different value, by ID.
 */
export const conflictsOf = (sizes: readonly ReadSize[]) => {
  const key = ({ record }: ReadSize) => `${record.subject} ${record.property.toLowerCase()}`;
  const standing = sizes.filter((size) => size.record.supersededBy === undefined);
  return new Map(
    standing.map((size) => [
      size.record.id,
      standing
        .filter(
          (other) => key(other) === key(size) && !sameValue(other.record.value, size.record.value),
        )
        .map((other) => other.record.id),
    ]),
  );
};

/** The Thing each subject is, by its subject ID. */
const thingsBySubject = (things: readonly ReadThing[]) =>
  new Map(
    things.flatMap(({ summary }) =>
      summary.subject === undefined ? [] : [[summary.subject, summary] as const],
    ),
  );

/** A workspace's records as Fabrication's API answers them, each with its Thing and conflicts. */
export const sizeRows = (sizes: readonly ReadSize[], things: readonly ReadThing[]): SizeRow[] => {
  const conflicts = conflictsOf(sizes);
  const bySubject = thingsBySubject(things);
  return sizes.map(({ record, path }) => {
    const thing = bySubject.get(record.subject);
    return {
      record,
      path,
      thing: thing === undefined ? null : { slug: thing.slug, name: thing.name },
      conflicts: conflicts.get(record.id) ?? [],
    };
  });
};

/**
 * A size to record: a new one of a Thing (by its file's name), or a correction of a standing
 * record, by its ID and the revision read. Its value, source and the day it was observed.
 */
export type SizeEdit = {
  readonly value: SizeValue;
  readonly source: RecordSource;
  readonly observed: string;
} & (
  | { readonly kind: "add"; readonly thing: ThingSlug; readonly property: string }
  | { readonly kind: "correct"; readonly id: SizeRecordId; readonly revision: number }
);

/** A saved size: its note, the change it was committed as (if git kept it), and the record. */
export type SizeSaved = {
  readonly save: SizeSave;
  readonly change: ChangeId | undefined;
  readonly size: ReadSize;
};

/**
 * Records a size, or corrects one, as one change. The Thing it's of gets its subject ID with its
 * first record, in the same change, so Undo takes both back.
 */
export const saveSize = async (
  target: PlanningFilesTarget,
  edit: SizeEdit,
  options: { readonly now: number },
): Promise<Result<SizeSaved, SizeRefusal>> => {
  let title = "";
  const paths: string[] = [];
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<Omit<SizeSaved, "change">, SizeRefusal>> => {
      const folder = await planningFolder(target);
      if (!folder.ok) return folder;
      const [read, things] = await Promise.all([
        readSizesIn(folder.value),
        readThingsIn(folder.value),
      ]);
      if (!read.ok) return read;
      if (!things.ok) return err({ kind: "storage" });
      const bySubject = thingsBySubject(things.value.things);
      const writes: { path: string; text: string }[] = [];
      let subject: SubjectId;
      let property: string;
      let revision = 1;
      let thingName = "a Thing";
      let corrected: ReadSize | undefined;
      if (edit.kind === "add") {
        const thing = things.value.things.find(({ summary }) => summary.slug === edit.thing);
        if (thing === undefined) return err({ kind: "no-thing", thing: edit.thing });
        property = edit.property;
        thingName = thing.summary.name;
        // Its subject ID comes with its first size and stays, a rename and all (ADR 0037).
        subject = thing.summary.subject ?? SubjectId.parse(randomUUID());
        if (thing.summary.subject === undefined) {
          const fields = readThingText(thing.text);
          if (!fields.ok) return err({ kind: "storage" });
          writes.push({
            path: thingPath(thing.summary.slug),
            text: thingText({ ...fields.value.fields, subject }, fields.value.history),
          });
        }
        const there = read.value.sizes.find(
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
        corrected = read.value.sizes.find(({ record }) => record.id === editing);
        if (corrected === undefined) {
          const problem = read.value.problems.find(({ path }) => path === sizePath(editing));
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
        recorded: new Date(options.now).toISOString(),
        revision,
      });
      if (!made.success) {
        return err({ kind: "invalid", problem: made.error.issues[0]?.message ?? "" });
      }
      const record = made.data;
      writes.push({ path: sizePath(record.id), text: recordText(record) });
      if (corrected !== undefined) {
        const { path } = corrected;
        writes.push({ path, text: recordText({ ...corrected.record, supersededBy: record.id }) });
      }
      for (const write of writes) {
        if (!(await writeTextFileIn(join(folder.value, write.path), write.text))) {
          return err({ kind: "storage" });
        }
        paths.push(write.path);
      }
      title = `${edit.kind === "add" ? "Record" : "Correct"} size: ${thingName}, ${record.property}`;
      return ok({
        save: {
          action: edit.kind,
          size: { id: record.id, thing: thingName, property: record.property },
          value: valueText(record.value),
          source: record.source.kind,
        },
        size: { record, path: sizePath(record.id) },
      });
    },
    () => planningChange(target, { kind: "size", title, paths }),
  );
  return saved.ok ? ok({ ...saved.value.value, change: saved.value.id }) : saved;
};

/**
 * Undoes a change to sizes (recorded or corrected), as a change of its own: each file it wrote,
 * the Thing given its subject ID too, goes back as it was, unless it's changed since.
 */
export const undoSizeChange = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder" | "sessionId">,
  id: ChangeId,
) => undoWholeFiles(target, { id, kinds: ["size"] });

/** The record a path in the workspace's folder names (`sizes/<id>.json`), if it names one. */
const idOfPath = (path: string) => {
  const [, name] = /^sizes\/([^/]+)\.json$/.exec(path) ?? [];
  const id = SizeRecordId.safeParse(name);
  return id.success ? id.data : undefined;
};

/** Whether a change's files are a size's. */
export const isSizeChange = (files: readonly Pick<WholeFile, "path">[]) =>
  files.some(({ path }) => idOfPath(pathInWorkspace(path)) !== undefined);

/**
 * What a change did to sizes, for Recent changes: the record it added, by its property, and
 * whether it was a correction (it changed the record it superseded too).
 */
export const sizeChangeOf = (files: readonly WholeFile[]) => {
  const records = files.filter(({ path }) => idOfPath(pathInWorkspace(path)) !== undefined);
  const added = records.find(({ before }) => before === null) ?? records[0];
  const text = added?.after ?? added?.before ?? null;
  const read = text === null ? undefined : readSizeText(text);
  const name = read?.ok ? `${read.value.property}: ${valueText(read.value.value)}` : "a size";
  const did = added?.after === null ? "removed" : records.length > 1 ? "changed" : "added";
  return { size: { did, name }, path: null } as const;
};
