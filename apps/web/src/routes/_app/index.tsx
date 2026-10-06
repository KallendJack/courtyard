import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/notice";
import { LIST_ROW, Page, PageTitle } from "@/components/page";
import { WorkspaceDot } from "@/components/workspace-colour";
import { classes } from "@/lib/classes";
import { BackupStatus } from "../../backup-status.tsx";
import { LiveUpdate } from "../../live-update.tsx";
import { LogOutOthers } from "../../log-out-others.tsx";
import { OwnerContextPanel } from "../../owner-context-panel.tsx";
import { loadBackup, loadLive, loadOwnerContext } from "../../worker.ts";

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/")({
  loader: async () => {
    const [ownerContext, live, backup] = await Promise.all([
      loadOwnerContext(),
      loadLive(),
      loadBackup(),
    ]);
    return { ownerContext, live, backup };
  },
  component: Home,
});

function Home() {
  const workspaces = loggedIn.useLoaderData();
  const { ownerContext, live, backup } = Route.useLoaderData();
  if (workspaces.kind !== "loaded") return null;
  const list = workspaces.data.workspaces;

  return (
    <Page>
      <PageTitle>Workspaces</PageTitle>
      <LiveUpdate result={live} />
      <BackupStatus result={backup} />
      <OwnerContextPanel result={ownerContext} />
      {list.length === 0 ? (
        <EmptyState>
          No workspaces yet.{" "}
          <Link to="/new-workspace" className="text-foreground underline">
            Add your first
          </Link>{" "}
          for one area of your life.
        </EmptyState>
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
                  <WorkspaceDot colour={workspace.colour} />
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
          <li>
            <Link to="/new-workspace" className={classes(LIST_ROW, "text-muted-foreground")}>
              <span className="flex items-center gap-3">
                {/* As wide as a dot, so the names line up. */}
                <Plus className="-mx-[3px] size-4 shrink-0" aria-hidden />
                New workspace
              </span>
            </Link>
          </li>
        </ul>
      )}
      <LogOutOthers />
    </Page>
  );
}
