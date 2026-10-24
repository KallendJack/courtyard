import { createRootRoute, Outlet } from "@tanstack/react-router";
import { authState } from "@/api/fabrication";
import { Problem } from "@/components/problem";

export const Route = createRootRoute({
  // Behind Courtyard's login (ADR 0002), which is Courtyard's own page: a device that isn't in
  // goes there, and comes back from Courtyard once it is.
  beforeLoad: async () => {
    const auth = await authState();
    if (auth.kind === "loaded" && auth.data.state !== "logged-in") {
      window.location.assign("/login");
      return { reachable: false };
    }
    return { reachable: auth.kind === "loaded" };
  },
  component: Root,
});

function Root() {
  const { reachable } = Route.useRouteContext();
  return (
    <div className="h-dvh bg-background text-foreground">
      {reachable ? (
        <Outlet />
      ) : (
        <Problem>Can't reach Courtyard's worker. Try again shortly.</Problem>
      )}
    </div>
  );
}
