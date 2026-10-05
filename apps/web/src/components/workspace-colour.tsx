import type { WorkspaceSummary } from "@courtyard/contract";
import { classes } from "@/lib/classes";

/** The five workspace colours, in the order they're handed out (the theme defines each). */
const WORKSPACE_COLOURS = ["heather", "bracken", "slate", "moss", "peat"] as const;
export type WorkspaceColour = (typeof WORKSPACE_COLOURS)[number];

const DOT_CLASS: Record<WorkspaceColour, string> = {
  heather: "bg-workspace-heather",
  bracken: "bg-workspace-bracken",
  slate: "bg-workspace-slate",
  moss: "bg-workspace-moss",
  peat: "bg-workspace-peat",
};

/**
 * Each workspace's colour: the workspaces in name order take the colours in turn, so the first
 * five never share one and a workspace keeps its colour from visit to visit. (#24 lets the owner
 * choose.)
 */
export const workspaceColours = (workspaces: readonly WorkspaceSummary[]) => {
  const ids = workspaces.map((workspace) => workspace.id).sort();
  return new Map(
    ids.map((id, index): [string, WorkspaceColour] => [
      id,
      WORKSPACE_COLOURS[index % WORKSPACE_COLOURS.length] ?? "heather",
    ]),
  );
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
