import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/")({
  component: Home,
});

function Home() {
  const workspaces = loggedIn.useLoaderData();
  if (workspaces.kind !== "loaded") return null;
  const list = workspaces.data.workspaces;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Workspaces</h1>
      {list.length === 0 ? (
        <p className="mt-4 text-neutral-600">
          No workspaces yet. Add a folder to your context folder to make one.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {list.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId: workspace.id }}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50"
              >
                <span className="font-medium">{workspace.name}</span>
                <span className="flex gap-2 text-xs text-neutral-500">
                  {workspace.mode === "code" && <span>Code</span>}
                  {!workspace.hasContextFile && <span>No context file yet</span>}
                  {workspace.configProblem !== undefined && (
                    <span className="text-amber-700">Config ignored</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
