import { BuildSlug, WorkspaceId } from "@courtyard/contract";
import { createFileRoute } from "@tanstack/react-router";
import { openBuild } from "@/api/fabrication";
import { Problem } from "@/components/problem";
import { BuildPage } from "@/features/builds/build-page";

export const Route = createFileRoute("/workspaces/$id/builds/$slug")({
  loader: async ({ params }) => {
    const workspaceId = WorkspaceId.safeParse(params.id);
    const slug = BuildSlug.safeParse(params.slug);
    if (!workspaceId.success || !slug.success) return { kind: "not-found" } as const;
    return openBuild(workspaceId.data, slug.data);
  },
  component: BuildRoute,
});

function BuildRoute() {
  const opened = Route.useLoaderData();
  switch (opened.kind) {
    case "loaded":
      return <BuildPage build={opened.data} />;
    case "not-found":
      return <Problem>There's no Build here. It may have been undone.</Problem>;
    case "failed":
      return <Problem>{opened.message}</Problem>;
    default:
      return <Problem>Can't reach Courtyard's worker. Try again shortly.</Problem>;
  }
}
