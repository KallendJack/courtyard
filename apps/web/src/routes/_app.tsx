import { WorkspaceList } from "@courtyard/contract";
import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { WorkspaceStrip } from "@/components/workspace-strip";
import { Problem } from "../problems.tsx";
import { fromWorker, logOut as logOutOnWorker } from "../worker.ts";

/**
 * Every page behind the owner's login. On a narrow screen (a folded phone) the workspaces run
 * across the top; from tablet width up (an unfolded phone, a desktop) they're a sidebar that
 * collapses to a rail. The page itself sits on a raised panel.
 */
export const Route = createFileRoute("/_app")({
  loader: () => fromWorker("/workspaces", WorkspaceList),
  component: LoggedIn,
});

function LoggedIn() {
  const workspaces = Route.useLoaderData();
  const router = useRouter();
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];

  const logOut = async () => {
    await logOutOnWorker();
    // Go to login explicitly rather than waiting for a re-check to redirect, which another load
    // already in flight can swallow.
    await router.navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-dvh">
      <AppSidebar workspaces={list} onLogOut={logOut} />
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceStrip workspaces={list} onLogOut={logOut} />
        <div className="min-w-0 flex-1 rounded-t-lg border border-b-0 bg-card pb-[env(safe-area-inset-bottom)] md:mt-3 md:mr-3 md:mb-[calc(--spacing(3)+env(safe-area-inset-bottom))] md:rounded-lg md:border-b md:pb-0">
          {workspaces.kind === "loaded" ? <Outlet /> : <Problem result={workspaces} />}
        </div>
      </div>
    </div>
  );
}
