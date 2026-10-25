import { createFileRoute } from "@tanstack/react-router";
import { yourTools } from "@/api/fabrication";
import { Problem } from "@/components/problem";
import { ToolsPage } from "@/features/tools/tools-page";

/** Where Your tools goes back to: a Build's page in Fabrication, never anywhere else. */
const backTo = (back: unknown) =>
  typeof back === "string" && /^\/workspaces\/[^/]+\/builds\/[^/]+$/.test(back) ? back : undefined;

export const Route = createFileRoute("/tools")({
  validateSearch: (search: Record<string, unknown>): { back?: string } => {
    const back = backTo(search.back);
    return back === undefined ? {} : { back };
  },
  loader: () => yourTools(),
  component: ToolsRoute,
});

function ToolsRoute() {
  const tools = Route.useLoaderData();
  const { back } = Route.useSearch();
  switch (tools.kind) {
    case "loaded":
      return <ToolsPage tools={tools.data} back={back} />;
    case "failed":
      return <Problem>{tools.message}</Problem>;
    default:
      return <Problem>Can't reach Courtyard's worker. Try again shortly.</Problem>;
  }
}
