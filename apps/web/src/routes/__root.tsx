import { AuthState, type OfflineCopy } from "@courtyard/contract";
import { createRootRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { StatusPill } from "@/components/layout/notice";
import { type FromWorker, fromWorker } from "../api/worker.ts";
import { useWorkerWatch } from "../api/worker-watch.ts";
import { Problem } from "../components/layout/problems.tsx";
import { keepsCopy, wipeCopyHere } from "../features/offline-copy/switch.ts";

/** Whether this device is in, and the copy it reads while the worker can't be reached (#106). */
type Context = { auth: FromWorker<AuthState>; reading: OfflineCopy | undefined };

/** Logged in, as a device reading its copy takes itself to be: it can't ask (#106). */
const READING: FromWorker<AuthState> = { kind: "loaded", data: { state: "logged-in" } };

/**
 * The last answer that the device is in and the worker there, which a move to another page goes on
 * at once rather than asking again first (#808); undefined until there's one, and again once
 * asking behind it hears otherwise.
 */
let lastIn: Context | undefined;
/** What the page does once asking behind a move hears the device isn't in, or can't reach the worker. */
let whenNoLongerIn: (() => void) | undefined;

/** Asks again behind a move made on the last answer; hearing otherwise, the page asks before going on. */
const askBehind = async () => {
  const auth = await fromWorker("/auth", AuthState);
  if (auth.kind === "loaded" && auth.data.state === "logged-in") return;
  lastIn = undefined;
  whenNoLongerIn?.();
};

export const Route = createRootRoute({
  // Before every page: send the device to setup or login when it isn't in, and away from them
  // once it is (ADR 0002). Throwing `redirect` is how TanStack Router changes page here. A device
  // that can't reach the worker reads its copy, if it keeps one (#106); one that hears it isn't
  // logged in (here, or from another device) wipes it. Moving between its pages once in, it goes
  // on at once and asks behind (#808), so a move never waits on the worker first.
  beforeLoad: async ({ location, cause }): Promise<Context> => {
    const path = location.pathname;
    if (cause !== "enter" && lastIn !== undefined && path !== "/setup" && path !== "/login") {
      void askBehind();
      return lastIn;
    }
    lastIn = undefined;
    const auth = await fromWorker("/auth", AuthState);
    if (auth.kind === "offline" && keepsCopy()) {
      const copy = await import("../features/offline-copy/store.ts").then((store) =>
        store.readCopy(),
      );
      if (copy !== undefined) return { auth: READING, reading: copy };
    }
    if (auth.kind !== "loaded") return { auth, reading: undefined };

    if (auth.data.state !== "logged-in" && keepsCopy()) await wipeCopyHere();
    switch (auth.data.state) {
      case "setup-needed":
        if (path !== "/setup") throw redirect({ to: "/setup" });
        break;
      case "logged-out":
        if (path !== "/login") throw redirect({ to: "/login" });
        break;
      case "logged-in":
        if (path === "/setup" || path === "/login") throw redirect({ to: "/" });
        lastIn = { auth, reading: undefined };
        return lastIn;
    }
    return { auth, reading: undefined };
  },
  component: Root,
});

/** How often an open page checks that the worker is still there. */
const WATCH_EVERY_MS = 5000;

function Root() {
  const { auth, reading } = Route.useRouteContext();
  const router = useRouter();
  // Pages already open keep watching the worker, so one that goes away is noticed straight away
  // rather than on the next click, and the page refreshes its data when it's back, and when the
  // tab is shown again, as every block does (#387). A device reading its copy knows the worker
  // didn't answer, so the first answer is it coming back, and the pages load from it again.
  const reachability = useWorkerWatch({
    watching: auth.kind === "loaded",
    everyMs: WATCH_EVERY_MS,
    onBack: () => void router.invalidate(),
    fromDown: reading !== undefined,
  });
  // Asking behind a move hears the device isn't in (logged out elsewhere) or can't reach the
  // worker: the page asks again, before going on, and goes where that answer says.
  useEffect(() => {
    whenNoLongerIn = () => void router.invalidate();
    return () => {
      whenNoLongerIn = undefined;
    };
  }, [router]);
  // A worker gone away: the next move asks first, so it reads the copy if the device keeps one.
  useEffect(() => {
    if (reachability === "down") lastIn = undefined;
  }, [reachability]);

  return (
    <div className="min-h-dvh">
      {/* Reading a copy, every page's foot says so itself. */}
      {reachability === "down" && auth.kind === "loaded" && reading === undefined && (
        <div className="flex justify-center px-4 pt-3">
          <StatusPill>Can't reach Courtyard's worker. Retrying…</StatusPill>
        </div>
      )}
      {auth.kind === "loaded" ? <Outlet /> : <Problem result={auth} />}
    </div>
  );
}
