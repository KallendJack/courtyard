import { type FormEvent, useEffect, useRef, useState } from "react";
import { useAction } from "@/lib/use-action";
import { Button } from "./button.tsx";
import { TextField } from "./text-field.tsx";

/**
 * A name changed in place: Enter or Save keeps it, Escape or Cancel leaves it as it was. `save`
 * returns an error to show, or nothing once the name is kept.
 */
export function RenameForm(props: {
  /** What's being named, for screen readers: "Workspace name", say. */
  label: string;
  value: string;
  maxLength: number;
  save: (value: string) => Promise<string | undefined>;
  onDone: () => void;
  /** A page title's size, rather than a list row's. */
  large?: boolean;
}) {
  const [value, setValue] = useState(props.value);
  const save = useAction(props.save);
  const box = useRef<HTMLInputElement>(null);

  // Opened by the owner to type a name, so the box takes the keyboard with the old name selected.
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() === props.value || (await save.run(value))) props.onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <TextField
        ref={box}
        label={props.label}
        hideLabel
        size={props.large ? "title" : "sm"}
        error={save.error}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onDone();
        }}
        maxLength={props.maxLength}
        required
        autoComplete="off"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.busy}>
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
