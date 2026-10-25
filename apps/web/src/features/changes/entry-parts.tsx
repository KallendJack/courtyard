import type { RecentChange, WorkspaceId } from "@courtyard/contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import { describeWhen } from "../../lib/when.ts";

// The small parts of a Recent changes entry: when and where it came from, and its Open link.

const loggedIn = getRouteApi("/_app");

/** Whose changes these are: a workspace's, or the owner context's for `undefined`. */
export type Whose = WorkspaceId | undefined;

/** When it was, and where it came from: its session (with its workspace, in the owner's list). */
export function Meta(props: { workspace: Whose; change: RecentChange; note?: string | undefined }) {
  const { workspace, change } = props;
  const workspaces = loggedIn.useLoaderData();
  const { session } = change;
  const from =
    workspace === undefined && session !== undefined && workspaces.kind === "loaded"
      ? workspaces.data.workspaces.find((w) => w.id === session.workspaceId)?.name
      : undefined;
  const parts = [
    describeWhen(change.at),
    ...(props.note === undefined ? [] : [props.note]),
    ...(change.kind === "hand-edit"
      ? [`in ${workspace === undefined ? "OWNER.md" : "CONTEXT.md"}`]
      : []),
    ...(from === undefined ? [] : [from]),
  ];
  return (
    <p className="text-meta/5 text-muted-foreground">
      {parts.join(" · ")}
      {session !== undefined && (
        <>
          {" · "}
          <Link
            to="/workspaces/$workspaceId/sessions/$sessionId"
            params={{ workspaceId: session.workspaceId, sessionId: session.id }}
            className="text-foreground underline"
          >
            {session.title}
          </Link>
        </>
      )}
    </p>
  );
}

export const OPEN = "text-meta/5 text-foreground underline";

/** Open, under a document's or a Thing's entry while it's still there: its page. */
export function OpenLink(props: {
  workspaceId: WorkspaceId;
  kind: "document" | "thing";
  slug: string;
}) {
  const params = { workspaceId: props.workspaceId, slug: props.slug };
  return props.kind === "document" ? (
    <Link to="/workspaces/$workspaceId/documents/$slug" params={params} className={OPEN}>
      Open
    </Link>
  ) : (
    <Link to="/workspaces/$workspaceId/things/$slug" params={params} className={OPEN}>
      Open
    </Link>
  );
}
