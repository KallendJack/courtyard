import {
  THING_FIELD_MAX_CHARACTERS,
  type ThingDetailName,
  type ThingForm as ThingFormFields,
  type ThingStatus,
  type ThingSummary,
} from "@courtyard/contract";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/button";
import { FileField } from "@/components/file-picker";
import { FormError } from "@/components/form-error";
import { SegmentedChoice } from "@/components/segmented-choice";
import { Select } from "@/components/select";
import { TextField } from "@/components/text-field";
import { useAction } from "@/lib/use-action";
import { preparePhoto } from "../sessions/attaching.ts";
import { boughtFromWords, boughtInWords, STATUS_WORDS } from "./words.ts";

const STATUSES = (["have", "want", "replace"] as const).map((status) => ({
  value: status,
  label: STATUS_WORDS[status],
}));

const DETAIL_LABELS: Readonly<Record<ThingDetailName, string>> = {
  brand: "Brand",
  bought: "Bought",
  price: "Price",
  condition: "Condition",
  size: "Size",
  where: "Where",
};

/** What the form saves: its fields, and a photo the owner picked, ready to upload. */
export type ThingFormSave = (
  form: ThingFormFields,
  photo: File | undefined,
) => Promise<string | undefined>;

/**
 * Add Thing's and Edit's form (ADR 0020), from the shared fields: the name and status, then the
 * details two by two, the Thing it's part of and a photo. A blank detail is cleared.
 */
export function ThingForm(props: {
  /** The Thing being edited; none for a new one. */
  thing?: ThingSummary;
  /** The Things it could be part of: those that aren't parts themselves, nor this one. */
  parents: readonly ThingSummary[];
  /** It has parts, so it can't be part of another. */
  hasParts: boolean;
  save: ThingFormSave;
  onDone: () => void;
}) {
  const { thing, parents } = props;
  const [name, setName] = useState(thing?.name ?? "");
  const [status, setStatus] = useState<ThingStatus>(thing?.status ?? "have");
  const [details, setDetails] = useState<Record<ThingDetailName, string>>({
    brand: thing?.brand ?? "",
    bought: thing?.bought === undefined ? "" : boughtInWords(thing.bought),
    price: thing?.price ?? "",
    condition: thing?.condition ?? "",
    size: thing?.size ?? "",
    where: thing?.where ?? "",
  });
  const [partOf, setPartOf] = useState<string>(thing?.partOf ?? "");
  const [photo, setPhoto] = useState<File>();
  const [photoProblem, setPhotoProblem] = useState<string>();
  const save = useAction(props.save);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parent = parents.find((each) => each.slug === partOf);
    const done = await save.run(
      {
        name,
        status,
        ...details,
        bought: details.bought.trim() === "" ? "" : boughtFromWords(details.bought),
        partOf: parent?.slug ?? null,
      },
      photo,
    );
    if (done) props.onDone();
  };

  const detail = (field: ThingDetailName, placeholder?: string) => (
    <TextField
      label={DETAIL_LABELS[field]}
      value={details[field]}
      onChange={(event) => {
        const value = event.target.value;
        setDetails((was) => ({ ...was, [field]: value }));
      }}
      maxLength={THING_FIELD_MAX_CHARACTERS}
      autoComplete="off"
      {...(placeholder === undefined ? {} : { placeholder })}
    />
  );

  return (
    <form
      onSubmit={submit}
      aria-label={thing === undefined ? "Add Thing" : `Edit ${thing.name}`}
      className="flex flex-col gap-3.5"
    >
      <div className="flex flex-col gap-3.5 md:flex-row md:items-end md:gap-4">
        <div className="md:grow">
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={THING_FIELD_MAX_CHARACTERS}
            required
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span aria-hidden className="text-sm font-medium">
            Status
          </span>
          <SegmentedChoice label="Status" options={STATUSES} value={status} onChange={setStatus} />
        </div>
      </div>
      <Pair>
        {detail("brand")}
        {detail("bought", "Oct 2026")}
      </Pair>
      <Pair>
        {detail("price")}
        {detail("condition")}
      </Pair>
      <Pair>
        {detail("size")}
        {detail("where")}
      </Pair>
      <Pair>
        {props.hasParts ? (
          <p className="self-end pb-3 text-xs text-muted-foreground">
            It has parts, so it can't be part of another Thing.
          </p>
        ) : (
          <Select
            label="Part of"
            look="field"
            options={[
              { value: "", label: "Nothing" },
              ...parents.map((each) => ({ value: each.slug, label: each.name })),
            ]}
            value={partOf}
            onChange={setPartOf}
          />
        )}
        <FileField
          label="Photo"
          accept="image/*"
          chosen={photo?.name ?? (thing?.photo ? `${thing.slug}.jpg` : undefined)}
          empty="No photo"
          onPick={(picked) => {
            void preparePhoto(picked).then((ready) => {
              if ("problem" in ready) {
                setPhotoProblem(ready.problem);
              } else {
                setPhotoProblem(undefined);
                setPhoto(ready.file);
              }
            });
          }}
        />
      </Pair>
      <FormError message={photoProblem ?? save.error} />
      <div className="flex justify-end gap-3 pt-1.5">
        <Button variant="outline" onClick={props.onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Two fields side by side from tablet width up, one above the other on a phone. */
function Pair(props: { children: ReactNode }) {
  return <div className="grid gap-3.5 md:grid-cols-2 md:gap-4">{props.children}</div>;
}
