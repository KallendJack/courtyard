import type { ContextBackup } from "@courtyard/contract";
import { createKept, useKept } from "@/components/kept";
import { InfoBox, Notice } from "@/components/notice";
import { loadBackup } from "../../api/worker-calls.ts";
import { describeWhen } from "../../lib/when.ts";

/** The context backup as last known, for the tab's lifetime: Home's foot rows and Settings. */
const KEPT_BACKUP = createKept<ContextBackup>();

/**
 * The context backup as last known (nothing jumps in), asked for again whenever a page showing it
 * opens, since the worker may be partway through a push: the page never waits for the backup.
 */
export const useBackup = () =>
  useKept(KEPT_BACKUP, {
    key: "backup",
    load: async () => {
      const loaded = await loadBackup();
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
  });

/**
 * Whether the context folder's backup has every change (ADR 0014), in Settings (#102). Nothing at
 * all while it's up to date, or when the worker couldn't say.
 */
export function BackupStatus() {
  const backup = useBackup();

  if (backup === undefined) return null;
  switch (backup.kind) {
    case "up-to-date":
      return null;
    case "not-set-up":
      return (
        <InfoBox label="Backup">
          <span>
            Context not backed up. Set <code>COURTYARD_CONTEXT_REMOTE</code> in the worker's
            settings to back it up.
          </span>
        </InfoBox>
      );
    case "behind":
      return (
        <InfoBox label="Backup">
          <span>
            Context backup behind since {describeWhen(backup.since)}: {backup.reason}. Courtyard
            tries again every ten minutes.
          </span>
        </InfoBox>
      );
    case "not-kept":
      return (
        <div className="mt-4">
          <Notice title="Context changes aren't being kept">
            Changes are made, but git can't keep them, so they can't be undone or backed up:{" "}
            {backup.reason}
          </Notice>
        </div>
      );
  }
}
