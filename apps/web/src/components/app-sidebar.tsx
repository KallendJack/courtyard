import {
  SESSION_TITLE_MAX_LENGTH,
  type SessionId,
  SessionList,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { Link, useLocation, useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { LogOut, PanelLeft, Pencil, Plus } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { classes } from "@/lib/classes";
import { describeProblem } from "../problems.tsx";
import { fromWorker, renameSession } from "../worker.ts";
import { IconButton } from "./button.tsx";
import { CourtyardLockup } from "./courtyard-mark.tsx";
import { WorkspaceDot } from "./workspace-colour.tsx";

/** Loaded when the owner first renames from the sidebar, so it stays off the first load. */
const RenameForm = lazy(() =>
  import("./rename-form.tsx").then((module) => ({ default: module.RenameForm })),
);

/** How many of a workspace's sessions the sidebar lists. */
const RECENT_SESSIONS = 5;
/** Where this device remembers that the sidebar was collapsed. */
const COLLAPSED_KEY = "courtyard.sidebar-collapsed";

const wasCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
};

/** Whether the keyboard is in something that takes text, where Ctrl+B belongs to it. */
const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** A row in the sidebar: one height, one hover, centred once the sidebar is a rail. */
const ROW =
  "flex h-9 items-center gap-3 rounded-md px-3 hover:bg-muted/60 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0";
/** A workspace's row (and New workspace's), marked while its page is open. */
const WORKSPACE_ROW = classes(
  ROW,
  "text-[15px] data-[status=active]:bg-muted data-[status=active]:font-semibold",
);

/** The sidebar only shows from tablet width up; below that the workspace strip takes over. */
const SHOWN = "(min-width: 768px)";

const remember = (collapsed: boolean) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    // Storage can be off (a private window, say); the sidebar just won't be remembered.
  }
};

/**
 * The workspace switcher on an unfolded phone or a desktop. It collapses to a rail of workspace
 * dots with its toggle or Ctrl+B, and each device remembers which way it was left.
 */
export function AppSidebar(props: {
  workspaces: readonly WorkspaceSummary[];
  onLogOut: () => void;
}) {
  const [collapsed, setCollapsed] = useState(wasCollapsed);
  const toggle = useCallback(() => setCollapsed((was) => !was), []);

  useEffect(() => remember(collapsed), [collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = event.key === "b" && (event.ctrlKey || event.metaKey);
      if (shortcut && !typingIn(event.target) && window.matchMedia(SHOWN).matches) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <aside
      data-collapsed={collapsed}
      className={classes(
        "group/sidebar sticky top-0 hidden h-dvh shrink-0 transition-[width] duration-200 ease-out md:block",
        collapsed ? "w-16" : "w-[212px] xl:w-62",
      )}
    >
      <nav aria-label="Workspaces" className="flex h-full flex-col gap-6 overflow-y-auto px-2 py-4">
        <div className="flex h-9 items-center justify-between pl-2 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:pl-0">
          <Link to="/" className="group-data-[collapsed=true]/sidebar:hidden">
            <CourtyardLockup />
          </Link>
          <IconButton
            label="Toggle sidebar"
            hint="Ctrl+B"
            icon={<PanelLeft />}
            square
            expanded={!collapsed}
            onClick={toggle}
          />
        </div>
        <ul className="flex flex-col gap-0.5">
          {props.workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId: workspace.id }}
                aria-label={workspace.name}
                title={collapsed ? workspace.name : undefined}
                className={WORKSPACE_ROW}
              >
                <WorkspaceDot colour={workspace.colour} />
                <span className="truncate group-data-[collapsed=true]/sidebar:hidden">
                  {workspace.name}
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              to="/new-workspace"
              aria-label="New workspace"
              title={collapsed ? "New workspace" : undefined}
              className={classes(
                WORKSPACE_ROW,
                "text-muted-foreground data-[status=active]:text-foreground",
              )}
            >
              {/* As wide as a dot's slot, so the names line up. */}
              <Plus className="-mx-[3px] size-4 shrink-0" aria-hidden />
              <span className="truncate group-data-[collapsed=true]/sidebar:hidden">
                New workspace
              </span>
            </Link>
          </li>
        </ul>
        <RecentSessions workspaces={props.workspaces} />
        <button
          type="button"
          onClick={props.onLogOut}
          title={collapsed ? "Log out" : undefined}
          className={classes(ROW, "mt-auto text-sm text-muted-foreground")}
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          <span className="group-data-[collapsed=true]/sidebar:sr-only">Log out</span>
        </button>
      </nav>
    </aside>
  );
}

/**
 * The open workspace's latest sessions, refreshed as the owner moves around and whenever a page
 * reloads its data (after a session is renamed, say). Each can be renamed in place.
 */
function RecentSessions(props: { workspaces: readonly WorkspaceSummary[] }) {
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
      <h2 className="px-3 pb-1.5 text-xs font-medium text-muted-foreground">
        Recent in {workspace.name}
      </h2>
      <ul>
        {sessions.slice(0, RECENT_SESSIONS).map((session) =>
          renaming === session.id ? (
            <li key={session.id} className="px-1 py-1">
              <Suspense>
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
              </Suspense>
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
