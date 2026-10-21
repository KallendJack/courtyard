import type { ThingSlug, WorkspaceId } from "@courtyard/contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { WorkspaceIcon } from "../workspace/workspace-icon.tsx";

const loggedIn = getRouteApi("/_app");

const BACK = "flex w-fit items-center text-meta text-primary-text hover:underline";
const NAMED = `${BACK} gap-2 font-medium`;
/** A pill a full tap high, with a ‹ and the workspace's name (#521). */
const PILL =
  "flex h-10 w-fit shrink-0 items-center gap-1.5 rounded-full border border-border bg-field pr-4 pl-2.5 text-interface font-semibold text-primary-text transition-colors hover:bg-accent";

/**
 * The way back above a page's title: to a workspace, named, with its icon, or with no workspace
 * (the owner context's Recent changes and Tidy, Fresh start), to Settings, where they're opened
 * from (#102); from a pull request's review, to the workspace's pull requests, as "All PRs"
 * (#240): its PRs tab (#301); from Find a replacement, to its Thing, by name (#602). From a session, a button: its only way out, now the right rail no
 * longer lists the workspace's sessions (#521; Paper, "Tablet · Session: back button, no rail list").
 */
export function BackLink(props: {
  workspaceId: WorkspaceId | undefined;
  /** Where the page sits in the workspace, after its name: "Documents". */
  within?: string;
  /** The workspace page's tab it goes back to, by its hash (#300): `docs`, `things`. */
  tab?: string;
  /** Back to the workspace's pull requests, from one's review (#240). */
  pullRequests?: boolean;
  /** A pill button rather than a line of text: a session's way back (#521). */
  button?: boolean;
  /** Back to one of the workspace's Things, by its name: from Find a replacement (#602). */
  thing?: { readonly slug: ThingSlug; readonly name: string };
}) {
  const workspaces = loggedIn.useLoaderData();
  const { workspaceId, within, thing } = props;
  if (workspaceId !== undefined && thing !== undefined) {
    return (
      <Link
        to="/workspaces/$workspaceId/things/$slug"
        params={{ workspaceId, slug: thing.slug }}
        aria-label={`Back to ${thing.name}`}
        className={`${BACK} gap-1.5 font-semibold`}
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        {thing.name}
      </Link>
    );
  }
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
  if (props.button) {
    return (
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId }}
        aria-label={`Back to ${name}`}
        className={PILL}
      >
        <ChevronLeft aria-hidden className="size-4.5" strokeWidth={2.4} />
        {name}
      </Link>
    );
  }
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
