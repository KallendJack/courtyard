import { ThingSlug, WorkspaceId } from "@courtyard/contract";
import { createFileRoute } from "@tanstack/react-router";
import { openSpace } from "@/api/fabrication";
import { Problem } from "@/components/problem";
import { SpacePage } from "@/features/sizes/space-page";

export const Route = createFileRoute("/workspaces/$id/spaces/$slug")({
  loader: async ({ params }) => {
    const workspaceId = WorkspaceId.safeParse(params.id);
    const slug = ThingSlug.safeParse(params.slug);
    if (!workspaceId.success || !slug.success) return { kind: "not-found" } as const;
    return openSpace(workspaceId.data, slug.data);
  },
  component: SpaceRoute,
});

function SpaceRoute() {
  const opened = Route.useLoaderData();
  switch (opened.kind) {
    case "loaded":
      return <SpacePage space={opened.data} />;
    case "not-found":
      return <Problem>There's no space here. It may have been renamed in Courtyard.</Problem>;
    case "failed":
      return <Problem>{opened.message}</Problem>;
    default:
      return <Problem>Can't reach Courtyard's worker. Try again shortly.</Problem>;
  }
}
