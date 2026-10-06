import { SessionList, type WorkspaceSummary } from "@courtyard/contract";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { LogOut, PanelLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { classes } from "@/lib/classes";
import { fromWorker } from "../worker.ts";
import { CourtyardLockup } from "./courtyard-mark.tsx";
import { WorkspaceDot } from "./workspace-colour.tsx";

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
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle sidebar"
            aria-expanded={!collapsed}
            title="Toggle sidebar (Ctrl+B)"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <PanelLeft className="size-[18px]" />
          </button>
        </div>
        <ul className="flex flex-col gap-0.5">
          {props.workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId: workspace.id }}
                aria-label={workspace.name}
                title={collapsed ? workspace.name : undefined}
                className="flex h-9 items-center gap-3 rounded-md px-3 text-[15px] hover:bg-muted/60 data-[status=active]:bg-muted data-[status=active]:font-semibold group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
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
              className="flex h-9 items-center gap-3 rounded-md px-3 text-[15px] text-muted-foreground hover:bg-muted/60 data-[status=active]:bg-muted data-[status=active]:font-semibold data-[status=active]:text-foreground group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
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
          className="mt-auto flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted/60 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          <span className="group-data-[collapsed=true]/sidebar:sr-only">Log out</span>
        </button>
      </nav>
    </aside>
  );
}

/** The open workspace's latest sessions, refreshed as the owner moves around. */
function RecentSessions(props: { workspaces: readonly WorkspaceSummary[] }) {
  const { workspaceId } = useParams({ strict: false });
  const { pathname } = useLocation();
  const [sessions, setSessions] = useState<SessionList["sessions"]>([]);
  const workspace = props.workspaces.find((w) => w.id === workspaceId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger: moving between pages (starting a session, say) refreshes the list
  useEffect(() => {
    setSessions([]);
    if (workspaceId === undefined) return;
    let current = true;
    void fromWorker(`/workspaces/${encodeURIComponent(workspaceId)}/sessions`, SessionList).then(
      (result) => {
        if (current) setSessions(result.kind === "loaded" ? result.data.sessions : []);
      },
    );
    return () => {
      current = false;
    };
  }, [workspaceId, pathname]);

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
        {sessions.slice(0, RECENT_SESSIONS).map((session) => (
          <li key={session.id}>
            <Link
              to="/workspaces/$workspaceId/sessions/$sessionId"
              params={{ workspaceId: session.workspaceId, sessionId: session.id }}
              className="block truncate rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 data-[status=active]:font-medium data-[status=active]:text-foreground"
            >
              {session.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
