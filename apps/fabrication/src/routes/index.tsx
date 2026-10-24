import { createFileRoute } from "@tanstack/react-router";
import { Problem } from "@/components/problem";

// A Build opens from its project's step in Courtyard (#698), so Fabrication on its own has
// nothing to show yet.
export const Route = createFileRoute("/")({
  component: () => <Problem>Open a Build from its project in Courtyard.</Problem>,
});
