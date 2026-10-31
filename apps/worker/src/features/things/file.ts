import { THING_DETAILS, ThingFields, type ThingHistoryEntry } from "@courtyard/contract";
import { err, ok, type Result } from "../../lib/result.ts";

// A Thing's file: front matter between `---` lines, one `key: value` each, then the history, one
// dated line each (`- 2026-10-09: chain swapped`).

/** Each front-matter key, in the order a file is written, and the field it holds. */
export const FILE_KEYS = [
  ["name", "name"],
  ["status", "status"],
  ["kind", "kind"],
  ["count", "count"],
  ...THING_DETAILS.map((name) => [name, name] as const),
  ["part of", "partOf"],
  ["place", "place"],
  ["photo", "photo"],
  ["subject", "subject"],
  ["tile", "tile"],
  ["upcoming", "upcoming"],
  ["upcoming price", "upcomingPrice"],
  ["upcoming shop", "upcomingShop"],
  ["upcoming link", "upcomingLink"],
  ["upcoming why", "upcomingWhy"],
] as const satisfies readonly (readonly [string, keyof ThingFields])[];

/**
 * Keys a file may still have that Courtyard no longer keeps: a part's pin, from Home's photo
 * view, and what a Thing needs next, which a project's steps hold now (#603). They're read past,
 * and go on the Thing's next save.
 */
const RETIRED_KEYS = new Set(["pin", "needs"]);

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
    if (RETIRED_KEYS.has(key.trim().toLowerCase())) continue;
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
          : issue?.path[0] === "kind"
            ? "Its kind isn't item, space or tool."
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

/**
 * A Thing's file, written from its fields and its history, oldest first. An item's kind and a
 * count of one go unsaid, as every file before them has it.
 */
export const thingText = (fields: ThingFields, history: readonly ThingHistoryEntry[]) => {
  const front = FILE_KEYS.flatMap(([key, field]) => {
    const value = fields[field];
    const unsaid =
      value === undefined ||
      (field === "kind" && value === "item") ||
      (field === "count" && value === 1);
    return unsaid ? [] : [`${key}: ${value}`];
  });
  const lines = history.map(({ date, text }) => `- ${date === null ? "" : `${date}: `}${text}`);
  return `---\n${front.join("\n")}\n---\n${lines.length === 0 ? "" : `\n${lines.join("\n")}\n`}`;
};
