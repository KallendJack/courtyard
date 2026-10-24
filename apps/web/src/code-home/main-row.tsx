import type { WorkspaceId, WorkspaceMain } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { createKept, PlaceholderRows, useKept } from "@/components/kept";
import { LiveUpdate } from "../live/live-update.tsx";
import { MainBuildCard, useLive } from "../live/main-build.tsx";
import { loadMain } from "./api.ts";

/** Each workspace's main as last known, for the tab's lifetime; `null` when there's none to show. */
const KEPT_MAIN = createKept<WorkspaceMain | null>();

/** How often the row asks again while main's build runs. */
const ASK_EVERY_MS = 15 * 1000;

/**
 * Main (#301; Paper, "Code workspace Home"): the newest commit on the repository's main with
 * #249's build bar, what matters after a merge. Update shows only on the workspace whose
 * repository Courtyard's live copy runs from, once main has moved on from it (its Updates card,
 * which follows the update); other repositories show the bar alone. With no build to show it
 * keeps its place with one quiet line (#283).
 */
export function MainRow(props: { workspaceId: WorkspaceId }) {
  const [tick, setTick] = useState(0);
  // The last answer known shows at once (nothing jumps in late); `null`: nothing to show.
  const main = useKept(KEPT_MAIN, {
    key: props.workspaceId,
    load: async () => {
      const loaded = await loadMain(props.workspaceId);
      return loaded.kind === "offline" ? undefined : loaded.kind === "loaded" ? loaded.data : null;
    },
    again: tick,
  });
  const running = main?.build?.kind === "running";

  // Asked again every so often while its build runs.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((was) => was + 1), ASK_EVERY_MS);
    return () => clearInterval(timer);
  }, [running]);

  // Nothing known yet: the row keeps its place.
  if (main === undefined) return <PlaceholderRows count={1} />;
  if (main === null) return <NoBuild />;
  if (main.liveCopy) return <LiveMain main={main} />;
  return main.build === null ? (
    <NoBuild />
  ) : (
    <MainBuildCard label="Main" newest={main.newest} build={main.build} />
  );
}

/** The row with no build to show: it keeps its place with one quiet line (#283). */
function NoBuild() {
  return (
    <section
      aria-label="Main"
      className="flex min-h-14 items-center gap-3.5 rounded-bubble border bg-surface py-2.5 pr-2.5 pl-3.5"
    >
      <span className="shrink-0 text-label font-bold tracking-label text-muted-foreground uppercase">
        Main
      </span>
      <span className="truncate text-sm text-muted-foreground">No build on main yet</span>
    </section>
  );
}

/** The live copy's own repository: its Updates card while main has moved on, else the bar alone. */
function LiveMain(props: { main: WorkspaceMain }) {
  const [status] = useLive();
  const live = status?.kind === "loaded" ? status.data : undefined;
  if (live?.kind === "live" && (live.newerOnMain || live.lastUpdate?.outcome === "running")) {
    return <LiveUpdate />;
  }
  const { main } = props;
  return main.build === null ? (
    <NoBuild />
  ) : (
    <MainBuildCard label="Main" newest={main.newest} build={main.build} />
  );
}
