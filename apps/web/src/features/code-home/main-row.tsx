import type { WorkspaceId, WorkspaceMain } from "@courtyard/contract";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { CapsLabel } from "@/components/layout/caps-label";
import { LiveUpdate } from "../live/live-update.tsx";
import { MAIN_RUNNING_EVERY_MS, MainBuildCard, useLive } from "../live/main-build.tsx";
import { loadMain } from "./api.ts";

/** Each workspace's main as last known, for the tab's lifetime; `null` when there's none to show. */
const KEPT_MAIN = createKept<WorkspaceMain | null>();

/**
 * Main (#301; Paper, "Code workspace Home"): the newest commit on the repository's main with its
 * build as a row (#337), which opens every job, what matters after a merge. Update shows only on the workspace whose
 * repository Courtyard's live copy runs from, once main has moved on from it (its Updates card,
 * which follows the update); other repositories show the bar alone. With no build to show, a quiet
 * row in its place (#283), still asked for, so one that starts shows (#387). Asked again at once when `again`
 * changes (after a merge from Home).
 */
export function MainRow(props: { workspaceId: WorkspaceId; again?: unknown }) {
  // The last answer known shows at once (nothing jumps in late); `null`: nothing to show.
  const main = useKept(KEPT_MAIN, {
    key: props.workspaceId,
    load: async () => {
      const loaded = await loadMain(props.workspaceId);
      return loaded.kind === "offline" ? undefined : loaded.kind === "loaded" ? loaded.data : null;
    },
    again: props.again,
    busy: (known) => (known?.build?.kind === "running" ? MAIN_RUNNING_EVERY_MS : undefined),
  });

  // Nothing known yet: the row keeps its place, at its size (#283).
  if (main === undefined) return <PlaceholderRows count={1} size="bar" />;
  if (main === null) return <NoBuild />;
  if (main.liveCopy) return <LiveMain main={main} again={props.again} />;
  if (main.build === null) return <NoBuild />;
  return <MainBuildCard label="Main" newest={main.newest} build={main.build} />;
}

/** Main with no build to show keeps its row, at the bar's height, with one quiet line (#283). */
function NoBuild() {
  return (
    <section
      aria-label="Main"
      className="flex h-12.5 items-center gap-3.5 rounded-bubble border bg-surface pr-2.5 pl-3.5"
    >
      <CapsLabel tone="muted" inline className="shrink-0">
        Main
      </CapsLabel>
      <span className="truncate text-meta font-medium text-muted-foreground">No build yet</span>
    </section>
  );
}

/** The live copy's own repository: its Updates card while main has moved on, else the bar alone. */
function LiveMain(props: { main: WorkspaceMain; again: unknown }) {
  const [status] = useLive(true, props.again);
  const live = status?.kind === "loaded" ? status.data : undefined;
  if (live?.kind === "live" && (live.newerOnMain || live.lastUpdate?.outcome === "running")) {
    return <LiveUpdate label="Main" />;
  }
  const { main } = props;
  return main.build === null ? null : (
    <MainBuildCard label="Main" newest={main.newest} build={main.build} />
  );
}
