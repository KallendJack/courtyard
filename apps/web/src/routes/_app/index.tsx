import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { lazy, Suspense } from "react";
import { EmptyState } from "@/components/notice";
import { LIST_ROW, Page, PageTitle } from "@/components/page";
import { WorkspaceDot } from "@/components/workspace-colour";
import { classes } from "@/lib/classes";
import { BackupStatus } from "../../backup-status.tsx";
import { LiveUpdate } from "../../live-update.tsx";
import { LogOutOthers } from "../../log-out-others.tsx";
import { OwnerContextPanel } from "../../owner-context-panel.tsx";
import { loadOwnerContext } from "../../worker.ts";

// Loaded once the page shows: the page never waits for it, and it stays off the first load.
const SignIns = lazy(() => import("../../sign-ins/sign-ins.tsx"));

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/")({
  loader: async () => ({ ownerContext: await loadOwnerContext() }),
  component: Home,
});

function Home() {
  const workspaces = loggedIn.useLoaderData();
  const { ownerContext } = Route.useLoaderData();
  if (workspaces.kind !== "loaded") return null;
  const list = workspaces.data.workspaces;

  return (
    <Page>
      <PageTitle>Workspaces</PageTitle>
      <LiveUpdate />
      <BackupStatus />
      <Suspense fallback={null}>
        <SignIns part="boxes" />
      </Suspense>
      <OwnerContextPanel
        result={ownerContext}
        canGetToKnow={list.some((workspace) => workspace.mode === "planning")}
      />
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
      <Suspense fallback={null}>
        <SignIns part="list" />
      </Suspense>
      <div className="mt-7 flex justify-end">
        <Link
          to="/fresh-start"
          className="text-xs font-medium text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
        >
          Fresh start…
        </Link>
      </div>
      <LogOutOthers />
    </Page>
  );
}
