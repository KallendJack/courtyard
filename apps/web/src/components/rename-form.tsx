import { type FormEvent, useEffect, useRef, useState } from "react";
import { classes } from "@/lib/classes";

/**
 * A name changed in place: Enter or Save keeps it, Escape or Cancel leaves it as it was. `save`
 * returns an error to show, or nothing once the name is kept. Plain elements rather than shadcn's,
 * since the sidebar puts it on the first load.
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
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  // Opened by the owner to type a name, so the box takes the keyboard with the old name selected.
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() === props.value) return props.onDone();
    setSaving(true);
    const problem = await props.save(value);
    setSaving(false);
    if (problem) return setError(problem);
    props.onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input
        ref={box}
        aria-label={props.label}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onDone();
        }}
        maxLength={props.maxLength}
        required
        autoComplete="off"
        className={classes(
          "w-full rounded-md border bg-field outline-none focus:border-primary focus:ring-3 focus:ring-accent",
          props.large
            ? "h-12 px-3 font-display text-2xl font-medium tracking-[-0.02em]"
            : "h-9 px-2.5 text-sm",
        )}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={props.onDone}
          className="h-8 rounded-full border bg-background px-4 text-sm font-semibold hover:bg-muted"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </form>
  );
}
