import { WorkspaceList } from "@courtyard/contract";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Problem } from "../problems.tsx";
import { fromWorker } from "../worker.ts";

export const Route = createRootRoute({
  loader: () => fromWorker("/workspaces", WorkspaceList),
  component: Root,
});

function Root() {
  const workspaces = Route.useLoaderData();

  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <Link to="/" className="shrink-0 font-semibold">
            Courtyard
          </Link>
          {workspaces.kind === "loaded" && (
            <nav aria-label="Workspaces" className="-mx-1 flex gap-1 overflow-x-auto">
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
        </div>
      </header>
      {workspaces.kind === "loaded" ? <Outlet /> : <Problem result={workspaces} />}
    </div>
  );
}
