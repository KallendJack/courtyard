import type { WorkspaceSummary } from "@courtyard/contract";
import { Link, useParams } from "@tanstack/react-router";
import { LogOut, PanelLeft, Plus, Settings } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { classes } from "@/lib/classes";
import { IconButton } from "./button.tsx";
import { CourtyardLockup } from "./courtyard-mark.tsx";
import { WorkspaceIcon } from "./workspace-icon.tsx";

/**
 * Loaded once a workspace is open, so it stays off the first load: the home page lists no
 * sessions.
 */
const RecentSessions = lazy(() =>
  import("./recent-sessions.tsx").then((module) => ({ default: module.RecentSessions })),
);
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
  "text-interface/normal data-[status=active]:bg-muted data-[status=active]:font-semibold",
);

/** A group's heading in the sidebar (code workspaces, recent sessions), gone in the rail. */
export const GROUP_HEADING =
  "px-3 pb-1.5 text-meta font-medium text-muted-foreground group-data-[collapsed=true]/sidebar:hidden";

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
 * icons with its toggle or Ctrl+B, and each device remembers which way it was left.
 */
export function AppSidebar(props: {
  workspaces: readonly WorkspaceSummary[];
  onLogOut: () => void;
}) {
  const [collapsed, setCollapsed] = useState(wasCollapsed);
  const { workspaceId } = useParams({ strict: false });
  const toggle = useCallback(() => setCollapsed((was) => !was), []);

  useEffect(() => remember(collapsed), [collapsed]);

  /** A workspace's row: its icon, violet while it's open, and its name until the sidebar is a rail. */
  const row = (workspace: WorkspaceSummary) => (
    <li key={workspace.id}>
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId: workspace.id }}
        aria-label={workspace.name}
        title={collapsed ? workspace.name : undefined}
        className={WORKSPACE_ROW}
      >
        <WorkspaceIcon icon={workspace.icon} size="md" open={workspace.id === workspaceId} />
        <span className="truncate group-data-[collapsed=true]/sidebar:hidden">
          {workspace.name}
        </span>
      </Link>
    </li>
  );
  const code = props.workspaces.filter((workspace) => workspace.mode === "code");

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
      <nav
        aria-label="Workspaces"
        className="flex h-full flex-col gap-6 overflow-y-auto px-2 pt-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom))]"
      >
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
        <ul aria-label="Planning workspaces" className="flex flex-col gap-0.5">
          {props.workspaces.filter((workspace) => workspace.mode !== "code").map(row)}
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
              <Plus className="size-4 shrink-0" aria-hidden />
              <span className="truncate group-data-[collapsed=true]/sidebar:hidden">
                New workspace
              </span>
            </Link>
          </li>
        </ul>
        {/* Code workspaces stand apart (#174): their own group, below the planning ones. */}
        {code.length > 0 && (
          <div className="flex flex-col">
            <h2 className={GROUP_HEADING}>Code</h2>
            <ul aria-label="Code workspaces" className="flex flex-col gap-0.5">
              {code.map(row)}
            </ul>
          </div>
        )}
        {workspaceId !== undefined && (
          <Suspense>
            <RecentSessions workspaces={props.workspaces} />
          </Suspense>
        )}
        {/* Settings (#102): the owner context, Connections and the rest that left Home. */}
        <div className="mt-auto flex flex-col gap-0.5 text-sm text-muted-foreground">
          <Link
            to="/settings"
            title={collapsed ? "Settings" : undefined}
            className={classes(
              ROW,
              "data-[status=active]:bg-muted data-[status=active]:text-foreground",
            )}
          >
            <Settings className="size-4 shrink-0" aria-hidden />
            <span className="group-data-[collapsed=true]/sidebar:sr-only">Settings</span>
          </Link>
          <button
            type="button"
            onClick={props.onLogOut}
            title={collapsed ? "Log out" : undefined}
            className={ROW}
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            <span className="group-data-[collapsed=true]/sidebar:sr-only">Log out</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
