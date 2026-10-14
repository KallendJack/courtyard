import { WorkspaceList } from "@courtyard/contract";
import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  type Dock,
  DockContext,
  type MessageBox,
  type TalkTarget,
  useLayout,
} from "@/components/handheld";
import { WorkspaceStrip } from "@/components/workspace-strip";
import { Problem } from "../problems.tsx";
import { fromWorker, logOut as logOutOnWorker } from "../worker.ts";

/** The Handheld frame (#193), loaded only on a touch screen, so it stays off the first load. */
const HandheldFrame = lazy(() => import("@/components/handheld-frame"));

/**
 * Until the frame is there, the room it will take (#271), so the page doesn't jump when it
 * arrives: on a tablet its rails' widths, either side of the page, as the frame's own are; on a
 * phone the height of its tiles across the top. The frame then keeps clear of them as it measures them.
 */
const RAILS =
  "pl-[calc(--spacing(28)+env(safe-area-inset-left))] pr-[calc(--spacing(37.5)+env(safe-area-inset-right))]";
const TILES = <div aria-hidden className="h-20 shrink-0" />;

/**
 * Every page behind the owner's login. On a desktop the workspaces are a sidebar that collapses to
 * a rail, or a strip across the top of a narrow window. On a touch screen they're the Handheld
 * frame's: thumb rails and a bottom bar on a tablet or the unfolded Fold, tiles across the top on
 * the folded one. Either way the page itself sits on a raised panel, in the same place, so folding
 * and unfolding keeps it as it was. The page fills that panel and scrolls only its own middle,
 * never the window (#266, #339), so what's around it stays where it is.
 */
export const Route = createFileRoute("/_app")({
  loader: () => fromWorker("/workspaces", WorkspaceList),
  component: LoggedIn,
});

function LoggedIn() {
  const workspaces = Route.useLoaderData();
  const router = useRouter();
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];
  const layout = useLayout();
  /** Where the frame shows the page's message box, and the box itself, once each is there. */
  const [dockElement, setDockElement] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<MessageBox>();
  const [boxOpen, setBoxOpen] = useState(false);

  const logOut = async () => {
    await logOutOnWorker();
    // Go to login explicitly rather than waiting for a re-check to redirect, which another load
    // already in flight can swallow.
    await router.navigate({ to: "/login" });
  };

  const offer = useCallback((offered: MessageBox) => {
    setBox(offered);
    return () => setBox((now) => (now === offered ? undefined : now));
  }, []);
  /** A page's field to talk into, on a page without a message box (#264). */
  const [field, setField] = useState<TalkTarget>();
  const offerField = useCallback((offered: TalkTarget) => {
    setField(offered);
    return () => setField((now) => (now === offered ? undefined : now));
  }, []);
  const open = useCallback(() => setBoxOpen(true), []);
  const close = useCallback(() => setBoxOpen(false), []);
  const dock = useMemo<Dock | undefined>(
    () =>
      layout === "desktop" || dockElement === null
        ? undefined
        : { element: dockElement, offer, offerField, open, close },
    [layout, dockElement, offer, offerField, open, close],
  );

  return (
    <DockContext value={dock}>
      <div className="flex h-dvh">
        {layout === "desktop" && <AppSidebar workspaces={list} onLogOut={logOut} />}
        <div
          data-frame-column=""
          className={`flex min-w-0 flex-1 flex-col ${layout === "tablet" ? RAILS : ""}`}
        >
          {layout === "desktop" ? (
            <WorkspaceStrip workspaces={list} onLogOut={logOut} />
          ) : (
            <Suspense fallback={layout === "cover" && TILES}>
              <HandheldFrame
                layout={layout}
                workspaces={list}
                onLogOut={logOut}
                dockRef={setDockElement}
                box={box}
                field={field}
                boxOpen={boxOpen}
                setBoxOpen={setBoxOpen}
              />
            </Suspense>
          )}
          {/* The page fills this panel and scrolls its own middle, never the window (#266, #339). */}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-t-lg border border-b-0 bg-card pb-[env(safe-area-inset-bottom)] md:mt-3 md:mr-3 md:mb-[calc(--spacing(3)+env(safe-area-inset-bottom))] md:rounded-lg md:border-b md:pb-0">
            {workspaces.kind === "loaded" ? <Outlet /> : <Problem result={workspaces} />}
          </div>
        </div>
      </div>
    </DockContext>
  );
}
