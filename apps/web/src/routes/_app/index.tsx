import type { SessionId, WorkspaceSummary } from "@courtyard/contract";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useLayout } from "@/components/frame/handheld";
import { PlaceholderRows } from "@/components/layout/kept";
import { EmptyState } from "@/components/layout/notice";
import { Page, PageTitle } from "@/components/layout/page";
import { WorkspaceIcon } from "@/components/workspace/workspace-icon";
import { classes } from "@/lib/classes";

// Loaded once the page shows, so the page never waits for them and they stay off the first load:
// each tile's line, and the foot rows.
const TileLine = lazy(() => import("../../features/home/tile-line.tsx"));
const HomeFoot = lazy(() => import("../../features/home/foot.tsx"));
const HomeNeedsYou = lazy(() => import("../../features/home/needs-you.tsx"));

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/")({ component: Home });

/** A tile's size and shape: two across on the cover screen, three from a tablet up. */
const TILE =
  "relative flex h-29.5 flex-col rounded-tile p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-33 lg:h-37.5";

/**
 * A workspace's tile: its icon, its name, and its line, which loads after the page and keeps its
 * place until then. A tap opens the workspace, or the one session waiting on the owner there, as
 * its line names it (#345).
 */
function Tile(props: { workspace: WorkspaceSummary }) {
  const { workspace } = props;
  const [opens, setOpens] = useState<SessionId>();
  const className = classes(TILE, "justify-between bg-muted/60 hover:bg-muted");
  const inside = (
    <>
      <WorkspaceIcon icon={workspace.icon} size="home" />
      <span className="flex min-w-0 flex-col gap-0.75">
        <span className="truncate text-lg/5.5 font-bold">{workspace.name}</span>
        <span data-line="" className="h-4">
          <Suspense>
            <TileLine workspace={workspace} onOpens={setOpens} />
          </Suspense>
        </span>
      </span>
    </>
  );
  return (
    <li>
      {opens === undefined ? (
        <Link
          to="/workspaces/$workspaceId"
          params={{ workspaceId: workspace.id }}
          className={className}
        >
          {inside}
        </Link>
      ) : (
        <Link
          to="/workspaces/$workspaceId/sessions/$sessionId"
          params={{ workspaceId: workspace.id, sessionId: opens }}
          className={className}
        >
          {inside}
        </Link>
      )}
    </li>
  );
}

/**
 * Home (#102; Paper, "Home", desktop, tablet and cover screen): calm and touch-first. At its top,
 * Needs you: everything waiting on the owner in every workspace (#492). Then the workspaces, a big
 * tile each and New workspace; at its foot, near the thumbs and only
 * when needed, main's build with Update and one gold line for something wrong. Everything else
 * that was here (the owner context, sign-ins, Connections, Fresh start) is in Settings.
 */
function Home() {
  const workspaces = loggedIn.useLoaderData();
  const short = useLayout() === "cover";
  if (workspaces.kind !== "loaded") return null;
  const list = workspaces.data.workspaces;

  return (
    // Only the tiles scroll, under the title and above the foot rows (#339).
    <Page
      wide
      header={<PageTitle>Workspaces</PageTitle>}
      footer={
        <div data-home="">
          <div className="pt-4 pb-6 md:pb-8">
            {/* Its two rows' places, until it comes (#283). */}
            <Suspense
              fallback={
                <div className="flex flex-col gap-2.5 md:gap-3">
                  <PlaceholderRows count={1} size="bar" />
                  <PlaceholderRows count={1} size="foot" />
                </div>
              }
            >
              <HomeFoot workspaces={list} short={short} />
            </Suspense>
          </div>
        </div>
      }
    >
      <div data-home="" className="contents">
        {list.length === 0 ? (
          <EmptyState>
            No workspaces yet.{" "}
            <Link to="/new-workspace" className="text-foreground underline">
              Add your first
            </Link>{" "}
            for one area of your life.
          </EmptyState>
        ) : (
          // The space round them keeps a focused tile's ring in view.
          <div className="-mx-1 mt-3 flex flex-col gap-2.5 p-1 md:mt-4 md:gap-3">
            {/* What waits on the owner, everywhere, at the top (#492): its size is its slot's. */}
            <div className="h-51 shrink-0 md:h-47">
              <Suspense
                fallback={<span aria-hidden className="block h-full rounded-card bg-muted/50" />}
              >
                <HomeNeedsYou />
              </Suspense>
            </div>
            <ul
              aria-label="Workspaces"
              className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3"
            >
              {list.map((workspace) => (
                <Tile key={workspace.id} workspace={workspace} />
              ))}
              <li>
                <Link
                  to="/new-workspace"
                  className={classes(
                    TILE,
                    "items-center justify-center gap-2.5 border-stroke border-dashed border-input text-interface font-semibold text-foreground/85 hover:bg-muted/60",
                  )}
                >
                  <span className="flex size-10 items-center justify-center rounded-row bg-muted">
                    <Plus aria-hidden className="size-4.5" />
                  </span>
                  New workspace
                </Link>
              </li>
            </ul>
          </div>
        )}
      </div>
    </Page>
  );
}
