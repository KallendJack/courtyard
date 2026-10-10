import type { SessionId, WorkspaceId } from "@courtyard/contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import { WorkspaceDot } from "./workspace-colour";

const loggedIn = getRouteApi("/_app");

const BACK = "flex w-fit items-center gap-2 text-xs font-medium text-primary-text hover:underline";

/**
 * The way back above a page's title: to a workspace, named and in its colour, or with no
 * workspace, to the home page's list of them; from a pull request's review, to its session.
 */
export function BackLink(props: {
  workspaceId: WorkspaceId | undefined;
  /** Where the page sits in the workspace, after its name: "Documents". */
  within?: string;
  /** Back to this session's conversation, from its pull request's review (#160). */
  session?: SessionId;
}) {
  const workspaces = loggedIn.useLoaderData();
  const { workspaceId, within, session } = props;
  if (workspaceId === undefined) {
    return (
      <Link to="/" aria-label="Back to Workspaces" className={BACK}>
        Workspaces
      </Link>
    );
  }
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];
  const workspace = list.find((w) => w.id === workspaceId);
  const name = workspace?.name ?? workspaceId;
  return (
    <Link
      {...(session === undefined
        ? { to: "/workspaces/$workspaceId", params: { workspaceId } }
        : {
            to: "/workspaces/$workspaceId/sessions/$sessionId",
            params: { workspaceId, sessionId: session },
          })}
      aria-label={session === undefined ? `Back to ${name}` : "Back to the session"}
      className={BACK}
    >
      {workspace && <WorkspaceDot colour={workspace.colour} small />}
      {within === undefined ? name : `${name} · ${within}`}
    </Link>
  );
}
