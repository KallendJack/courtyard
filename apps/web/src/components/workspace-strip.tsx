import type { WorkspaceSummary } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { LogOut, Plus } from "lucide-react";
import { CourtyardMark } from "./courtyard-mark.tsx";
import { WorkspaceDot } from "./workspace-colour.tsx";

/**
 * The workspace switcher on a narrow screen (a folded phone): one row across the top that
 * scrolls sideways, leaving the rest of the screen to the page.
 */
export function WorkspaceStrip(props: {
  workspaces: readonly WorkspaceSummary[];
  onLogOut: () => void;
}) {
  return (
    <header className="flex items-center gap-1 px-3 py-2.5 md:hidden">
      <Link to="/" aria-label="Courtyard" className="shrink-0 pr-1">
        <CourtyardMark size={32} />
      </Link>
      <nav aria-label="Workspaces" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {props.workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            to="/workspaces/$workspaceId"
            params={{ workspaceId: workspace.id }}
            className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm data-[status=active]:bg-muted data-[status=active]:font-semibold"
          >
            <WorkspaceDot colour={workspace.colour} small />
            {workspace.name}
          </Link>
        ))}
        <Link
          to="/new-workspace"
          aria-label="New workspace"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
        >
          <Plus className="size-4" />
        </Link>
      </nav>
      <button
        type="button"
        onClick={props.onLogOut}
        aria-label="Log out"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      >
        <LogOut className="size-4" />
      </button>
    </header>
  );
}
