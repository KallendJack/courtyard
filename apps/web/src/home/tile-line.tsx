import type {
  CodeSessionList,
  MattSetup,
  OpenPullRequest,
  SessionId,
  WorkspaceSummary,
} from "@courtyard/contract";
import { useEffect } from "react";
import { useLayout } from "@/components/handheld";
import { PlaceholderRows } from "@/components/kept";
import { classes } from "@/lib/classes";
import {
  agoWords,
  type Need,
  needsOf,
  newestSessionNeed,
  type SessionNeed,
} from "../code-home/needs.ts";
import { useOpenPullRequests } from "../review/open-pull-requests.ts";
import { useKeptSessions } from "../sessions/kept-sessions.ts";
import { describeWhen } from "../when.ts";
import "./stylesheet.ts";

type Listed = CodeSessionList["sessions"][number];

/** A tile's line counts what's in the workspace's sessions and pull requests, never Matt's setup. */
const NO_SETUP: MattSetup = { state: "none" };

/** How long a last session's title shows on its tile, before only the day does. */
const RECENT_MS = 24 * 60 * 60 * 1000;

/** "1 new reply", "2 new replies". */
const counted = (count: number, one: string, more: string) =>
  `${count} ${count === 1 ? one : more}`;

/**
 * What waits on the owner, in a few words, in Needs you's order: "2 new replies", "2 PRs to merge"
 * ("2 to merge" on the cover screen, as its board says).
 */
const needsWords = (needs: readonly Need[], short: boolean) => {
  const of = (kind: Need["kind"]) => needs.filter((need) => need.kind === kind).length;
  return [
    [of("approval"), "to approve", "to approve"],
    [of("failed"), "failing", "failing"],
    [of("reply"), "new reply", "new replies"],
    [of("merge"), short ? "to merge" : "PR to merge", short ? "to merge" : "PRs to merge"],
    [of("conflict"), "conflicting", "conflicting"],
  ] as const;
};

/**
 * The newest session waiting on the owner, by name (#345): "New reply · Brake pads", "Approve ·
 * Build #285", and "and 1 more" for everything else that waits.
 */
const namedWords = (named: SessionNeed, needs: readonly Need[]) => {
  const what = `${named.kind === "approval" ? "Approve" : "New reply"} · ${named.session.title}`;
  return needs.length > 1 ? `${what} and ${needs.length - 1} more` : what;
};

/** When the workspace was last used: its last session's title a day long, then only the day. */
const usedWords = (sessions: readonly Listed[], now = Date.now()) => {
  const last = sessions.reduce<Listed | undefined>(
    (latest, session) =>
      latest === undefined || session.updatedAt > latest.updatedAt ? session : latest,
    undefined,
  );
  if (last === undefined) return "No sessions yet";
  return now - Date.parse(last.updatedAt) < RECENT_MS
    ? `${last.title} · ${agoWords(last.updatedAt, now)}`
    : describeWhen(last.updatedAt);
};

/**
 * What a workspace's tile says under its name (#102; Paper, "Home"): what waits on the owner when
 * something does, as the worker decided it and Needs you reads it (`needs.ts`, #334); the newest
 * session waiting by name, or else (pull requests only) how many wait (#345); violet new replies,
 * with their count in the tile's corner, or on a code workspace (or for anything but a reply)
 * gold with a gold edge, and how many of its sessions are running. Otherwise when it was last
 * used. When only one session waits, `onOpens` names it, so a tap opens it. Until its sessions
 * are known (a first visit), a faint line in the line's place; a code workspace's pull requests
 * join in place once GitHub answers. No model is asked.
 */
export default function TileLine(props: {
  workspace: WorkspaceSummary;
  onOpens: (session: SessionId | undefined) => void;
}) {
  const { workspace, onOpens } = props;
  const code = workspace.mode === "code";
  const short = useLayout() === "cover";
  const list = useKeptSessions(workspace.id);
  const sessions = list?.sessions ?? [];
  const open = useOpenPullRequests(workspace.id, sessions, code && list !== undefined);
  const pulls: readonly OpenPullRequest[] = open?.pullRequests ?? [];
  const needs = needsOf({ sessions, pulls, setup: NO_SETUP });
  const named = newestSessionNeed(needs);
  const only = needs.length === 1 ? named?.session.id : undefined;
  useEffect(() => onOpens(only), [onOpens, only]);
  if (list === undefined) return <PlaceholderRows count={1} size="label" />;

  if (needs.length === 0) {
    return (
      <span className="block truncate text-label font-medium text-muted-foreground">
        {usedWords(sessions)}
      </span>
    );
  }
  const running = sessions.filter((session) => session.now.kind === "working").length;
  const words = [
    ...(named === undefined
      ? needsWords(needs, short)
          .filter(([count]) => count > 0)
          .map(([count, one, more]) => counted(count, one, more))
      : [namedWords(named, needs)]),
    ...(running > 0 ? [`${running} running`] : []),
  ].join(" · ");
  const gold = code || needs.some((need) => need.kind !== "reply");
  return (
    <>
      <span
        className={classes(
          "block truncate text-label font-semibold",
          gold ? "text-warning" : "text-primary-text",
        )}
      >
        {words}
      </span>
      {gold ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-tile ring-1 ring-warning/25 ring-inset"
        />
      ) : (
        <span
          aria-hidden
          className="absolute top-3.5 right-3.5 flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-primary-text px-1.75 text-label/3 font-bold text-card"
        >
          {needs.length}
        </span>
      )}
    </>
  );
}
