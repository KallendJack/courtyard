import type { DuePlan, ListedSession, WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { AlignLeft } from "lucide-react";
import { Block, BlockEmpty, BlockRows } from "@/components/home-block";
import { describeWhen } from "../when.ts";

/** How long ago a session can have been used and still be one to pick up again. */
const PICK_UP_WITHIN_MS = 7 * 86_400_000;

/**
 * The session to pick up again: one that waits on the owner (the worker's say, #334), else the
 * one used last, in the last week.
 */
const sessionToPickUp = (sessions: readonly ListedSession[], now = Date.now()) => {
  const latestFirst = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    latestFirst.find((session) => session.waiting !== "nothing") ??
    latestFirst.find((session) => now - Date.parse(session.updatedAt) <= PICK_UP_WITHIN_MS)
  );
};

/** A plan's day, as the row's label says it: "Today", "Tomorrow", or "Wed 14". */
const dayWords = (due: string, now = new Date()) => {
  const [year, month, day] = due.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const away = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (away === 0) return "Today";
  if (away === 1) return "Tomorrow";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
};

/**
 * Next up (#300; Paper, "Tablet · Planning workspace Home"): first, the session to pick up again;
 * then the plans dated in the next 7 days, as the worker reads them from the context file. With
 * neither, the block doesn't show.
 */
export function NextUp(props: {
  workspaceId: WorkspaceId;
  sessions: readonly ListedSession[];
  duePlans: readonly DuePlan[];
}) {
  const pickUp = sessionToPickUp(props.sessions);
  // Its size is the layout's, never its rows' (#398): empty, it keeps it, with one quiet line.
  if (pickUp === undefined && props.duePlans.length === 0) {
    return (
      <Block label="Next up" fill>
        <BlockEmpty>Nothing to pick up</BlockEmpty>
      </Block>
    );
  }
  return (
    <Block label="Next up" fill>
      {pickUp !== undefined && (
        <Link
          to="/workspaces/$workspaceId/sessions/$sessionId"
          params={{ workspaceId: props.workspaceId, sessionId: pickUp.id }}
          className="flex items-center gap-3 rounded-row border border-primary/35 bg-primary/12 p-3 hover:bg-primary/20"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/20 text-primary-text">
            <AlignLeft aria-hidden className="size-4" />
          </span>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="truncate text-sm/4.5 font-bold">Pick up: {pickUp.title}</span>
            <span className="truncate text-label font-medium text-primary-text">
              {pickUp.waiting === "reply" && "New reply · "}
              {describeWhen(pickUp.updatedAt)}
            </span>
          </span>
        </Link>
      )}
      {props.duePlans.length > 0 && (
        <BlockRows>
          <ul aria-label="Plans this week" className="flex flex-col gap-0.5 pt-1.5">
            {props.duePlans.map((due) => (
              <li
                key={`${due.due} ${due.plan}`}
                className="flex min-h-8.5 items-center gap-2.5 px-2.5 py-1.5"
              >
                <span className="w-20 shrink-0 text-label font-bold tracking-label text-muted-foreground uppercase">
                  {dayWords(due.due)}
                </span>
                <span className="min-w-0 grow text-label font-semibold text-foreground/90">
                  {due.plan}
                </span>
              </li>
            ))}
          </ul>
        </BlockRows>
      )}
    </Block>
  );
}
