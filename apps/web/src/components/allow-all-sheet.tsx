import type { AllowAllLasts } from "@courtyard/contract";
import { Check } from "lucide-react";
import { useState } from "react";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { Button } from "./button.tsx";
import { DialogCard } from "./dialog-card.tsx";
import { FormError } from "./form-error.tsx";

/** The lengths to pick from, as the sheet says them, and what its button then says. */
const LENGTHS: readonly {
  readonly lasts: AllowAllLasts;
  readonly label: string;
  readonly note?: string;
  readonly allow: string;
}[] = [
  { lasts: "1h", label: "1 hour", allow: "Allow all for 1 hour" },
  { lasts: "4h", label: "4 hours", allow: "Allow all for 4 hours" },
  { lasts: "12h", label: "12 hours", allow: "Allow all for 12 hours" },
  {
    lasts: "task",
    label: "Until this task is done",
    note: "Ends when its PR opens, 12 hours at most",
    allow: "Allow all until it's done",
  },
];

/**
 * Allow all for this task: how long (#428; Paper, "Allow all for this task: how long"), from an
 * approval's "Allow all for this task…" line or the session's ⋯: 1 hour, 4 hours, 12 hours, or
 * until this task is done, picked by a tap, what still asks, then Cancel or Allow all, which says
 * exactly what it does. Loaded when it first opens.
 */
export default function AllowAllSheet(props: {
  open: boolean;
  onClose: () => void;
  /** Turns it on: what went wrong, or nothing once it's on, which closes the sheet. */
  onAllow: (lasts: AllowAllLasts) => Promise<string | undefined>;
}) {
  const [lasts, setLasts] = useState<AllowAllLasts>("task");
  const allow = useAction(async () => {
    const failed = await props.onAllow(lasts);
    if (failed === undefined) props.onClose();
    return failed;
  });
  const chosen = LENGTHS.find((length) => length.lasts === lasts) ?? LENGTHS[3];
  return (
    <DialogCard
      title="Allow all for this task"
      says="This session runs commands and edits setup files without asking, for as long as you pick."
      open={props.open}
      onClose={props.onClose}
      actions={
        <>
          <Button variant="outline" size="lg" waiting={allow.busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="needs"
            size="lg"
            grow
            busy={allow.busy}
            busyLabel="Allowing…"
            onClick={() => void allow.run()}
          >
            {chosen?.allow}
          </Button>
        </>
      }
    >
      <fieldset aria-label="How long" className="flex flex-col gap-2">
        {LENGTHS.map((length) => {
          const on = length.lasts === lasts;
          return (
            <label
              key={length.lasts}
              className={classes(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-row px-4 py-2.5 select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                on ? "border-stroke border-primary-text bg-primary/12" : "bg-secondary",
              )}
            >
              <input
                type="radio"
                name="allow-all-lasts"
                checked={on}
                onChange={() => setLasts(length.lasts)}
                className="sr-only"
              />
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-interface font-bold text-foreground">{length.label}</span>
                {length.note !== undefined && (
                  <span className="text-meta text-muted-foreground">{length.note}</span>
                )}
              </span>
              {on && (
                <span
                  aria-hidden
                  className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      <p className="text-meta text-muted-foreground">
        Still asks: edits outside this session's branch, pushing anywhere else, force pushes,
        deleting branches, credentials and tool connections.
      </p>
      <FormError message={allow.error} />
    </DialogCard>
  );
}
