import { AuthState } from "@courtyard/contract";
import { createRootRoute, Outlet, redirect } from "@tanstack/react-router";
import { Problem } from "../problems.tsx";
import { fromWorker } from "../worker.ts";

export const Route = createRootRoute({
  // Before every page: send the device to setup or login when it isn't in, and away from them
  // once it is (ADR 0002). Throwing `redirect` is how TanStack Router changes page here.
  beforeLoad: async ({ location }) => {
    const auth = await fromWorker("/auth", AuthState);
    if (auth.kind !== "loaded") return { auth };

    const path = location.pathname;
    switch (auth.data.state) {
      case "setup-needed":
        if (path !== "/setup") throw redirect({ to: "/setup" });
        break;
      case "logged-out":
        if (path !== "/login") throw redirect({ to: "/login" });
        break;
      case "logged-in":
        if (path === "/setup" || path === "/login") throw redirect({ to: "/" });
        break;
    }
    return { auth };
  },
  component: Root,
});

function Root() {
  const { auth } = Route.useRouteContext();

  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      {auth.kind === "loaded" ? <Outlet /> : <Problem result={auth} />}
    </div>
  );
}
