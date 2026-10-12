import { CODE_SESSIONS_AT_ONCE, type CodeSessionList, type WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Block } from "@/components/home-block";
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
 * Running (#301; Paper, "Code workspace Home"): the workspace's sessions working now, every one
 * (at most the code sessions that run at once), each with what it's doing and for how long, and
 * how many of the worker's slots are taken. Hidden when none is working.
 */
export function Running(props: {
  workspaceId: WorkspaceId;
  sessions: readonly Listed[];
  /** How many code sessions are running across the worker. */
  running: number;
}) {
  const working = props.sessions.filter((session) => session.now.kind === "working");
  if (working.length === 0) return null;
  return (
    <Block label="Running" aside={`${props.running} of ${CODE_SESSIONS_AT_ONCE}`}>
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
    </Block>
  );
}
