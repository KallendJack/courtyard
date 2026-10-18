import type { WorkspaceSummary } from "@courtyard/contract";
import { Link, useLocation } from "@tanstack/react-router";
import { useKeptSessions } from "../../features/sessions/kept-sessions.ts";
import { SessionWaitingDot } from "../chat/session-state.tsx";
import { CapsLabel } from "../layout/caps-label.tsx";
import { PlaceholderRows } from "../layout/kept.tsx";
import { Scroller } from "../layout/scroller.tsx";

/** How many of the open workspace's sessions the rail lists. */
const RAIL_SESSIONS = 5;

/**
 * The open workspace's latest sessions in the right rail (#492; Paper, "Tablet · Session, sessions
 * in the right rail"), between Settings and Talk: one tap to each, the one open lit, a dot on those
 * waiting (gold needs the owner, violet live or a new reply), and All sessions at the foot. It
 * keeps its size; more than fit scroll inside it.
 */
export function RailSessions(props: { workspace: WorkspaceSummary }) {
  const { workspace } = props;
  const { pathname } = useLocation();
  const list = useKeptSessions(workspace.id, pathname);
  const shown = (list?.sessions ?? []).slice(0, RAIL_SESSIONS);
  return (
    <section
      aria-label={`Latest in ${workspace.name}`}
      className="flex min-h-0 flex-1 flex-col gap-1 pt-3"
    >
      <CapsLabel tone="muted" heading={{ level: 2 }} className="px-2.5 pb-1">
        Sessions
      </CapsLabel>
      <Scroller className="min-h-0 flex-1">
        {list === undefined ? (
          <PlaceholderRows count={3} size="line" />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((session) => (
              <li key={session.id}>
                <Link
                  to="/workspaces/$workspaceId/sessions/$sessionId"
                  params={{ workspaceId: session.workspaceId, sessionId: session.id }}
                  aria-label={session.title}
                  className="flex items-start gap-2 rounded-row px-2.5 py-2 text-sm/4.5 font-semibold text-foreground/70 hover:bg-muted/60 data-[status=active]:bg-muted data-[status=active]:font-bold data-[status=active]:text-foreground"
                >
                  <SessionWaitingDot now={session.now} waiting={session.waiting} />
                  <span className="line-clamp-2 min-w-0">{session.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/workspaces/$workspaceId"
          params={{ workspaceId: workspace.id }}
          hash="sessions"
          className="block pt-2 pr-2.5 pl-6.25 text-sm font-semibold text-primary-text hover:underline"
        >
          All sessions
        </Link>
      </Scroller>
    </section>
  );
}
