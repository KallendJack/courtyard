import {
  USAGE_READING_OLD_MS,
  USAGE_WARNS_AT,
  type UsageWarning,
  type UsageWindow,
  usageWindowWords,
} from "@courtyard/contract";
import { clockWords } from "../../lib/when.ts";
import { resetsShort } from "../sessions/composer/limits.ts";

/** A percentage as the meters say it: "82%". */
export const percent = (used: number) => `${Math.round(used)}%`;

/** A window's name on its meter: "5-hour", "This week". */
export const windowName = (window: UsageWindow) => (window === "weekly" ? "This week" : "5-hour");

/** How full a window is, as its colour says: violet with room, gold near it, red at it. */
export const standingOf = (used: number) =>
  used >= 100 ? "full" : used >= USAGE_WARNS_AT ? "near" : "room";

/** When a window resets, as a meter says it: "resets Thu 09:00"; `first` in a line, "Resets…". */
export const resetsWords = (resetAt: string | undefined, options: { first?: boolean } = {}) =>
  resetAt === undefined
    ? undefined
    : `${options.first === true ? "Resets" : "resets"} ${resetsShort(resetAt)}`;

/** A warning's few words: "Claude: 82% of this week". */
export const warningWords = (warning: UsageWarning) =>
  `${warning.label}: ${percent(warning.used)} of ${usageWindowWords(warning.window)}`;

/** Switch's words: "Switch to Codex", with its own window when that's nearly full too. */
export const switchWords = (switchTo: NonNullable<UsageWarning["switchTo"]>) =>
  switchTo.fullest === undefined
    ? `Switch to ${switchTo.label}`
    : `Switch to ${switchTo.label} · ${percent(switchTo.fullest.used)} of ${usageWindowWords(switchTo.fullest.window)}`;

/** "as of 10:42", for a reading over an hour old; nothing for a fresh one. */
export const readingAge = (readAt: string | undefined, now = Date.now()) =>
  readAt === undefined || now - Date.parse(readAt) <= USAGE_READING_OLD_MS
    ? undefined
    : `as of ${clockWords(readAt)}`;
