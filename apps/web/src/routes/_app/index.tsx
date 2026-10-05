import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/notice";
import { LIST_ROW, Page, PageTitle } from "@/components/page";
import { useWorkspaceColours, WorkspaceDot } from "@/components/workspace-colour";
import { LogOutOthers } from "../../log-out-others.tsx";

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/")({
  component: Home,
});

function Home() {
  const workspaces = loggedIn.useLoaderData();
  const colourOf = useWorkspaceColours();
  if (workspaces.kind !== "loaded") return null;
  const list = workspaces.data.workspaces;

  return (
    <Page>
      <PageTitle>Workspaces</PageTitle>
      {list.length === 0 ? (
        <EmptyState>No workspaces yet. Add a folder to your context folder to make one.</EmptyState>
      ) : (
        <ul className="mt-6 divide-y">
          {list.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId: workspace.id }}
                className={LIST_ROW}
              >
                <span className="flex items-center gap-3 font-medium">
                  <WorkspaceDot colour={colourOf(workspace.id)} />
                  {workspace.name}
                </span>
                <span className="flex gap-2 text-xs text-muted-foreground">
                  {workspace.mode === "code" && <span>Code</span>}
                  {!workspace.hasContextFile && <span>No context file yet</span>}
                  {workspace.configProblem !== undefined && (
                    <span className="text-destructive-text">Config ignored</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <LogOutOthers />
    </Page>
  );
}
