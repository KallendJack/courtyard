import type { BuildParameters, BuildStockPick, BuildTemplate } from "@courtyard/contract";
import {
  type Build,
  type BuildSetting,
  deriveBench,
  derivePrinted,
  pickBenchStock,
} from "@courtyard/fabrication";
import { err, type Result } from "../../lib/result.ts";

// A Build's parameters: worked out by its template's engine, changed by a merge patch, and what a
// change did, in a few words for its note.

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
export const merged = (target: unknown, patch: unknown): unknown => {
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
