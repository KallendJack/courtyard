import { WorkspaceId } from "@courtyard/contract";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { BackLink } from "@/components/back-link";
import { Page, PageTitle } from "@/components/page";
import { TidyReview } from "../../tidy/tidy-review.tsx";

export const Route = createFileRoute("/_app/tidy")({
  // Whose file: a workspace's, named in the address, or the owner context without one.
  validateSearch: (search: Record<string, unknown>) => {
    const workspace = WorkspaceId.safeParse(search.workspace);
    return workspace.success ? { workspace: workspace.data } : {};
  },
  component: Tidy,
});

const loggedIn = getRouteApi("/_app");

/** Tidy a workspace's context file or the owner context, on a page of its own like Recent changes. */
function Tidy() {
  const { workspace: id } = Route.useSearch();
  const workspaces = loggedIn.useLoaderData();
  const name =
    workspaces.kind === "loaded"
      ? workspaces.data.workspaces.find((workspace) => workspace.id === id)?.name
      : undefined;

  return (
    <Page>
      <PageTitle above={<BackLink workspaceId={id} />}>
        {id === undefined
          ? "Tidy your owner context"
          : `Tidy ${name ?? "this workspace"}'s context`}
      </PageTitle>
      <div className="mt-4">
        {/* A key per place, so going from one file to another starts afresh. */}
        <TidyReview
          key={id ?? "owner"}
          workspace={id}
          name={id === undefined ? "your owner context" : `${name ?? "this workspace"}'s context`}
        />
      </div>
    </Page>
  );
}
