import { WorkspaceList } from "@courtyard/contract";
import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  type Dock,
  DockContext,
  type MessageBox,
  type TalkTarget,
  useLayout,
} from "@/components/handheld";
import { Problem } from "../problems.tsx";
import { fromWorker, logOut as logOutOnWorker } from "../worker.ts";

/** The Handheld frame (#193), on every screen (#197), loaded after the page so it stays off the first load. */
const HandheldFrame = lazy(() => import("@/components/handheld-frame"));

/**
 * Until the frame is there, the room it will take (#271), so the page doesn't jump when it
 * arrives: on a tablet its rails' widths, either side of the page, as the frame's own are; on a
 * phone the height of its tiles across the top. The frame then keeps clear of them as it measures them.
 */
const RAILS =
  "pl-[calc(--spacing(28)+env(safe-area-inset-left))] pr-[calc(--spacing(37.5)+env(safe-area-inset-right))]";
const TILES = <div aria-hidden className="h-20 shrink-0" />;
/** The cover screen's bottom bar's room, until the frame has measured it (#283). */
const BAR = "pb-[calc(--spacing(37)+env(safe-area-inset-bottom))]";

/**
 * Every page behind the owner's login, in the Handheld frame on every screen (#197): thumb rails
 * from 600 px wide (a tablet, the unfolded Fold, a computer), tiles across the top and a bottom bar
 * below that (a phone, the folded Fold, a narrow window). Either way the page itself sits on a raised panel, in the same place, so folding
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
  /** What the page listens for while the owner steers it by voice (step by step, #241). */
  const [commands, setCommands] = useState<TalkTarget>();
  const offerCommands = useCallback((offered: TalkTarget) => {
    setCommands(offered);
    return () => setCommands((now) => (now === offered ? undefined : now));
  }, []);
  const open = useCallback(() => setBoxOpen(true), []);
  const close = useCallback(() => setBoxOpen(false), []);
  /** The frame's Talk, for the box's mic: set by the Talk key or strip once the frame is there. */
  const talker = useRef<() => void>(undefined);
  const talk = useCallback(() => talker.current?.(), []);
  const dock = useMemo<Dock | undefined>(
    () =>
      dockElement === null
        ? undefined
        : { element: dockElement, offer, offerField, offerCommands, open, close, talk },
    [dockElement, offer, offerField, offerCommands, open, close, talk],
  );

  return (
    <DockContext value={dock}>
      <div className="flex h-dvh">
        <div
          data-frame-column=""
          className={`flex min-w-0 flex-1 flex-col ${layout === "tablet" ? RAILS : BAR}`}
        >
          <Suspense fallback={layout === "cover" && TILES}>
            <HandheldFrame
              layout={layout}
              workspaces={list}
              onLogOut={logOut}
              dockRef={setDockElement}
              box={box}
              field={field}
              commands={commands}
              boxOpen={boxOpen}
              setBoxOpen={setBoxOpen}
              talker={talker}
            />
          </Suspense>
          {/* The page fills this panel and scrolls its own middle, never the window (#266, #339). */}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-t-lg border border-b-0 bg-card pb-[env(safe-area-inset-bottom)] md:mt-3 md:mr-3 md:mb-[calc(--spacing(3)+env(safe-area-inset-bottom))] md:rounded-lg md:border-b md:pb-0">
            {workspaces.kind === "loaded" ? <Outlet /> : <Problem result={workspaces} />}
          </div>
        </div>
      </div>
    </DockContext>
  );
}
