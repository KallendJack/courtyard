import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { CARD } from "@courtyard/ui/layout/page.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Switch } from "@/components/forms/switch";
import { CapsLabel } from "@/components/layout/caps-label";
import { dayAndTimeWords } from "@/lib/when";
import { updateCopy } from "./api.ts";
import { useCopyAt, wipeCopy } from "./store.ts";
import { setKeepsCopy, useKeepsCopy } from "./switch.ts";

/**
 * Read offline, in Settings under Notifications (#106; Paper, "Cover · Settings: keep a copy
 * offline"): this device's own switch, off until the owner turns it on; once on, when the copy was
 * last updated, and Update now. Turning it off wipes the copy. Reading offline (`reading`), the
 * switch and Update now wait for the worker.
 */
export default function OfflineCopyCard(props: { reading?: boolean }) {
  const on = useKeepsCopy();
  const at = useCopyAt();
  const reading = props.reading === true;
  // Turned on, the app keeps it up to date from then on (KeepCopyFresh), starting at once.
  const turn = useAction(async (now: boolean) => {
    if (!now) await wipeCopy();
    setKeepsCopy(now);
    return undefined;
  });
  const update = useAction(updateCopy);

  return (
    <section aria-labelledby="read-offline" className={classes(CARD, "flex flex-col gap-3")}>
      <CapsLabel tone="muted" heading={{ id: "read-offline" }}>
        Read offline
      </CapsLabel>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.75">
          <span id="read-offline-here" className="font-extrabold">
            Keep a copy to read offline
          </span>
          <span id="read-offline-what" className="text-meta text-muted-foreground">
            Your context and each workspace's 5 latest conversations are stored on this device.
          </span>
        </div>
        <Switch
          on={on}
          onChange={(now) => void turn.run(now)}
          disabled={reading}
          busy={turn.busy}
          labelledBy="read-offline-here"
          describedBy="read-offline-what"
        />
      </div>
      {on && at !== undefined && (
        <>
          <div className="h-px shrink-0 bg-border" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.75">
              <span className="font-extrabold">Last updated {dayAndTimeWords(at)}</span>
              <span className="text-meta text-muted-foreground">
                Updates when Courtyard opens, then every 15 min
              </span>
            </div>
            {!reading && (
              <Button
                variant="outline"
                size="sm"
                busy={update.busy}
                busyLabel="Updating…"
                onClick={() => void update.run()}
              >
                Update now
              </Button>
            )}
          </div>
          <FormError message={update.error} />
        </>
      )}
      <div className="h-px shrink-0 bg-border" />
      <p className="text-meta text-muted-foreground">
        Logging out here wipes them. Logging out from another device wipes them only when this one
        next reaches Courtyard.
      </p>
    </section>
  );
}
