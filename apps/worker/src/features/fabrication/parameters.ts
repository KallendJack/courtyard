import {
  type BuildParameters,
  type BuildStockPick,
  type BuildTemplate,
  SizeRecordId,
  type SizeSource,
  SourcedSize,
} from "@courtyard/contract";
import {
  type Build,
  type BuildSetting,
  deriveBench,
  derivePrinted,
  pickBenchStock,
} from "@courtyard/fabrication";
import { err, ok, type Result } from "../../lib/result.ts";
import type { ReadSize } from "./sizes.ts";

// A Build's parameters: worked out by its template's engine, its sizes that point at size records
// read from them (#711), changed by a merge patch, and what a change did, in a few words for its
// note.

/**
 * Each template's engine: its parameters in, with the owner's tools and the ways its steps were
 * done (#777), everything its Build shows out, or what's wrong.
 */
const ENGINES: Readonly<
  Record<BuildTemplate, (parameters: unknown, setting?: BuildSetting) => Result<Build, string[]>>
> = {
  "framed-bench": deriveBench,
  "battery-holster": derivePrinted("battery-holster"),
  "castor-shim": derivePrinted("castor-shim"),
  bracket: derivePrinted("bracket"),
  "printed-part": derivePrinted("printed-part"),
};

/** Everything a Build shows, worked out from its template and parameters (ADR 0036). */
export const derive = (
  template: BuildTemplate,
  parameters: BuildParameters,
  setting?: BuildSetting,
) => ENGINES[template](parameters, setting);

/** A printed part is made of filament, so it has no stock to swap. */
const noStock = err(["A printed part has no timber or sheets to pick from."]);

/** Each template's way to swap one of its stocks for an option, in every part cut from it. */
const PICKERS: Readonly<
  Record<
    BuildTemplate,
    (parameters: unknown, pick: BuildStockPick) => Result<BuildParameters, string[]>
  >
> = {
  "framed-bench": pickBenchStock,
  "battery-holster": () => noStock,
  "castor-shim": () => noStock,
  bracket: () => noStock,
  "printed-part": () => noStock,
};

/** A Build's parameters with one of its stocks swapped for an option (#704), or why not. */
export const pickStockIn = (template: BuildTemplate, parameters: unknown, pick: BuildStockPick) =>
  PICKERS[template](parameters, pick);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parameters with a JSON merge patch applied (RFC 7386): an object merges into the one there,
 * `null` takes a value out, and anything else (a number, a list) replaces what's there.
 */
const merged = (target: unknown, patch: unknown): unknown => {
  if (!isObject(patch)) return patch;
  const result: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = merged(result[key], value);
  }
  return result;
};

/** A size as a Build takes one (`{ value, unit, source }`), shown as "900 mm". */
const sizeWords = (value: unknown) =>
  isObject(value) && typeof value.value === "number" && typeof value.unit === "string"
    ? `${value.value} ${value.unit}`
    : undefined;

const said = (value: unknown) =>
  sizeWords(value) ??
  (isObject(value) && typeof value.name === "string"
    ? value.name
    : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "none");

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The most changes a note names; the rest are counted. */
const NOTE_CHANGES_MOST = 6;

/**
 * What a change to a Build's parameters did, one line each, by where in them: "height: 900 mm →
 * 850 mm", "castors: none", "tools: + circular-saw". A size, a named stock or a list counts once.
 */
export const parameterChanges = (before: unknown, after: unknown): string[] => {
  const lines: string[] = [];
  const walk = (was: unknown, now: unknown, path: string) => {
    if (sameJson(was, now)) return;
    const at = path === "" ? "parameters" : path;
    if (Array.isArray(was) && Array.isArray(now)) {
      const added = now.filter((item) => !was.some((one) => sameJson(one, item)));
      const removed = was.filter((item) => !now.some((one) => sameJson(one, item)));
      const words = [
        ...added.map((item) => `+ ${said(item)}`),
        ...removed.map((item) => `− ${said(item)}`),
      ];
      lines.push(`${at}: ${words.length === 0 ? "reordered" : words.join(", ")}`);
    } else if (isObject(was) && isObject(now) && sizeWords(was) === undefined) {
      if (typeof was.name === "string" && was.name !== now.name) {
        lines.push(`${at}: ${was.name} → ${said(now)}`);
        return;
      }
      for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
        walk(was[key], now[key], path === "" ? key : `${path}.${key}`);
      }
    } else if (sizeWords(was) !== undefined && sizeWords(was) === sizeWords(now)) {
      lines.push(`${at}: ${sizeWords(now)}, its source changed`);
    } else {
      lines.push(
        was === undefined
          ? `${at}: ${said(now)}`
          : now === undefined
            ? `${at}: none`
            : `${at}: ${said(was)} → ${said(now)}`,
      );
    }
  };
  walk(before, after, "");
  return lines.length <= NOTE_CHANGES_MOST
    ? lines
    : [
        ...lines.slice(0, NOTE_CHANGES_MOST - 1),
        `and ${lines.length - NOTE_CHANGES_MOST + 1} more`,
      ];
};

// A Build's sizes that point at size records (ADR 0037, #711): `{ "record": "<id>" }` in its
// parameters, in place of a value of its own, so a Build is worked out from the size the owner
// recorded, and from its correction once there is one. The value is read from the record each
// time the Build is; the file keeps the size last read beside the pointer, which the Build falls
// back to, as assumed, once the record's gone (its save undone, say), so it never stops reading.

/** A pointer as a model or the owner may give it: the record's ID, or its file, `sizes/<id>.json`. */
const pointerId = (value: unknown) => {
  if (!isObject(value) || typeof value.record !== "string") return undefined;
  return value.record
    .trim()
    .replace(/^sizes\//, "")
    .replace(/\.json$/, "");
};

/** The size last read from a pointer's record, kept beside it, when it has one. */
const lastRead = (pointer: Record<string, unknown>): SourcedSize | undefined => {
  const size = SourcedSize.safeParse(pointer);
  return size.success ? size.data : undefined;
};

/**
 * Parameters with every pointer as it's kept, `{ "record": "<id>" }`, and the size last read
 * beside it only where `before` (the Build as saved) pointed at the same record: a merge patch
 * that points a size somewhere new leaves none of its old value beside it.
 */
const pointed = (parameters: unknown, before?: unknown): unknown => {
  const id = pointerId(parameters);
  if (id !== undefined) {
    const kept =
      pointerId(before) === id && isObject(parameters) ? lastRead(parameters) : undefined;
    return { record: id, ...kept };
  }
  if (Array.isArray(parameters)) {
    return parameters.map((one, index) =>
      pointed(one, Array.isArray(before) ? before[index] : undefined),
    );
  }
  if (!isObject(parameters)) return parameters;
  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [
      key,
      pointed(value, isObject(before) ? before[key] : undefined),
    ]),
  );
};

/**
 * A Build's parameters as a save gives them: a new one's whole, or a change merged into those
 * saved (`before`), each pointer as it's kept.
 */
export const patchedWith = (before: unknown, patch: unknown) =>
  pointed(before === undefined ? patch : merged(before, patch ?? {}), before);

/** Millimetres in each length a record may be in. */
const MM: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000 };

/**
 * A record's source as a Build's size has it: measured and specified as they are; reported or
 * estimated are assumed, so the Build lists them to check before cutting.
 */
const sourceOf = ({ record }: ReadSize): SizeSource =>
  record.source.kind === "measured"
    ? { kind: "measured" }
    : record.source.kind === "specified"
      ? { kind: "specified", reference: record.source.reference }
      : { kind: "assumed" };

/** The record standing for one: itself, or the correction that superseded it, and its own. */
const standingFor = (sizes: readonly ReadSize[], id: string) => {
  let size = sizes.find(({ record }) => record.id === id);
  for (let hops = 0; size?.record.supersededBy !== undefined && hops < sizes.length; hops++) {
    const next = size.record.supersededBy;
    size = sizes.find(({ record }) => record.id === next);
  }
  return size;
};

/** A record's standing size in mm with its source, as the engine takes a size, or why not. */
const recordSize = (sizes: readonly ReadSize[], id: string): Result<SourcedSize, string> => {
  const known = SizeRecordId.safeParse(id).success ? standingFor(sizes, id) : undefined;
  if (known === undefined) return err(`there's no size record ${id}.`);
  const { value: recorded, property } = known.record;
  const mm = recorded.kind === "quantity" ? MM[recorded.unit] : undefined;
  if (recorded.kind !== "quantity" || mm === undefined) return err(`${property} isn't a length.`);
  return ok({
    value: Math.round(recorded.value * mm * 1000) / 1000,
    unit: "mm",
    source: sourceOf(known),
  });
};

/**
 * Parameters with their pointers read: `resolved` with each swapped for its record's size, as the
 * engine takes it; `kept` with each pointer and that size beside it, as the file keeps it; and
 * `gone`, where in them a pointer's record is gone, so its size is the one last read, as assumed.
 */
type ReadParameters = {
  readonly resolved: unknown;
  readonly kept: unknown;
  readonly gone: readonly string[];
};

/**
 * Parameters with every pointer read from its record; one whose record is gone, or isn't a
 * length, from the size last read beside it, as assumed; or each pointer that can't be either (a
 * new one to a record that isn't there), by where in the parameters it is.
 */
const recordSizes = (
  parameters: unknown,
  sizes: readonly ReadSize[],
): Result<ReadParameters, string[]> => {
  const problems: string[] = [];
  const gone: string[] = [];
  const walk = (value: unknown, path: string): readonly [unknown, unknown] => {
    const id = pointerId(value);
    if (id !== undefined && isObject(value)) {
      const read = recordSize(sizes, id);
      const last = lastRead(value);
      if (read.ok) return [read.value, { record: id, ...read.value }];
      if (last === undefined) {
        problems.push(`${path}: ${read.error}`);
        return [value, value];
      }
      gone.push(path);
      const assumed = { ...last, source: { kind: "assumed" } } satisfies SourcedSize;
      return [assumed, { record: id, ...assumed }];
    }
    if (Array.isArray(value)) {
      const both = value.map((one, index) => walk(one, `${path}.${index}`));
      return [both.map(([resolved]) => resolved), both.map(([, kept]) => kept)];
    }
    if (!isObject(value)) return [value, value];
    const both = Object.entries(value).map(
      ([key, one]) => [key, walk(one, path === "" ? key : `${path}.${key}`)] as const,
    );
    return [
      Object.fromEntries(both.map(([key, [resolved]]) => [key, resolved])),
      Object.fromEntries(both.map(([key, [, kept]]) => [key, kept])),
    ];
  };
  const [resolved, kept] = walk(parameters, "");
  return problems.length === 0 ? ok({ resolved, kept, gone }) : err(problems);
};

/**
 * Parameters changed from their sizes as read (a stock picked, say), with each pointer the
 * original had put back wherever the change left its value as the record gave it.
 */
const keepPointers = (original: unknown, read: unknown, changed: unknown): unknown => {
  if (pointerId(original) !== undefined) return sameJson(read, changed) ? original : changed;
  if (Array.isArray(original) && Array.isArray(read) && Array.isArray(changed)) {
    return changed.map((one, index) => keepPointers(original[index], read[index], one));
  }
  if (isObject(original) && isObject(read) && isObject(changed)) {
    return Object.fromEntries(
      Object.entries(changed).map(([key, one]) => [
        key,
        keepPointers(original[key], read[key], one),
      ]),
    );
  }
  return changed;
};

/**
 * A Build worked out from its parameters, its sizes that point at records read from them: what
 * the engine works out, its parameters as the file keeps them (each pointer with the size just
 * read beside it), and where a pointer's record is gone; or each problem, where in its parameters.
 */
export const workedOut = (
  template: BuildTemplate,
  parameters: BuildParameters,
  setting: BuildSetting | undefined,
  sizes: readonly ReadSize[],
): Result<
  { readonly build: Build; readonly kept: BuildParameters; readonly gone: readonly string[] },
  string[]
> => {
  const read = recordSizes(parameters, sizes);
  if (!read.ok) return read;
  const build = derive(template, read.value.resolved as BuildParameters, setting);
  if (!build.ok) return build;
  const { kept, gone } = read.value;
  return ok({ build: build.value, kept: kept as BuildParameters, gone });
};

/**
 * Parameters with one of their stocks swapped for an option (#704), picked from the sizes as read,
 * and the sizes the pick leaves as they were still pointing at their records; or why not: a
 * pointer that can't be read, or a pick that can't be made.
 */
export const pickKeeping = (
  template: BuildTemplate,
  parameters: unknown,
  pick: BuildStockPick,
  sizes: readonly ReadSize[],
): Result<unknown, { readonly kind: "parameters" | "invalid"; readonly problems: string[] }> => {
  const read = recordSizes(parameters, sizes);
  if (!read.ok) return err({ kind: "parameters", problems: read.error });
  const { resolved } = read.value;
  const picked = pickStockIn(template, resolved, pick);
  return picked.ok
    ? ok(keepPointers(parameters, resolved, picked.value))
    : err({ kind: "invalid", problems: picked.error });
};
