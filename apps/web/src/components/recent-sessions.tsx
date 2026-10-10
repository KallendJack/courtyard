import {
  SESSION_TITLE_MAX_LENGTH,
  type SessionId,
  SessionList,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { Link, useLocation, useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { describeProblem } from "../problems.tsx";
import { fromWorker, renameSession } from "../worker.ts";
import { GROUP_HEADING } from "./app-sidebar.tsx";
import { IconButton } from "./button.tsx";
import { RenameForm } from "./rename-form.tsx";

/** How many of a workspace's sessions the sidebar lists. */
const RECENT_SESSIONS = 5;

/**
 * The open workspace's latest sessions in the sidebar, refreshed as the owner moves around and whenever a page
 * reloads its data (after a session is renamed, say). Each can be renamed in place.
 */
export function RecentSessions(props: { workspaces: readonly WorkspaceSummary[] }) {
  const { workspaceId } = useParams({ strict: false });
  const { pathname } = useLocation();
  const loadedAt = useRouterState({ select: (state) => state.matches.at(-1)?.updatedAt });
  const router = useRouter();
  /** The sessions last fetched, and whose they are, so another workspace's are never shown. */
  const [listed, setListed] = useState<{
    workspaceId: string;
    sessions: SessionList["sessions"];
  }>();
  const [renaming, setRenaming] = useState<SessionId>();
  const workspace = props.workspaces.find((w) => w.id === workspaceId);
  const sessions = listed && listed.workspaceId === workspaceId ? listed.sessions : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname and loadedAt are the triggers: moving between pages (starting a session, say) or a page reloading its data refreshes the list
  useEffect(() => {
    if (workspaceId === undefined) return;
    let current = true;
    void fromWorker(`/workspaces/${encodeURIComponent(workspaceId)}/sessions`, SessionList).then(
      (result) => {
        const sessions = result.kind === "loaded" ? result.data.sessions : [];
        if (current) setListed({ workspaceId, sessions });
      },
    );
    return () => {
      current = false;
    };
  }, [workspaceId, pathname, loadedAt]);

  if (!workspace || sessions.length === 0) return null;
  return (
    <section
      aria-label={`Recent in ${workspace.name}`}
      className="flex flex-col group-data-[collapsed=true]/sidebar:hidden"
    >
      <h2 className={GROUP_HEADING}>Recent in {workspace.name}</h2>
      <ul>
        {sessions.slice(0, RECENT_SESSIONS).map((session) =>
          renaming === session.id ? (
            <li key={session.id} className="px-1 py-1">
              <RenameForm
                label="Session title"
                value={session.title}
                maxLength={SESSION_TITLE_MAX_LENGTH}
                save={async (title) => {
                  const renamed = await renameSession(session.id, { title });
                  if (renamed.kind !== "loaded") return describeProblem(renamed).body;
                  const others = sessions.map((s) => (s.id === session.id ? renamed.data : s));
                  setListed({ workspaceId: session.workspaceId, sessions: others });
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
