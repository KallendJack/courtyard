import { CODE_SESSIONS_AT_ONCE, type CodeSessionList, type WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Block, EmptyLine } from "@/components/home-block";
import { doingWords } from "@/components/session-state";

type Listed = CodeSessionList["sessions"][number];

/** How long a turn has run, in minutes: "3 min", or "just started". */
const forWords = (since: string, now = Date.now()) => {
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  return minutes < 1 ? "just started" : `${minutes} min`;
};

/** Words as a sentence starts them. */
const capitalised = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/**
 * How many turns wait ahead of a session's for a place among the code sessions running (#362);
 * `undefined` when it isn't waiting for one (none when the worker didn't say, before #362).
 */
const placesAhead = (session: Listed) => {
  if (session.now.kind !== "working" || session.now.doing.kind !== "waiting-for-place") {
    return undefined;
  }
  return session.now.doing.ahead ?? 0;
};

/**
 * Running (#301; Paper, "Code workspace Home"): the workspace's sessions working now, every one,
 * each with what it's doing and for how long, and how many of the worker's slots are taken. Those
 * running come first, then those waiting for a place, the next to start first (#362). With none
 * working it keeps its place with one quiet line (#283).
 */
export function Running(props: {
  workspaceId: WorkspaceId;
  sessions: readonly Listed[];
  /** How many code sessions are running across the worker. */
  running: number;
}) {
  const busy = props.sessions.filter((session) => session.now.kind === "working");
  const waiting = busy
    .flatMap((session) => {
      const ahead = placesAhead(session);
      return ahead === undefined ? [] : [{ session, ahead }];
    })
    .sort((a, b) => a.ahead - b.ahead)
    .map(({ session }) => session);
  const working = [...busy.filter((session) => !waiting.includes(session)), ...waiting];
  return (
    <Block label="Running" aside={`${props.running} of ${CODE_SESSIONS_AT_ONCE}`}>
      {working.length === 0 ? (
        <EmptyLine>Nothing running</EmptyLine>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {working.map((session) => (
            <li key={session.id} aria-label={session.title}>
              <Link
                to="/workspaces/$workspaceId/sessions/$sessionId"
                params={{ workspaceId: props.workspaceId, sessionId: session.id }}
                className="flex items-center gap-2.5 rounded-row bg-secondary px-3 py-2.5 hover:bg-muted"
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary shadow-glow" />
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="truncate text-sm/4.5 font-bold">{session.title}</span>
                  <span className="truncate text-label font-medium text-primary-text">
                    {session.now.kind === "working" &&
                      `${capitalised(doingWords(session.now.doing))} · ${forWords(session.now.since)}`}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-placeholder" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
