import type {
  ApprovalAsk,
  BuilderStatus,
  CodeSessionList,
  LeadHolding,
  LeadStatus,
  NextUpIssue,
} from "@courtyard/contract";
import { clockWords } from "../../lib/when.ts";

// The Builders board's words (#592, GLOSSARY.md: the eight statuses), the same on the board, in
// Needs you and on Home's tiles. No React, no styles, so Home's tiles can read them.

type Listed = CodeSessionList["sessions"][number];

/** Each status by its name (GLOSSARY.md): only these eight. */
export const STATUS_NAMES: Readonly<Record<BuilderStatus["kind"], string>> = {
  building: "Building",
  checking: "Checking",
  "waiting-on-you": "Waiting on you",
  "waiting-for-limit": "Waiting for the limit",
  "in-ci": "In CI",
  "ready-for-review": "Ready for review",
  merged: "Merged",
  stuck: "Stuck",
};

/** How long a status has lasted, in a few words: "just now", "6 min", "1 h", "2 days". */
export const lastedWords = (since: string, now = Date.now()) => {
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
};

/** A builder's name, as the owner reads it: its issue's title, without "Build #N: ". */
export const builderName = (title: string) => title.replace(/^Build #\d+: /, "");

/** "1st", "2nd", "3rd", "4th"… */
const ordinal = (place: number) => {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[place % 10] ?? "th"}`;
};

/**
 * A check by what it checks, as short as it reads: the last file it names ("history.test.ts"), or
 * else its command.
 */
const checkWords = (command: string) => {
  const file = command
    .split(/\s+/)
    .filter((word) => /\.[a-z]{2,4}$/.test(word))
    .at(-1);
  return file?.split("/").at(-1) ?? command;
};

/** What an approval asks to do, in a few words after the builder's name: "wants to run …". */
export const wantsWords = (ask: ApprovalAsk) => {
  switch (ask.kind) {
    case "command":
      return `wants to run ${ask.command}`;
    case "tool":
      return `wants to ${ask.action} in ${ask.connection}`;
    default:
      return `wants to change ${ask.path}`;
  }
};

/**
 * What a builder is doing now, in one line under its status (#540): what its model does, the
 * check it waits on and its place in line, what it asks, when it carries on, why it's stuck.
 */
export const nowWords = (
  status: BuilderStatus,
  session: Listed | undefined,
  /** What its model is doing, as the Working line says it, while a turn of its runs. */
  doing: string | undefined,
) => {
  switch (status.kind) {
    case "building":
      return doing ?? "between turns";
    case "checking":
      return status.ahead === undefined
        ? `running ${checkWords(status.command)}`
        : `${checkWords(status.command)} · ${ordinal(status.ahead + 1)} in line`;
    case "waiting-on-you":
      return session?.now.kind === "needs-you" ? wantsWords(session.now.ask) : "asks you something";
    case "waiting-for-limit":
      return status.resetAt === undefined
        ? "carries on once the limit resets"
        : `carries on at ${clockWords(status.resetAt)}`;
    case "in-ci":
      return `#${status.pullRequest} · checks running`;
    case "ready-for-review":
      return `#${status.pullRequest} · checks passed`;
    case "merged":
      return `#${status.pullRequest} merged`;
    case "stuck":
      return status.reason;
  }
};

/** A reason the Lead starts no more, in a few words. */
const holdingWords = (holding: LeadHolding) => {
  switch (holding.kind) {
    case "reviews":
      return `${holding.waiting} pull requests wait for your review`;
    case "limit":
      return `the usage limit, until ${clockWords(holding.until)}`;
    case "main-red":
      return "main is red, only its fix starts";
    case "own-sessions":
      return "your own sessions are using the machine";
  }
};

/** "Pin to Home waits for Journey book to merge" (#592; Held back goes). */
export const waitsWords = (title: string, behind: string) =>
  `${title} waits for ${behind} to merge`;

/** The builder building an issue, by name; its number when the Lead keeps none. */
export const behindName = (lead: LeadStatus, issue: number) => {
  const builder = lead.statuses.find((each) => each.issue === issue);
  return builder === undefined ? `#${issue}` : builderName(builder.title);
};

/** What the board's header says (#592): its counts, if any, and the reasons line under them. */
export type HeaderWords = {
  /** "1 of 2 building · 0 of 4 for review"; none with nothing building or for review (#646). */
  title: string | undefined;
  reasons: string;
  /** Never run, or paused with no builders: nothing runs, so the reasons line is all it says. */
  stopped: boolean;
};

/**
 * The board's header (#592; Paper, "Tablet · Builders board"): how many build of how many may, and
 * how many pull requests wait for review of the 4 that pause it, then, under it, every reason it
 * starts no more, never only the first, or what it starts next. With nothing building and nothing
 * for review it has no counts, and never run or paused with no builders it says only that nothing
 * runs (#646, #648).
 */
export const headerWords = (
  lead: LeadStatus,
  issues: readonly NextUpIssue[],
  reviews: number,
): HeaderWords => {
  const title =
    lead.building.length === 0 && lead.ready.length === 0
      ? undefined
      : `${lead.building.length} of ${lead.builders} building · ${lead.ready.length} of ${reviews} for review`;
  const titleOf = (issue: number) =>
    issues.find((each) => each.number === issue)?.title ?? `#${issue}`;
  const held = (lead.heldBack ?? []).map((each) =>
    waitsWords(titleOf(each.issue), behindName(lead, each.behind)),
  );
  const merging =
    lead.merge === undefined
      ? []
      : [
          lead.merge.kind === "merging"
            ? `Merging #${lead.merge.pullRequest} in order`
            : `Merge in order stopped at #${lead.merge.pullRequest}: ${lead.merge.why}`,
        ];
  const tidy =
    lead.toTidy === 0 ? [] : [`${lead.toTidy} ${lead.toTidy === 1 ? "merge" : "merges"} to tidy`];
  const notRunning: HeaderWords = {
    title,
    reasons: ["Not running · Run starts the next issue", ...tidy, ...merging].join(" · "),
    stopped: true,
  };
  switch (lead.state) {
    // Never run: the same as paused with none, in every workspace (#648).
    case "not-started":
      return notRunning;
    case "paused": {
      // With no builders on the board, nothing carries on: nothing is running at all.
      if (!lead.statuses.some(({ status }) => shownToday(status))) return notRunning;
      return {
        title,
        reasons: [
          lead.toTidy === 0
            ? "Paused · builders carry on, nothing new starts"
            : "Paused · builders carry on",
          ...tidy,
          ...merging,
        ].join(" · "),
        stopped: false,
      };
    }
    case "resting":
      return {
        title,
        reasons: [lead.why ?? "Nothing ready to build", ...merging].join(" · "),
        stopped: false,
      };
    case "running": {
      const holding = (lead.holding ?? []).map(holdingWords);
      if (holding.length > 0) {
        return {
          title,
          reasons: `Not starting more: ${[...holding, ...held, ...merging].join(" · ")}`,
          stopped: false,
        };
      }
      const [next] = lead.next;
      const full = lead.building.length >= lead.builders;
      const nextWords =
        next === undefined
          ? []
          : [full ? `${next.title} starts when a place frees` : `${next.title} starts next`];
      return {
        title,
        reasons: ["Runs all night", ...nextWords, ...held, ...merging].join(" · "),
        stopped: false,
      };
    }
  }
};

/** Whether a merged builder still shows: until the end of the day it merged (#592). */
export const shownToday = (status: BuilderStatus, now = new Date()) =>
  status.kind !== "merged" || new Date(status.since).toDateString() === now.toDateString();
