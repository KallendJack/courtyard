import type {
  OwnerSizeSource,
  RecordUnit,
  SizeLine,
  SizeRecordId,
  SizeValue,
  ThingSlug,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { SegmentedChoice } from "@courtyard/ui/forms/segmented-choice.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { useState } from "react";
import { recordValue, sourceWord, whenWords } from "./words.ts";

/** What the form saves: a new size, a correction, or one answer kept over the others. */
export type SizeSaving =
  | {
      readonly kind: "add";
      readonly thing: ThingSlug;
      readonly property: string;
      readonly value: SizeValue;
      readonly source: OwnerSizeSource;
    }
  | {
      readonly kind: "correct";
      readonly id: SizeRecordId;
      readonly revision: number;
      readonly value: SizeValue;
      readonly source: OwnerSizeSource;
    }
  | {
      readonly kind: "keep";
      readonly id: SizeRecordId;
      readonly revision: number;
      readonly others: readonly { id: SizeRecordId; revision: number }[];
    };

const UNITS = (["mm", "cm", "m"] as const).map((unit) => ({ value: unit, label: unit }));
const SOURCES = [
  { value: "measured", label: "Measured" },
  { value: "reported", label: "About" },
] as const satisfies readonly { value: OwnerSizeSource; label: string }[];
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const FIELD =
  "h-11 rounded-md border border-input bg-field px-3 text-interface text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * A size measured, corrected or added (#709): when its answers disagree, each to keep with one
 * tap; then its value, its unit and whether it was measured or is about, and Save. A new size
 * asks its name too. Nothing is typed until the owner taps a field.
 */
export function SizeForm(props: {
  /** The size, or none for + Size. */
  line: SizeLine | undefined;
  /** The Thing a new size, or a first record of a needed one, is of. */
  thing: ThingSlug;
  save: (saving: SizeSaving) => Promise<string | undefined>;
  now: number;
}) {
  const { line } = props;
  const records = line?.records ?? [];
  const [newest] = records.slice(-1);
  const was = newest?.value;
  const kind = was?.kind ?? "quantity";
  const [property, setProperty] = useState("");
  // A rough figure is only the hint, so one tap of Save never makes a guess measured.
  const measured = newest?.source.kind === "measured";
  const [amount, setAmount] = useState(was?.kind === "quantity" && measured ? `${was.value}` : "");
  const [text, setText] = useState(was?.kind === "text" ? was.text : "");
  const [yes, setYes] = useState<"yes" | "no">(was?.kind === "yes-no" && !was.yes ? "no" : "yes");
  const [unit, setUnit] = useState<RecordUnit>(was?.kind === "quantity" ? was.unit : "mm");
  const [source, setSource] = useState<OwnerSizeSource>("measured");
  const saving = useAction((saving: SizeSaving) => props.save(saving));

  const value = (): SizeValue | undefined => {
    if (kind === "text")
      return text.trim() === "" ? undefined : { kind: "text", text: text.trim() };
    if (kind === "yes-no") return { kind: "yes-no", yes: yes === "yes" };
    const number = Number(amount.replace(",", "."));
    return amount.trim() === "" || !Number.isFinite(number) || number < 0
      ? undefined
      : { kind: "quantity", value: number, unit };
  };
  const ready = value() !== undefined && (line !== undefined || property.trim() !== "");
  const submit = () => {
    const given = value();
    if (given === undefined) return;
    if (newest !== undefined && records.length === 1) {
      void saving.run({
        kind: "correct",
        id: newest.id,
        revision: newest.revision,
        value: given,
        source,
      });
    } else {
      void saving.run({
        kind: "add",
        thing: props.thing,
        property: line?.property ?? property.trim(),
        value: given,
        source,
      });
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {line?.where !== null && line?.where !== undefined && (
        <p className="text-interface text-muted-foreground">Measure {line.where}.</p>
      )}
      {records.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-meta text-warning">
            These answers disagree: keep the right one, or measure it again below.
          </legend>
          {records.map((record) => (
            <fieldset
              key={record.id}
              aria-label={recordValue(record)}
              className="flex items-center justify-between gap-3 rounded-row bg-muted px-3 py-2"
            >
              <span className="flex flex-col">
                <span className="font-mono text-interface">{recordValue(record)}</span>
                <span className="text-meta text-muted-foreground">
                  {sourceWord(record.source.kind)} · {whenWords(record, props.now)}
                </span>
              </span>
              <Button
                variant="soft"
                size="sm"
                busy={saving.running?.[0].kind === "keep" && saving.running[0].id === record.id}
                busyLabel="Keeping…"
                waiting={saving.busy}
                onClick={() =>
                  void saving.run({
                    kind: "keep",
                    id: record.id,
                    revision: record.revision,
                    others: records
                      .filter((other) => other.id !== record.id)
                      .map(({ id, revision }) => ({ id, revision })),
                  })
                }
              >
                Keep this
              </Button>
            </fieldset>
          ))}
        </fieldset>
      )}
      {line === undefined && (
        <label className="flex flex-col gap-1.5">
          <span className="text-meta text-muted-foreground">Which size</span>
          <input
            className={FIELD}
            value={property}
            onChange={(event) => setProperty(event.target.value)}
            placeholder="Door width"
            maxLength={80}
          />
        </label>
      )}
      {kind === "quantity" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-meta text-muted-foreground">Size</span>
            <input
              className={`${FIELD} font-mono`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={was?.kind === "quantity" ? `${was.value}` : undefined}
            />
          </label>
          <SegmentedChoice label="Unit" options={UNITS} value={unit} onChange={setUnit} />
        </div>
      )}
      {kind === "text" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-meta text-muted-foreground">What it is</span>
          <input
            className={FIELD}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={80}
          />
        </label>
      )}
      {kind === "yes-no" && (
        <SegmentedChoice label="Yes or no" options={YES_NO} value={yes} onChange={setYes} />
      )}
      <SegmentedChoice
        label="Where it came from"
        options={SOURCES}
        value={source}
        onChange={setSource}
        look="apart"
      />
      <FormError message={saving.error} />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={!ready}
        busy={saving.busy && saving.running?.[0].kind !== "keep"}
        busyLabel="Saving…"
        waiting={saving.busy}
      >
        Save
      </Button>
    </form>
  );
}
