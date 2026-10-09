import { WorkspaceId } from "@courtyard/contract";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Page, PageTitle } from "@/components/page";
import { Problem } from "../../problems.tsx";
import { ThingCard } from "../../things/thing-card.tsx";

export const Route = createFileRoute("/_app/workspaces/$workspaceId/things/$slug")({
  // The loader stays in the first load, so its schemas load with the page.
  loader: ({ params }) => import("../../things/api.ts").then((api) => api.loadThing(params)),
  component: ThingPage,
});

/** A Thing's card (ADR 0020), or why it can't be shown. */
function ThingPage() {
  const { thing, list } = Route.useLoaderData();
  const params = Route.useParams();
  const workspaceId = WorkspaceId.safeParse(params.workspaceId);
  if (thing.kind === "not-found" || !workspaceId.success) {
    return (
      <Page>
        <PageTitle>No such Thing</PageTitle>
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
  if (list.kind !== "loaded") return <Problem result={list} />;
  return (
    <Page>
      <ThingCard
        key={thing.data.thing.slug}
        workspaceId={workspaceId.data}
        list={list.data}
        {...thing.data}
      />
    </Page>
  );
}
