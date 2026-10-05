import { AuthState } from "@courtyard/contract";
import { createRootRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { Problem } from "../problems.tsx";
import { fromWorker } from "../worker.ts";
import { useWorkerWatch } from "../worker-watch.ts";

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

/** How often an open page checks that the worker is still there. */
const WATCH_EVERY_MS = 5000;

function Root() {
  const { auth } = Route.useRouteContext();
  const router = useRouter();
  // Pages already open keep watching the worker, so one that goes away is noticed straight away
  // rather than on the next click, and the page refreshes its data when it's back.
  const reachability = useWorkerWatch({
    watching: auth.kind === "loaded",
    everyMs: WATCH_EVERY_MS,
    onBack: () => void router.invalidate(),
  });

  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      {reachability === "down" && auth.kind === "loaded" && (
        <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          Can't reach Courtyard's worker. Retrying…
        </p>
      )}
      {auth.kind === "loaded" ? <Outlet /> : <Problem result={auth} />}
    </div>
  );
}
