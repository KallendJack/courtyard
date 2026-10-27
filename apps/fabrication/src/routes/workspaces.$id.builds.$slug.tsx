import { BuildSlug, WorkspaceId } from "@courtyard/contract";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildSizes, openBuild, yourTools } from "@/api/fabrication";
import { Problem } from "@/components/problem";
import { BuildPage } from "@/features/builds/build-page";
import { askedTools, toolsAsked } from "@/features/tools/tools-page";

export const Route = createFileRoute("/workspaces/$id/builds/$slug")({
  loader: async ({ params }) => {
    const workspaceId = WorkspaceId.safeParse(params.id);
    const slug = BuildSlug.safeParse(params.slug);
    if (!workspaceId.success || !slug.success) {
      return { build: { kind: "not-found" } as const, sizes: { spaces: [] } };
    }
    const [build, tools, sizes] = await Promise.all([
      openBuild(workspaceId.data, slug.data),
      toolsAsked() ? undefined : yourTools(),
      buildSizes(workspaceId.data, slug.data),
    ]);
    // Your tools comes first, until the owner has saved some or skipped it on this visit (#707).
    if (tools?.kind === "loaded" && tools.data.saved) askedTools();
    else if (build.kind === "loaded" && tools?.kind === "loaded") {
      throw redirect({
        to: "/tools",
        search: { back: `/workspaces/${params.id}/builds/${params.slug}` },
      });
    }
    // The sizes its steps need (#709); none shown when they can't be read.
    return { build, sizes: sizes.kind === "loaded" ? sizes.data : { spaces: [] } };
  },
  component: BuildRoute,
});

function BuildRoute() {
  const { build: opened, sizes } = Route.useLoaderData();
  switch (opened.kind) {
    case "loaded":
      return <BuildPage build={opened.data} sizes={sizes} />;
    case "not-found":
      return <Problem>There's no Build here. It may have been undone.</Problem>;
    case "failed":
      return <Problem>{opened.message}</Problem>;
    default:
      return <Problem>Can't reach Courtyard's worker. Try again shortly.</Problem>;
  }
}
