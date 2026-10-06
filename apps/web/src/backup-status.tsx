import type { ContextBackup } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { InfoBox, Notice } from "@/components/notice";
import { describeWhen } from "./when.ts";
import { loadBackup } from "./worker.ts";

/**
 * Whether the context folder's backup has every change (ADR 0014), on the home page. Asked for
 * once the page is showing, since the worker may be partway through a push: the page never waits
 * for the backup. Nothing at all while it's up to date, or when the worker couldn't say.
 */
export function BackupStatus() {
  const [backup, setBackup] = useState<ContextBackup>();
  useEffect(() => {
    let current = true;
    void loadBackup().then((result) => {
      if (current && result.kind === "loaded") setBackup(result.data);
    });
    return () => {
      current = false;
    };
  }, []);

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
