import { WorkspaceList } from "@courtyard/contract";
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { Problem } from "../problems.tsx";
import { fromWorker, logOut as logOutOnWorker } from "../worker.ts";

/**
 * Every page behind the owner's login: the workspace switcher, then the page. One column on a
 * narrow screen (a folded phone), with the workspaces across the top; two panes from tablet width
 * up (an unfolded phone, a desktop), with the workspaces down the side.
 */
export const Route = createFileRoute("/_app")({
  loader: () => fromWorker("/workspaces", WorkspaceList),
  component: LoggedIn,
});

function LoggedIn() {
  const workspaces = Route.useLoaderData();
  const router = useRouter();

  const logOut = async () => {
    await logOutOnWorker();
    // Go to login explicitly rather than waiting for a re-check to redirect, which another load
    // already in flight can swallow.
    await router.navigate({ to: "/login" });
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <header className="border-b border-neutral-200 md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <div className="flex items-center gap-4 px-4 py-3 md:h-full md:flex-col md:items-stretch md:gap-3 md:py-4">
          <Link to="/" className="shrink-0 font-semibold">
            Courtyard
          </Link>
          {workspaces.kind === "loaded" && (
            <nav
              aria-label="Workspaces"
              className="-mx-1 flex min-w-0 gap-1 overflow-x-auto md:mx-0 md:flex-1 md:flex-col md:overflow-y-auto"
            >
              {workspaces.data.workspaces.map((workspace) => (
                <Link
                  key={workspace.id}
                  to="/workspaces/$workspaceId"
                  params={{ workspaceId: workspace.id }}
                  className="shrink-0 rounded-full px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 md:rounded-md md:py-1.5"
                  activeProps={{ className: "bg-neutral-900 text-white hover:bg-neutral-900" }}
                >
                  {workspace.name}
                </Link>
              ))}
            </nav>
          )}
          <button
            type="button"
            onClick={logOut}
            className="ml-auto shrink-0 text-sm text-neutral-600 hover:text-neutral-900 md:ml-0 md:text-left"
          >
            Log out
          </button>
        </div>
      </header>
      <div className="min-w-0">
        {workspaces.kind === "loaded" ? <Outlet /> : <Problem result={workspaces} />}
      </div>
    </div>
  );
}
