import {
  SESSION_TITLE_MAX_LENGTH,
  type SessionId,
  type SessionWaiting,
  type TurnNow,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { IconButton } from "@courtyard/ui/buttons/button.tsx";
import { PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Link, useLocation, useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { renameSession } from "../../api/worker-calls.ts";
import {
  KEPT_SESSIONS,
  loadSessions,
  sessionsBusyEveryMs,
} from "../../features/sessions/kept-sessions.ts";
import { describeWhen } from "../../lib/when.ts";
import { SessionWaitingDot, waitingMark } from "../chat/session-state.tsx";
import { RenameForm } from "../forms/rename-form.tsx";
import { describeProblem } from "../layout/problems.tsx";

/** The list's heading: "Recent in Garage gym". */
const GROUP_HEADING = "px-3 pb-1.5 text-meta font-medium text-muted-foreground";

/** How many of a workspace's sessions the sidebar lists. */
const RECENT_SESSIONS = 5;

/**
 * The open workspace's latest sessions on its sheet, refreshed as the owner moves around and whenever a page
 * reloads its data (after a session is renamed, say), and every few seconds while one is working or needs the
 * owner, which a dot before its title and a word after it say (#179, #492), with All sessions at the foot. Each
 * can be renamed in place. Coming back to a workspace shows
 * them as last known at once; the first time, faint rows keep their place (nothing jumps in).
 */
export function RecentSessions(props: { workspaces: readonly WorkspaceSummary[] }) {
  const { workspaceId, sessionId } = useParams({ strict: false });
  const { pathname } = useLocation();
  const loadedAt = useRouterState({ select: (state) => state.matches.at(-1)?.updatedAt });
  const router = useRouter();
  const [renaming, setRenaming] = useState<SessionId>();
  const workspace = props.workspaces.find((w) => w.id === workspaceId);
  // Moving between pages (starting a session, say) or a page reloading its data asks for the list
  // again, and it's kept fresh the shared way, faster while one shown is working (#387).
  const list = useKept(KEPT_SESSIONS, {
    key: workspaceId ?? "",
    load: () => loadSessions(workspaceId ?? ""),
    again: `${pathname}:${loadedAt}`,
    asking: workspaceId !== undefined,
    busy: (known) => sessionsBusyEveryMs(known.sessions.slice(0, RECENT_SESSIONS)),
  });
  const sessions = list?.sessions ?? [];
  const shown = sessions.slice(0, RECENT_SESSIONS);

  if (!workspace || (list !== undefined && sessions.length === 0)) return null;
  return (
    <section
      aria-label={`Recent in ${workspace.name}`}
      className="flex flex-col group-data-[collapsed=true]/sidebar:hidden"
    >
      <h2 className={GROUP_HEADING}>Recent in {workspace.name}</h2>
      {list === undefined && <PlaceholderRows count={3} size="line" />}
      <ul>
        {shown.map((session) =>
          renaming === session.id ? (
            <li key={session.id} className="px-1 py-1">
              <RenameForm
                label="Session title"
                value={session.title}
                maxLength={SESSION_TITLE_MAX_LENGTH}
                save={async (title) => {
                  const renamed = await renameSession(session.id, { title });
                  if (renamed.kind !== "loaded") return describeProblem(renamed).body;
                  const others = sessions.map((s) =>
                    s.id === session.id ? { ...s, ...renamed.data } : s,
                  );
                  if (list !== undefined) {
                    KEPT_SESSIONS.set(session.workspaceId, { ...list, sessions: others });
                  }
                  // The session's own page, if it's open, shows the new title too.
                  await router.invalidate();
                  return undefined;
                }}
                onDone={() => setRenaming(undefined)}
              />
            </li>
          ) : (
            <li key={session.id} className="group/row relative">
              <Link
                to="/workspaces/$workspaceId/sessions/$sessionId"
                params={{ workspaceId: session.workspaceId, sessionId: session.id }}
                aria-label={session.title}
                className="flex items-center gap-2.5 rounded-md py-2 pr-9 pl-3 text-sm text-muted-foreground hover:bg-muted/60 data-[status=active]:bg-muted/60 data-[status=active]:font-medium data-[status=active]:text-foreground"
              >
                <SessionWaitingDot now={session.now} waiting={session.waiting} />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <StandingWord session={session} here={session.id === sessionId} />
              </Link>
              {/* Shown on hover or focus with a mouse; always on a touch screen, which can't hover. */}
              <span className="absolute top-1/2 right-1 flex -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                <IconButton
                  label={`Rename ${session.title}`}
                  icon={<Pencil />}
                  size="sm"
                  square
                  onClick={() => setRenaming(session.id)}
                />
              </span>
            </li>
          ),
        )}
      </ul>
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId: workspace.id }}
        hash="sessions"
        className="px-3 pt-2 text-sm font-semibold text-primary-text underline-offset-[3px] hover:underline"
      >
        All sessions
      </Link>
    </section>
  );
}

/**
 * Where a session stands, at the end of its row (#492; Paper, "Cover · Sessions sheet from the
 * workspace chip"): Here for the one open, what it waits on the owner for in gold, Running or
 * New reply in violet, or else when it was last active.
 */
function StandingWord(props: {
  session: { now: TurnNow; waiting: SessionWaiting; updatedAt: string };
  here: boolean;
}) {
  const mark = waitingMark(props.session);
  const word = props.here ? "Here" : (mark?.word ?? describeWhen(props.session.updatedAt));
  return (
    <span
      className={classes(
        "shrink-0 text-meta font-semibold",
        props.here || mark === undefined
          ? "text-muted-foreground"
          : mark.tone === "needs-you"
            ? "text-warning"
            : "text-primary-text",
      )}
    >
      {word}
    </span>
  );
}
