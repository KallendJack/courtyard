import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChangeId,
  THING_DETAILS,
  THING_HISTORY_MAX_CHARACTERS,
  type ThingChange,
  type ThingDetailName,
  ThingFields,
  type ThingHistoryEntry,
  type ThingProblem,
  type ThingSave,
  ThingSlug,
  ThingStatus,
  type ThingSummary,
} from "@courtyard/contract";
import sharp from "sharp";
import { z } from "zod";
import {
  sameFileText,
  undoWholeFiles,
  type WholeFile,
  type WholeFilesUndoRefusal,
} from "../context-folder/index.ts";
import {
  exists,
  listFolder,
  readBytes,
  readTextFile,
  removeFile,
  writeBytesIn,
  writeTextFileIn,
} from "../files.ts";
import {
  type PlanningFilesTarget,
  type PlanningFolderRefusal,
  pathInWorkspace,
  planningChange,
  planningFolder,
  slugFor,
} from "../planning-files/index.ts";
import { err, ok, type Result } from "../result.ts";

/**
 * A workspace's Things (ADR 0020): the owner's kit, a Markdown file each in its `things` folder,
 * fixed fields in front matter and a dated history as the body, with a photo beside it in
 * `things/photos`. Every write is one change through the context folder, so Recent changes lists
 * it with Undo. Planning workspaces only.
 */

/** The folder in a workspace's folder that holds its Things, and their photos inside it. */
export const THINGS_FOLDER = "things";
const PHOTOS_FOLDER = "photos";

/** A Thing's path in its workspace's folder. */
export const thingPath = (slug: ThingSlug) => `${THINGS_FOLDER}/${slug}.md`;

/** A Thing's photo, as its front matter names it: beside it, in the photos folder. */
const photoName = (slug: ThingSlug) => `${PHOTOS_FOLDER}/${slug}.jpg`;

/** Why a Thing wasn't saved, removed or read. */
export type ThingRefusal =
  | PlanningFolderRefusal
  /** A field doesn't fit: too long, more than one line, a date that isn't one, and so on. */
  | { readonly kind: "invalid"; readonly problem: string }
  /** A new Thing needs a name and a status. */
  | { readonly kind: "incomplete" }
  /** Another Thing already has its file name. */
  | { readonly kind: "clash"; readonly name: string; readonly slug: ThingSlug }
  | { readonly kind: "not-found"; readonly slug: ThingSlug }
  /** Its file isn't a Thing as written (a hand edit, say), so it can't be changed here. */
  | { readonly kind: "unreadable"; readonly path: string; readonly problem: string }
  /** The Thing it's to be part of isn't there. */
  | { readonly kind: "no-such-parent" }
  /**
   * Part of a part, or a Thing with parts made part of another: a Thing is part of at most one
   * other, which isn't a part itself.
   */
  | { readonly kind: "nested" }
  /** A Thing with parts can't be removed until they're removed or moved. */
  | { readonly kind: "has-parts"; readonly parts: readonly string[] }
  /** It would change nothing. */
  | { readonly kind: "unchanged"; readonly name: string }
  /** It has changed since the model was shown it. */
  | { readonly kind: "stale" }
  /** A photo that can't be read as one. */
  | { readonly kind: "bad-photo" }
  | { readonly kind: "storage" };

/** A Thing's file, or its photo, on the worker machine. */
const fileOf = (folder: string, slug: ThingSlug) => join(folder, THINGS_FOLDER, `${slug}.md`);
const photoOf = (folder: string, slug: ThingSlug) => join(folder, THINGS_FOLDER, photoName(slug));

// The file: front matter between `---` lines, one `key: value` each, then the history, one dated
// line each (`- 2026-10-09: chain swapped`).

/** Each front-matter key, in the order a file is written, and the field it holds. */
const FILE_KEYS = [
  ["name", "name"],
  ["status", "status"],
  ...THING_DETAILS.map((name) => [name, name] as const),
  ["part of", "partOf"],
  ["photo", "photo"],
] as const satisfies readonly (readonly [string, keyof ThingFields])[];

const HISTORY_LINE = /^(?:[-*][ \t]+)?(?:(\d{4}-\d{2}-\d{2}):[ \t]*)?(.*)$/;

/** A Thing's file read: its fields and its history, oldest first, or what's wrong with it. */
export const readThingText = (
  text: string,
): Result<{ fields: ThingFields; history: ThingHistoryEntry[] }, string> => {
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    return err("It doesn't start with its fields between --- lines.");
  }
  const raw: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const [, key = "", value = ""] = /^([^:]+):(.*)$/.exec(line) ?? [];
    const field = FILE_KEYS.find(([name]) => name === key.trim().toLowerCase())?.[1];
    if (field === undefined) return err(`It has a line Courtyard doesn't know: "${line.trim()}".`);
    const unquoted = value.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (unquoted !== "") raw[field] = unquoted;
  }
  const fields = ThingFields.safeParse(raw);
  if (!fields.success) {
    const [issue] = fields.error.issues;
    const name = FILE_KEYS.find(([, field]) => field === issue?.path[0])?.[0] ?? "a field";
    return err(
      issue?.code === "invalid_type" && raw[String(issue.path[0])] === undefined
        ? `It has no ${name}.`
        : issue?.path[0] === "status"
          ? "Its status isn't have, want or replace."
          : `Its ${name} doesn't fit: ${issue?.message ?? "it can't be read"}`,
    );
  }
  const history = lines.slice(end + 1).flatMap((line) => {
    if (line.trim() === "") return [];
    const [, date, said = ""] = HISTORY_LINE.exec(line.trim()) ?? [];
    return [{ date: date ?? null, text: said.trim() }];
  });
  return ok({ fields: fields.data, history });
};

/** A Thing's file, written from its fields and its history, oldest first. */
const thingText = (fields: ThingFields, history: readonly ThingHistoryEntry[]) => {
  const front = FILE_KEYS.flatMap(([key, field]) => {
    const value = fields[field];
    return value === undefined ? [] : [`${key}: ${value}`];
  });
  const lines = history.map(({ date, text }) => `- ${date === null ? "" : `${date}: `}${text}`);
  return `---\n${front.join("\n")}\n---\n${lines.length === 0 ? "" : `\n${lines.join("\n")}\n`}`;
};

/** A Thing as read from its file: what lists show, its history and its file's text. */
export type ReadThing = {
  readonly summary: ThingSummary;
  readonly history: readonly ThingHistoryEntry[];
  readonly text: string;
};

/** A workspace's Things as read, in list order, and the files that aren't Things as written. */
export type ReadThings = {
  readonly things: readonly ReadThing[];
  readonly problems: readonly ThingProblem[];
};

/** Things in list order: each top-level Thing by name, its parts straight after it by name. */
const inListOrder = (things: readonly ReadThing[]) => {
  const byName = (a: ReadThing, b: ReadThing) =>
    a.summary.name.localeCompare(b.summary.name, "en-GB", { sensitivity: "base" }) ||
    a.summary.slug.localeCompare(b.summary.slug);
  const slugs = new Set(things.map(({ summary }) => summary.slug));
  const isTop = ({ summary }: ReadThing) =>
    summary.partOf === undefined || !slugs.has(summary.partOf);
  return things
    .filter(isTop)
    .sort(byName)
    .flatMap((top) => [
      top,
      ...things
        .filter((part) => !isTop(part) && part.summary.partOf === top.summary.slug)
        .sort(byName),
    ]);
};

/** Every Thing in a workspace's folder, in list order, with the files that aren't Things. */
const readThingsIn = async (folder: string): Promise<Result<ReadThings, ThingRefusal>> => {
  const names = await listFolder(join(folder, THINGS_FOLDER));
  if (!names.ok) return err({ kind: "storage" });
  const things: ReadThing[] = [];
  const problems: ThingProblem[] = [];
  for (const name of names.value.sort()) {
    const slug = ThingSlug.safeParse(name.replace(/\.md$/, ""));
    if (!name.endsWith(".md")) continue;
    const path = `${THINGS_FOLDER}/${name}`;
    if (!slug.success) {
      problems.push({ path, problem: "Its file name isn't lowercase letters, digits and dashes." });
      continue;
    }
    const text = await readTextFile(fileOf(folder, slug.data));
    if (!text.ok) return err({ kind: "storage" });
    if (text.value === undefined) continue;
    const read = readThingText(text.value);
    if (!read.ok) {
      problems.push({ path, problem: read.error });
      continue;
    }
    let updatedAt: string;
    try {
      updatedAt = (await stat(fileOf(folder, slug.data))).mtime.toISOString();
    } catch {
      return err({ kind: "storage" });
    }
    const { photo, ...fields } = read.value.fields;
    things.push({
      summary: {
        ...fields,
        slug: slug.data,
        path: thingPath(slug.data),
        photo: photo !== undefined,
        updatedAt,
      },
      history: read.value.history,
      text: text.value,
    });
  }
  return ok({ things: inListOrder(things), problems });
};

/** A planning workspace's Things, in list order, and the files that aren't Things as written. */
export const readThings = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
): Promise<Result<ReadThings, ThingRefusal>> => {
  const folder = await planningFolder(target);
  return folder.ok ? readThingsIn(folder.value) : folder;
};

/** One Thing for its card, its history newest first. */
export const getThing = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
  slug: ThingSlug,
): Promise<Result<ReadThing, ThingRefusal>> => {
  const read = await readThings(target);
  if (!read.ok) return read;
  const found = read.value.things.find(({ summary }) => summary.slug === slug);
  return found === undefined ? err({ kind: "not-found", slug }) : ok(found);
};

/** A Thing's photo, as kept: `undefined` when it has none. */
export const thingPhoto = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
  slug: ThingSlug,
): Promise<Result<string | undefined, ThingRefusal>> => {
  const folder = await planningFolder(target);
  if (!folder.ok) return folder;
  const there = await exists(photoOf(folder.value, slug));
  if (!there.ok) return err({ kind: "storage" });
  return ok(there.value ? photoOf(folder.value, slug) : undefined);
};

/** The longest side of a Thing's kept photo, and the most bytes it takes (ADR 0020). */
const PHOTO = {
  longSides: [1600, 1200, 800],
  maxBytes: 300 * 1024,
  qualities: [80, 70, 60, 50],
} as const;

/**
 * A photo as a Thing keeps it: turned the right way up, its details (GPS included) left out,
 * fitted inside 1600 px and saved as a JPEG of at most 300 KB, at a lower quality, or failing that
 * smaller, when it needs to be. `undefined` when the bytes aren't a photo that can be read.
 */
export const keptPhoto = async (bytes: Uint8Array): Promise<Uint8Array | undefined> => {
  try {
    const upright = await sharp(bytes).rotate().toBuffer();
    let smallest: Uint8Array | undefined;
    for (const side of PHOTO.longSides) {
      const fitted = await sharp(upright)
        .resize(side, side, { fit: "inside", withoutEnlargement: true })
        .toBuffer();
      for (const quality of PHOTO.qualities) {
        smallest = await sharp(fitted).jpeg({ quality, mozjpeg: true }).toBuffer();
        if (smallest.length <= PHOTO.maxBytes) return smallest;
      }
    }
    return smallest;
  } catch {
    return undefined;
  }
};

/** A field a save sets, or clears with `null`. */
type FieldChange = {
  readonly name?: string;
  readonly status?: ThingStatus;
  readonly partOf?: ThingSlug | null;
} & { readonly [K in ThingDetailName]?: string | null };

/** A change to one Thing: a new one, or one that's there, by its file's name. */
export type ThingEdit = {
  /** The Thing changed or removed; left out to add one. */
  readonly slug?: ThingSlug;
  readonly remove?: boolean;
  readonly fields?: FieldChange;
  /** A line for its history, dated today. */
  readonly history?: string;
  /** A photo as `keptPhoto` keeps it. */
  readonly photo?: Uint8Array;
};

/** A saved Thing, the change it was committed as (if git kept it), and its file's text now. */
export type ThingSaved = {
  readonly save: ThingSave;
  readonly change: ChangeId | undefined;
  /** Its file's text as the save left it, `null` once removed. */
  readonly text: string | null;
};

/** Today as a Thing's history dates it: `2026-10-09`, on the worker machine's clock. */
export const historyDate = (now: number) => new Date(now).toLocaleDateString("en-CA");

/** The fields a save set, as its note shows them: each changed one, `null` for one cleared. */
const fieldsChanged = (
  before: ThingFields | undefined,
  after: ThingFields,
  nameOf: (slug: ThingSlug) => string,
): NonNullable<ThingSave["fields"]> => {
  const changed: Record<string, string | null> = {};
  for (const [, field] of FILE_KEYS) {
    if (field === "photo") continue;
    const was = before?.[field];
    const now = after[field];
    if (was === now) continue;
    const shown = field === "partOf" && after.partOf !== undefined ? nameOf(after.partOf) : now;
    changed[field] = shown ?? null;
  }
  return changed;
};

/**
 * Adds, changes or removes one Thing, as one change: its file, and its photo with it. `check` is
 * given the Thing's file as it is now, and refuses the change by returning a refusal (one the model
 * hasn't seen as it is, say).
 */
export const saveThing = async (
  target: PlanningFilesTarget,
  edit: ThingEdit,
  options: { now: number; check?: (now: ReadThing) => ThingRefusal | undefined },
): Promise<Result<ThingSaved, ThingRefusal>> => {
  let title = "";
  const paths: string[] = [];
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<{ save: ThingSave; text: string | null }, ThingRefusal>> => {
      const folder = await planningFolder(target);
      if (!folder.ok) return folder;
      const read = await readThingsIn(folder.value);
      if (!read.ok) return read;
      const { things, problems } = read.value;
      const named = (slug: ThingSlug) =>
        things.find(({ summary }) => summary.slug === slug)?.summary.name ?? slug;

      const editing = edit.slug;
      const current =
        editing === undefined ? undefined : things.find(({ summary }) => summary.slug === editing);
      if (editing !== undefined && current === undefined) {
        const problem = problems.find(({ path }) => path === thingPath(editing));
        return problem === undefined
          ? err({ kind: "not-found", slug: editing })
          : err({ kind: "unreadable", ...problem });
      }
      if (current !== undefined) {
        const refused = options.check?.(current);
        if (refused !== undefined) return err(refused);
      }
      const parts = (slug: ThingSlug) =>
        things.filter(({ summary }) => summary.partOf === slug).map(({ summary }) => summary.name);

      if (edit.remove) {
        if (current === undefined) return err({ kind: "incomplete" });
        const { slug, name } = current.summary;
        if (parts(slug).length > 0) return err({ kind: "has-parts", parts: parts(slug) });
        if (!(await removeFile(fileOf(folder.value, slug)))) return err({ kind: "storage" });
        paths.push(thingPath(slug));
        if (current.summary.photo) {
          if (!(await removeFile(photoOf(folder.value, slug)))) return err({ kind: "storage" });
          paths.push(`${THINGS_FOLDER}/${photoName(slug)}`);
        }
        title = `Remove Thing: ${name}`;
        return ok({ save: { action: "remove", thing: { slug, name } }, text: null });
      }

      const was = current === undefined ? undefined : readThingText(current.text);
      if (was !== undefined && !was.ok) return err({ kind: "storage" });
      const before = was?.value.fields;
      const merged: Record<string, string | undefined> = { ...before };
      for (const [field, value] of Object.entries(edit.fields ?? {})) {
        merged[field] = value === null ? undefined : value;
      }
      if (merged.name === undefined || merged.status === undefined) {
        return err({ kind: "incomplete" });
      }
      const slug =
        current?.summary.slug ?? slugFor(merged.name, { slug: ThingSlug, kind: "thing" });
      if (slug === undefined) {
        return err({ kind: "invalid", problem: "Its name needs a letter or a digit." });
      }
      if (current === undefined) {
        const there = things.find(({ summary }) => summary.slug === slug);
        const unreadable = problems.some(({ path }) => path === thingPath(slug));
        if (there !== undefined || unreadable) {
          return err({ kind: "clash", name: there?.summary.name ?? merged.name, slug });
        }
      }
      if (merged.partOf !== undefined) {
        const parent = things.find(({ summary }) => summary.slug === merged.partOf);
        if (parent === undefined) return err({ kind: "no-such-parent" });
        if (parent.summary.slug === slug || parent.summary.partOf !== undefined) {
          return err({ kind: "nested" });
        }
        if (parts(slug).length > 0) return err({ kind: "nested" });
      }
      if (edit.photo !== undefined) merged.photo = photoName(slug);
      const fields = ThingFields.safeParse(merged);
      if (!fields.success) {
        return err({ kind: "invalid", problem: fields.error.issues[0]?.message ?? "" });
      }
      const history = [...(was?.value.history ?? [])];
      const line = edit.history?.replace(/\s+/g, " ").trim();
      if (edit.history !== undefined) {
        if (line === undefined || line === "") {
          return err({ kind: "invalid", problem: "Give the history line some text." });
        }
        if (line.length > THING_HISTORY_MAX_CHARACTERS) {
          return err({
            kind: "invalid",
            problem: `Keep a history line to ${THING_HISTORY_MAX_CHARACTERS} characters.`,
          });
        }
        history.push({ date: historyDate(options.now), text: line });
      }
      const text = thingText(fields.data, history);
      if (current !== undefined && text === current.text.replace(/\r\n/g, "\n") && !edit.photo) {
        return err({ kind: "unchanged", name: fields.data.name });
      }
      if (edit.photo !== undefined) {
        if (!(await writeBytesIn(photoOf(folder.value, slug), edit.photo))) {
          return err({ kind: "storage" });
        }
        paths.push(`${THINGS_FOLDER}/${photoName(slug)}`);
      }
      if (!(await writeTextFileIn(fileOf(folder.value, slug), text))) {
        return err({ kind: "storage" });
      }
      paths.unshift(thingPath(slug));
      const name = fields.data.name;
      title = `${current === undefined ? "Add" : "Change"} Thing: ${name}`;
      const changed = fieldsChanged(before, fields.data, named);
      return ok({
        save: {
          action: current === undefined ? "add" : "change",
          thing: { slug, name },
          ...(Object.keys(changed).length === 0 ? {} : { fields: changed }),
          ...(line === undefined ? {} : { history: line }),
          ...(edit.photo === undefined ? {} : { photo: true as const }),
        },
        text,
      });
    },
    () => planningChange(target, { kind: "thing", title, paths }),
  );
  return saved.ok
    ? ok({ save: saved.value.value.save, text: saved.value.value.text, change: saved.value.id })
    : saved;
};

/** Why a change to Things wasn't undone. */
export type ThingUndoRefusal = WholeFilesUndoRefusal;

/**
 * Undoes a change to Things (added, changed or removed), as a change of its own: each file, the
 * photo included, goes back as it was, unless it's changed since.
 */
export const undoThingChange = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder" | "sessionId">,
  id: ChangeId,
) => undoWholeFiles(target, { id, kinds: ["thing"] });

/** The Thing a path in the workspace's folder names (`things/<slug>.md`), if it names one. */
const slugOfPath = (path: string): ThingSlug | undefined => {
  const [, name] = /^things\/([^/]+)\.md$/.exec(path) ?? [];
  const slug = ThingSlug.safeParse(name);
  return slug.success ? slug.data : undefined;
};

/**
 * What a change did to a Thing, from the whole files it wrote or removed (see `ChangeNote.files`),
 * for Recent changes: and the path of the Thing's file it left, if any.
 */
export const thingChangeOf = (
  files: readonly WholeFile[],
): { thing: ThingChange; path: string | null } => {
  const file = files.find((one) => slugOfPath(pathInWorkspace(one.path)));
  const slug = file && (slugOfPath(pathInWorkspace(file.path)) ?? null);
  const nameIn = (text: string | null) => {
    const read = text === null ? undefined : readThingText(text);
    return read?.ok ? read.value.fields.name : undefined;
  };
  const name = nameIn(file?.after ?? null) ?? nameIn(file?.before ?? null) ?? slug ?? "a Thing";
  const did = file?.before === null ? "added" : file?.after === null ? "removed" : "changed";
  return {
    thing: { did, name, slug: did === "removed" ? null : (slug ?? null) },
    path: did === "removed" || file === undefined ? null : file.path,
  };
};

/** Whether a change's files are a Thing's (rather than a document's). */
export const isThingChange = (files: readonly Pick<WholeFile, "path">[]) =>
  files.some(({ path }) => pathInWorkspace(path).startsWith(`${THINGS_FOLDER}/`));

/** A Thing with the label a model knows it by (`T1`), in list order. */
export type LabelledThing = { readonly label: string; readonly thing: ThingSummary };

/** Labels for a workspace's Things, `T1` first, in list order. */
export const labelledThings = (things: readonly ReadThing[]): LabelledThing[] =>
  things.map(({ summary }, index) => ({ label: `T${index + 1}`, thing: summary }));

/** A label as a model might write it: `T2`, `[T2]` or `t2`. */
const asLabel = (raw: string) =>
  raw
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .toUpperCase();

/** What a model sends the Things tool, checked like anything else a model sends. */
const ThingRequest = z
  .object({
    thing: z.string().optional(),
    remove: z.boolean().optional(),
    name: z.string().optional(),
    status: ThingStatus.optional(),
    brand: z.string().optional(),
    bought: z.string().optional(),
    price: z.string().optional(),
    condition: z.string().optional(),
    size: z.string().optional(),
    where: z.string().optional(),
    part_of: z.string().optional(),
    history: z.string().optional(),
    photo: z.number().int().optional(),
  })
  .strict();

/** Why the Things tool didn't save: the input doesn't fit, a label or photo is wrong, or it was refused. */
export type ThingToolRefusal =
  | Exclude<ThingRefusal, { kind: "stale" }>
  | { readonly kind: "malformed" }
  /** No Thing has that label (or it's been removed since). */
  | { readonly kind: "unknown-label"; readonly label: string }
  /** The Thing changed since the model was shown it: the Things now, labelled afresh. */
  | {
      readonly kind: "stale";
      readonly label: string;
      readonly things: readonly LabelledThing[];
    }
  /** No photo with this message has that number. */
  | { readonly kind: "unknown-photo"; readonly number: number }
  /** The owner stopped the turn, so nothing more is saved. */
  | { readonly kind: "stopped" };

/** A Thing the tool saved, and the label it has now (none once removed). */
export type ThingToolSaved = ThingSaved & { readonly label: string | undefined };

/**
 * One turn's Things tool (docs/ai-conduct.md, Things): adds, changes or removes a Thing by the
 * label the model was shown, sets its fields, adds a line to its history, or sets its photo from
 * one of the turn's photos by its number. It keeps each Thing's file as the model was shown it, or
 * last saved it, so a change to one that's changed since is refused, with the Things as they are
 * now, labelled afresh.
 */
export const createTurnThings = (
  target: PlanningFilesTarget & {
    /** The Things as the turn's instructions listed them. */
    readonly shown: readonly ReadThing[];
    /** The photos that come with the turn's message, Image 1 first, by their files. */
    readonly photos: readonly { readonly path: string }[];
    readonly now: number;
  },
) => {
  let labels = new Map<string, ThingSlug>();
  const seen = new Map<ThingSlug, string>();
  const show = (things: readonly ReadThing[]) => {
    labels = new Map(labelledThings(things).map(({ label, thing }) => [label, thing.slug]));
    for (const { summary, text } of things) seen.set(summary.slug, text);
  };
  show(target.shown);
  const labelOf = (slug: ThingSlug) => [...labels].find(([, of]) => of === slug)?.[0];

  return async (raw: unknown): Promise<Result<ThingToolSaved, ThingToolRefusal>> => {
    const request = ThingRequest.safeParse(raw);
    if (!request.success) return err({ kind: "malformed" });
    const { thing, remove, part_of, history, photo, ...set } = request.data;
    const label = thing === undefined || thing.trim() === "" ? undefined : asLabel(thing);
    const slug = label === undefined ? undefined : labels.get(label);
    if (label !== undefined && slug === undefined) return err({ kind: "unknown-label", label });
    if (label === undefined && remove) return err({ kind: "malformed" });

    const fields: { -readonly [K in keyof FieldChange]: FieldChange[K] } = {};
    for (const [field, value] of Object.entries(set)) {
      if (value === undefined) continue;
      const cleared = typeof value === "string" && value.trim() === "";
      if (field === "name" || field === "status") {
        if (cleared) return err({ kind: "incomplete" });
      }
      Object.assign(fields, { [field]: cleared ? null : value });
    }
    if (part_of !== undefined) {
      const parentLabel = asLabel(part_of);
      const parent = parentLabel === "" ? null : labels.get(parentLabel);
      if (parent === undefined) return err({ kind: "unknown-label", label: parentLabel });
      fields.partOf = parent;
    }
    let kept: Uint8Array | undefined;
    if (photo !== undefined) {
      const file = target.photos[photo - 1];
      if (file === undefined) return err({ kind: "unknown-photo", number: photo });
      const bytes = await readBytes(file.path);
      if (!bytes.ok || bytes.value === undefined)
        return err({ kind: "unknown-photo", number: photo });
      kept = await keptPhoto(bytes.value);
      if (kept === undefined) return err({ kind: "bad-photo" });
    }

    const saved = await saveThing(
      target,
      {
        ...(slug === undefined ? {} : { slug }),
        ...(remove ? { remove: true } : {}),
        fields,
        ...(history === undefined ? {} : { history }),
        ...(kept === undefined ? {} : { photo: kept }),
      },
      {
        now: target.now,
        check: (now) =>
          sameFileText(now.text, seen.get(now.summary.slug) ?? null)
            ? undefined
            : { kind: "stale" },
      },
    );
    if (!saved.ok) {
      if (saved.error.kind !== "stale" || label === undefined) {
        return saved.error.kind === "stale" ? err({ kind: "storage" }) : err(saved.error);
      }
      const now = await readThings(target);
      if (!now.ok) return err({ kind: "storage" });
      show(now.value.things);
      return err({ kind: "stale", label, things: labelledThings(now.value.things) });
    }
    const { slug: savedSlug } = saved.value.save.thing;
    if (saved.value.text === null) {
      seen.delete(savedSlug);
      return ok({ ...saved.value, label: undefined });
    }
    seen.set(savedSlug, saved.value.text);
    if (labelOf(savedSlug) === undefined) labels.set(`T${labels.size + 1}`, savedSlug);
    return ok({ ...saved.value, label: labelOf(savedSlug) });
  };
};
