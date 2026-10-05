import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { Page, PageTitle } from "@/components/page";
import { WorkspaceDot, workspaceColours } from "@/components/workspace-colour";
import { LogOutOthers } from "../../log-out-others.tsx";

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/")({
  component: Home,
});

function Home() {
  const workspaces = loggedIn.useLoaderData();
  if (workspaces.kind !== "loaded") return null;
  const list = workspaces.data.workspaces;
  const colours = workspaceColours(list);

  return (
    <Page>
      <PageTitle>Workspaces</PageTitle>
      {list.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          No workspaces yet. Add a folder to your context folder to make one.
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {list.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId: workspace.id }}
                className="-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3.5 hover:bg-muted/60"
              >
                <span className="flex items-center gap-3 font-medium">
                  <WorkspaceDot colour={colours.get(workspace.id) ?? "heather"} />
                  {workspace.name}
                </span>
                <span className="flex gap-2 text-[13px] text-muted-foreground">
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
