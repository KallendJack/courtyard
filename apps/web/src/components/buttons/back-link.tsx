import type { WorkspaceId } from "@courtyard/contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { WorkspaceIcon } from "../workspace/workspace-icon.tsx";

const loggedIn = getRouteApi("/_app");

const BACK = "flex w-fit items-center text-meta text-primary-text hover:underline";
const NAMED = `${BACK} gap-2 font-medium`;

/**
 * The way back above a page's title: to a workspace, named, with its icon, or with no workspace
 * (the owner context's Recent changes and Tidy, Fresh start), to Settings, where they're opened
 * from (#102); from a pull request's review, to the workspace's pull requests, as "All PRs"
 * (#240): its PRs tab (#301).
 */
export function BackLink(props: {
  workspaceId: WorkspaceId | undefined;
  /** Where the page sits in the workspace, after its name: "Documents". */
  within?: string;
  /** The workspace page's tab it goes back to, by its hash (#300): `docs`, `things`. */
  tab?: string;
  /** Back to the workspace's pull requests, from one's review (#240). */
  pullRequests?: boolean;
}) {
  const workspaces = loggedIn.useLoaderData();
  const { workspaceId, within } = props;
  if (workspaceId === undefined) {
    return (
      <Link to="/settings" aria-label="Back to Settings" className={NAMED}>
        Settings
      </Link>
    );
  }
  if (props.pullRequests) {
    return (
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId }}
        hash="prs"
        className={`${BACK} gap-1.5 font-semibold`}
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        All PRs
      </Link>
    );
  }
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];
  const workspace = list.find((w) => w.id === workspaceId);
  const name = workspace?.name ?? workspaceId;
  return (
    <Link
      to="/workspaces/$workspaceId"
      params={{ workspaceId }}
      {...(props.tab === undefined ? {} : { hash: props.tab })}
      aria-label={`Back to ${name}`}
      className={NAMED}
    >
      {workspace && <WorkspaceIcon icon={workspace.icon} size="sm" />}
      {within === undefined ? name : `${name} · ${within}`}
    </Link>
  );
}
