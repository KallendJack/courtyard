import type { WorkspaceId, WorkspaceMain } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { createKept, PlaceholderRows, useKept } from "@/components/kept";
import { LiveUpdate } from "../live/live-update.tsx";
import { MainBuildCard, useLive } from "../live/main-build.tsx";
import { loadMain } from "./api.ts";

/** Each workspace's main as last known, for the tab's lifetime; `null` when there's none to show. */
const KEPT_MAIN = createKept<WorkspaceMain | null>();

/** How often the row asks again while main's build runs (#337). */
const ASK_EVERY_MS = 10 * 1000;

/**
 * Main (#301; Paper, "Code workspace Home"): the newest commit on the repository's main with its
 * build as a row (#337), which opens every job, what matters after a merge. Update shows only on the workspace whose
 * repository Courtyard's live copy runs from, once main has moved on from it (its Updates card,
 * which follows the update); other repositories show the bar alone. Hidden while there's no build
 * to show.
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
  if (main === null) return null;
  if (main.liveCopy) return <LiveMain main={main} />;
  return main.build === null ? null : (
    <MainBuildCard label="Main" newest={main.newest} build={main.build} />
  );
}

/** The live copy's own repository: its Updates card while main has moved on, else the bar alone. */
function LiveMain(props: { main: WorkspaceMain }) {
  const [status] = useLive();
  const live = status?.kind === "loaded" ? status.data : undefined;
  if (live?.kind === "live" && (live.newerOnMain || live.lastUpdate?.outcome === "running")) {
    return <LiveUpdate label="Main" />;
  }
  const { main } = props;
  return main.build === null ? null : (
    <MainBuildCard label="Main" newest={main.newest} build={main.build} />
  );
}
