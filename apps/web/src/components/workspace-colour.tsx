import type { WorkspaceId, WorkspaceSummary } from "@courtyard/contract";
import { getRouteApi } from "@tanstack/react-router";
import { classes } from "@/lib/classes";

/** The five workspace colours, in the order they're handed out (the theme defines each). */
const WORKSPACE_COLOURS = ["heather", "bracken", "slate", "moss", "peat"] as const;
export type WorkspaceColour = (typeof WORKSPACE_COLOURS)[number];
/** A workspace's colour, by its id. */
export type ColourOf = (id: WorkspaceId) => WorkspaceColour;

const DOT_CLASS: Record<WorkspaceColour, string> = {
  heather: "bg-workspace-heather",
  bracken: "bg-workspace-bracken",
  slate: "bg-workspace-slate",
  moss: "bg-workspace-moss",
  peat: "bg-workspace-peat",
};

/**
 * Each workspace's colour: in folder-name order, the workspaces take the colours in turn, so the
 * first five never share one. A colour holds until a workspace whose name sorts earlier is added,
 * which moves the ones after it on; #24 lets the owner choose and keeps the choice.
 */
export const workspaceColours = (workspaces: readonly WorkspaceSummary[]): ColourOf => {
  const ids = workspaces.map((workspace) => workspace.id).sort();
  return (id) => WORKSPACE_COLOURS[ids.indexOf(id) % WORKSPACE_COLOURS.length] ?? "heather";
};

const loggedIn = getRouteApi("/_app");

/** The workspace colours, inside the logged-in pages. */
export const useWorkspaceColours = (): ColourOf => {
  const workspaces = loggedIn.useLoaderData();
  return workspaceColours(workspaces.kind === "loaded" ? workspaces.data.workspaces : []);
};

/** A workspace's colour dot. */
export function WorkspaceDot(props: { colour: WorkspaceColour; small?: boolean }) {
  return (
    <span
      aria-hidden
      data-workspace-colour={props.colour}
      className={classes(
        "inline-block shrink-0 rounded-full",
        props.small ? "size-2" : "size-2.5",
        DOT_CLASS[props.colour],
      )}
    />
  );
}
