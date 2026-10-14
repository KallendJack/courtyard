import {
  SESSION_TITLE_MAX_LENGTH,
  type SessionId,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { Link, useLocation, useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { describeProblem } from "../problems.tsx";
import { KEPT_SESSIONS, loadSessions, sessionsBusyEveryMs } from "../sessions/kept-sessions.ts";
import { renameSession } from "../worker-calls.ts";
import { GROUP_HEADING } from "./app-sidebar.tsx";
import { IconButton } from "./button.tsx";
import { PlaceholderRows, useKept } from "./kept.tsx";
import { RenameForm } from "./rename-form.tsx";
import { SessionStateDot } from "./session-state.tsx";

/** How many of a workspace's sessions the sidebar lists. */
const RECENT_SESSIONS = 5;

/**
 * The open workspace's latest sessions in the sidebar, refreshed as the owner moves around and whenever a page
 * reloads its data (after a session is renamed, say), and every few seconds while one is working or needs the
 * owner, which a dot before its title says (#179). Each can be renamed in place. Coming back to a workspace shows
 * them as last known at once; the first time, faint rows keep their place (nothing jumps in).
 */
export function RecentSessions(props: { workspaces: readonly WorkspaceSummary[] }) {
  const { workspaceId } = useParams({ strict: false });
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
                className="block truncate rounded-md py-1.5 pr-9 pl-3 text-sm text-muted-foreground hover:bg-muted/60 data-[status=active]:font-medium data-[status=active]:text-foreground"
              >
                <SessionStateDot now={session.now} />
                {session.title}
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
    </section>
  );
}
