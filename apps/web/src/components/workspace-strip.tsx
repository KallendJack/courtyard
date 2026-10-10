import type { WorkspaceSummary } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { LogOut, Plus } from "lucide-react";
import { classes } from "@/lib/classes";
import { IconButton } from "./button.tsx";
import { CourtyardMark } from "./courtyard-mark.tsx";
import { WorkspaceDot } from "./workspace-colour.tsx";

/** A link in the strip: a pill, marked while its page is open. */
const STRIP_LINK = "flex shrink-0 items-center rounded-full data-[status=active]:bg-muted";

/**
 * The workspace switcher on a narrow screen (a folded phone): one row across the top that
 * scrolls sideways, leaving the rest of the screen to the page.
 */
export function WorkspaceStrip(props: {
  workspaces: readonly WorkspaceSummary[];
  onLogOut: () => void;
}) {
  const link = (workspace: WorkspaceSummary) => (
    <Link
      key={workspace.id}
      to="/workspaces/$workspaceId"
      params={{ workspaceId: workspace.id }}
      className={classes(
        STRIP_LINK,
        "gap-2 px-3 py-1.5 text-sm data-[status=active]:font-semibold",
      )}
    >
      <WorkspaceDot colour={workspace.colour} small />
      {workspace.name}
    </Link>
  );
  const code = props.workspaces.filter((workspace) => workspace.mode === "code");
  return (
    <header className="flex items-center gap-1 px-3 py-2.5 md:hidden">
      <Link to="/" aria-label="Courtyard" className="shrink-0 pr-1">
        <CourtyardMark size={32} />
      </Link>
      <nav aria-label="Workspaces" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {props.workspaces.filter((workspace) => workspace.mode !== "code").map(link)}
        <Link
          to="/new-workspace"
          aria-label="New workspace"
          className={classes(
            STRIP_LINK,
            "size-8 justify-center text-muted-foreground data-[status=active]:text-foreground",
          )}
        >
          <Plus className="size-4" />
        </Link>
        {/* Code workspaces stand apart (#174), after a rule. */}
        {code.length > 0 && (
          <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-border" />
        )}
        {code.map(link)}
      </nav>
      <IconButton label="Log out" icon={<LogOut />} onClick={props.onLogOut} />
    </header>
  );
}
