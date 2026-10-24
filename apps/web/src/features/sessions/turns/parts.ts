import type { HelperId } from "@courtyard/contract";
import type { AnswerPart, Helper, MarkedActivity } from "./events.ts";

// How a turn's answer grows as its events arrive: its text, activities and helpers, in order.

/** A helper started after a turn's parts so far: with the ones just before it, or after the rest. */
export const withHelper = (
  parts: readonly AnswerPart[],
  helper: HelperId,
): readonly AnswerPart[] => {
  const last = parts.at(-1);
  if (last?.kind !== "helpers") return [...parts, { kind: "helpers", helpers: [helper] }];
  return [...parts.slice(0, -1), { kind: "helpers", helpers: [...last.helpers, helper] }];
};

/** A turn's helpers with the one numbered `helper` changed, leaving the rest as they were. */
export const changeHelper = (
  helpers: readonly Helper[],
  helper: HelperId,
  change: (helper: Helper) => Helper,
) => helpers.map((each) => (each.id === helper ? change(each) : each));

/** Text after a turn's parts so far: added to the text it's writing, or a new piece. */
export const withText = (
  parts: readonly AnswerPart[],
  text: string,
  replayed: boolean,
): readonly AnswerPart[] => {
  const last = parts.at(-1);
  if (last?.kind === "text") {
    const whole = last.text + text;
    return [
      ...parts.slice(0, -1),
      { kind: "text", text: whole, replayed: replayed ? whole.length : last.replayed },
    ];
  }
  // A new piece starts at its first words, not at the break before them.
  const start = text.trimStart();
  if (start === "") return parts;
  return [...parts, { kind: "text", text: start, replayed: replayed ? start.length : 0 }];
};

/**
 * An activity after a turn's parts so far: with the ones just before it, or after the text. A
 * build's newer place in the queue takes the older one's line (#281).
 */
export const withActivity = (
  parts: readonly AnswerPart[],
  activity: MarkedActivity,
): readonly AnswerPart[] => {
  const last = parts.at(-1);
  if (last?.kind !== "activities") {
    return [...parts, { kind: "activities", activities: [activity] }];
  }
  const moved =
    activity.kind === "waiting-for-build" && last.activities.at(-1)?.kind === "waiting-for-build";
  const before = moved ? last.activities.slice(0, -1) : last.activities;
  return [...parts.slice(0, -1), { kind: "activities", activities: [...before, activity] }];
};
