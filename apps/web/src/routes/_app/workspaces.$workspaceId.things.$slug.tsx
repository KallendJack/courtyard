import { WorkspaceId } from "@courtyard/contract";
import { Page, PageTitle } from "@courtyard/ui/layout/page.tsx";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Problem } from "../../components/layout/problems.tsx";
import { FindReplacement } from "../../features/things/find-replacement.tsx";
import { ThingCard } from "../../features/things/thing-card.tsx";

export const Route = createFileRoute("/_app/workspaces/$workspaceId/things/$slug")({
  // `replace`: its Find a replacement (#602), filled in for the owner to tap through.
  validateSearch: (search: Record<string, unknown>): { replace?: true } =>
    search.replace === true || search.replace === "true" ? { replace: true } : {},
  loaderDeps: ({ search }) => ({ replace: search.replace === true }),
  // The loader stays in the first load, so its schemas load with the page.
  loader: ({ params, deps }) =>
    Promise.all([
      import("../../features/things/api.ts").then((api) => api.loadThing(params)),
      deps.replace
        ? import("../../api/worker-calls.ts").then((calls) => calls.loadProviders())
        : undefined,
    ]).then(([thing, providers]) => ({ ...thing, providers })),
  component: ThingPage,
});

/** A Thing's card (ADR 0020), or its Find a replacement (#602), or why it can't be shown. */
function ThingPage() {
  const { thing, list, providers } = Route.useLoaderData();
  const params = Route.useParams();
  const { replace } = Route.useSearch();
  const workspaceId = WorkspaceId.safeParse(params.workspaceId);
  if (thing.kind === "not-found" || !workspaceId.success) {
    return (
      <Page header={<PageTitle>No such Thing</PageTitle>}>
        <p className="mt-3 text-muted-foreground">
          It may have been deleted.{" "}
          {workspaceId.success && (
            <Link
              to="/workspaces/$workspaceId"
              params={{ workspaceId: workspaceId.data }}
              className="text-foreground underline"
            >
              Back to its workspace
            </Link>
          )}
        </p>
      </Page>
    );
  }
  if (thing.kind !== "loaded") return <Problem result={thing} />;
  if (replace) {
    if (providers !== undefined && providers.kind !== "loaded") {
      return <Problem result={providers} />;
    }
    return (
      <FindReplacement
        key={thing.data.thing.slug}
        workspaceId={workspaceId.data}
        thing={thing.data.thing}
        providers={providers?.data.providers}
      />
    );
  }
  if (list.kind !== "loaded") return <Problem result={list} />;
  return (
    <ThingCard
      key={thing.data.thing.slug}
      workspaceId={workspaceId.data}
      list={list.data}
      {...thing.data}
    />
  );
}
