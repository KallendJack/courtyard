import { ALLOW_ALL_MOST_HOURS, type LeadStatus } from "@courtyard/contract";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { DialogCard } from "@/components/layout/dialog-card";
import { useAction } from "@/hooks/use-action";
import { clockWords } from "@/lib/when";

const HOUR_MS = 60 * 60 * 1000;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Allow all for builders, from the Lead's row (#551; Paper, "Lead row: Allow all sheet"): what
 * turning it on does, for whom, until when and what it allows at once, then Cancel or Turn on.
 * In the middle of the screen, or rising from the bottom on the Fold's cover screen.
 */
export function AllowAllBuilders(props: {
  open: boolean;
  onClose: () => void;
  reaches: LeadStatus["allowAllReaches"];
  /** Turns it on: what went wrong, or nothing once it's on, which closes the sheet. */
  onTurnOn: () => Promise<string | undefined>;
}) {
  const turnOn = useAction(async () => {
    const failed = await props.onTurnOn();
    if (failed === undefined) props.onClose();
    return failed;
  });
  const until = new Date(Date.now() + ALLOW_ALL_MOST_HOURS * HOUR_MS).toISOString();
  const { builders, approvals } = props.reaches;
  const facts = [
    { name: "Who", says: `${plural(builders, "builder", "builders")} now, and any it starts` },
    { name: "Until", says: `${clockWords(until)}, or as each one's PR opens` },
    ...(approvals === 0
      ? []
      : [
          {
            name: "Waiting now",
            says: `${plural(approvals, "approval", "approvals")}, allowed at once`,
          },
        ]),
  ];
  return (
    <DialogCard
      title="Allow all for builders"
      says={`The Lead's builders run commands and edit setup files without asking, for ${ALLOW_ALL_MOST_HOURS} hours.`}
      open={props.open}
      onClose={props.onClose}
      rises
      actions={
        <>
          <Button variant="outline" size="lg" waiting={turnOn.busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="needs"
            size="lg"
            grow
            busy={turnOn.busy}
            busyLabel="Turning on…"
            onClick={() => void turnOn.run()}
          >
            Turn on for {ALLOW_ALL_MOST_HOURS} hours
          </Button>
        </>
      }
    >
      <dl className="flex flex-col rounded-row bg-secondary px-4 py-1">
        {facts.map((fact) => (
          <div
            key={fact.name}
            className="flex justify-between gap-3 border-b border-border py-3 last:border-b-0"
          >
            <dt className="text-meta font-medium text-muted-foreground">{fact.name}</dt>
            <dd className="text-right text-sm/4.5 font-bold text-foreground">{fact.says}</dd>
          </div>
        ))}
      </dl>
      <p className="text-meta text-muted-foreground">
        Each still asks before: edits outside its branch, pushing anywhere else, force pushes,
        deleting branches, credentials and tool connections.
      </p>
      <FormError message={turnOn.error} />
    </DialogCard>
  );
}
