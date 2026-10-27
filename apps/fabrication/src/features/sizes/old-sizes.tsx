import type { OldSize, OldSizesConfirm } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { SegmentedChoice } from "@courtyard/ui/forms/segmented-choice.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { useState } from "react";
import { valueWords } from "./words.ts";

type Pick = "measured" | "about" | "leave";

const PICKS = [
  { value: "measured", label: "Measured" },
  { value: "about", label: "About" },
  { value: "leave", label: "Leave out" },
] as const satisfies readonly { value: Pick; label: string }[];

/** The day a sentence was written, as the list says it: "20 Oct". */
const dayWords = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Old sizes to confirm, once (#709): each size found in a sentence (Facts, a project's or the
 * space's history), with the sentence and where it was found. Each is offered as about; the owner
 * ticks Measured for those they measured, or leaves one out. Confirm records them as one change
 * and the list isn't offered again.
 */
export function OldSizesList(props: {
  oldSizes: readonly OldSize[];
  confirm: (confirm: OldSizesConfirm) => Promise<string | undefined>;
}) {
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const pickOf = (old: OldSize): Pick => picks[old.key] ?? "about";
  const confirming = useAction(props.confirm);
  const kept = props.oldSizes.filter((old) => pickOf(old) !== "leave");
  const confirm = () =>
    void confirming.run({
      listed: props.oldSizes.map(({ key }) => key),
      picks: kept.map((old) => ({
        key: old.key,
        property: old.property,
        measured: pickOf(old) === "measured",
      })),
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-interface text-muted-foreground">
        These sizes were written down before Fabrication kept sizes. Each is kept as about; tick
        Measured for the ones you measured.
      </p>
      <ul className="flex flex-col gap-2">
        {props.oldSizes.map((old) => (
          <li key={old.key} className="flex flex-col gap-2 rounded-row bg-muted px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-interface font-medium">{old.property}</span>
              <span className="font-mono text-interface">
                {old.rough ? "about " : ""}
                {valueWords(old.value)}
              </span>
            </div>
            <p className="text-meta text-muted-foreground">
              “{old.sentence}” · {old.from}
              {old.day === null ? "" : `, ${dayWords(old.day)}`}
            </p>
            <SegmentedChoice
              label={`${old.property}, ${valueWords(old.value)}`}
              options={PICKS}
              value={pickOf(old)}
              onChange={(pick) => setPicks((now) => ({ ...now, [old.key]: pick }))}
              look="apart"
            />
          </li>
        ))}
      </ul>
      <FormError message={confirming.error} />
      <Button
        variant="primary"
        size="lg"
        busy={confirming.busy}
        busyLabel="Recording…"
        onClick={confirm}
      >
        {kept.length === 0
          ? "Record none of these"
          : `Record ${kept.length} ${kept.length === 1 ? "size" : "sizes"}`}
      </Button>
    </div>
  );
}
