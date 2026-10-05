import { WorkspaceList } from "@courtyard/contract";
import { createFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { Problem } from "../problems.tsx";
import { fromWorker, toWorker } from "../worker.ts";

/** Every page behind the owner's login: the workspace switcher, then the page. */
export const Route = createFileRoute("/_app")({
  loader: () => fromWorker("/workspaces", WorkspaceList),
  component: LoggedIn,
});

function LoggedIn() {
  const workspaces = Route.useLoaderData();
  const router = useRouter();

  const logOut = async () => {
    await toWorker("/logout", {});
    await router.invalidate();
  };

  return (
    <>
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <Link to="/" className="shrink-0 font-semibold">
            Courtyard
          </Link>
          {workspaces.kind === "loaded" && (
            <nav aria-label="Workspaces" className="-mx-1 flex min-w-0 gap-1 overflow-x-auto">
              {workspaces.data.workspaces.map((workspace) => (
                <Link
                  key={workspace.id}
                  to="/workspaces/$workspaceId"
                  params={{ workspaceId: workspace.id }}
                  className="shrink-0 rounded-full px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
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
            className="ml-auto shrink-0 text-sm text-neutral-600 hover:text-neutral-900"
          >
            Log out
          </button>
        </div>
      </header>
      {workspaces.kind === "loaded" ? <Outlet /> : <Problem result={workspaces} />}
    </>
  );
}
