import { WorkspaceId } from "@courtyard/contract";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { Page, PageTitle } from "@/components/page";
import { RecentChanges } from "../../changes/recent-changes.tsx";

export const Route = createFileRoute("/_app/changes")({
  // Whose changes: a workspace's, named in the address, or the owner context's without one.
  validateSearch: (search: Record<string, unknown>) => {
    const workspace = WorkspaceId.safeParse(search.workspace);
    return workspace.success ? { workspace: workspace.data } : {};
  },
  component: Changes,
});

const loggedIn = getRouteApi("/_app");

const BACK = "w-fit text-xs font-medium text-primary-text hover:underline";

/**
 * Recent changes, for a workspace or the owner context, on a page of its own: one page holds the
 * list, as the list on two pages would push the first load past its budget.
 */
function Changes() {
  const { workspace: id } = Route.useSearch();
  const workspaces = loggedIn.useLoaderData();
  const name =
    workspaces.kind === "loaded"
      ? workspaces.data.workspaces.find((workspace) => workspace.id === id)?.name
      : undefined;

  return (
    <Page>
      <PageTitle
        above={
          id === undefined ? (
            <Link to="/" className={BACK}>
              Workspaces
            </Link>
          ) : (
            <Link to="/workspaces/$workspaceId" params={{ workspaceId: id }} className={BACK}>
              {name ?? id}
            </Link>
          )
        }
      >
        Recent changes
      </PageTitle>
      <p className="mt-2 text-[15px]/[23px] text-muted-foreground">
        {id === undefined
          ? "What's changed in your owner context, newest first."
          : `What's changed in ${name ?? "this workspace"}'s context file, newest first.`}
      </p>
      <div className="mt-8">
        <RecentChanges about={id === undefined ? { kind: "owner" } : { kind: "workspace", id }} />
      </div>
    </Page>
  );
}
