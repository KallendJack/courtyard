import { type ReactNode, useId, useRef } from "react";

/**
 * The browser's own file picker, opened from a control of Courtyard's (Change photo on a Thing's
 * card, its form's Photo field): `picker` is a hidden file box to put anywhere on the page, and
 * `open` opens it. A pick is passed on, and the box emptied so the same file can be picked again.
 */
export const useFilePicker = (props: { accept: string; onPick: (file: File) => void }) => {
  const box = useRef<HTMLInputElement>(null);
  const picker = (
    <input
      ref={box}
      type="file"
      accept={props.accept}
      hidden
      tabIndex={-1}
      onChange={(event) => {
        const [file] = event.currentTarget.files ?? [];
        event.currentTarget.value = "";
        if (file !== undefined) props.onPick(file);
      }}
    />
  );
  return { picker, open: () => box.current?.click() };
};

/**
 * A labelled field that picks a file, in a TextField's look (ADR 0012): what's chosen, or `empty`,
 * and an action word ("Change"). Safe on the first load.
 */
export function FileField(props: {
  label: string;
  accept: string;
  /** What's chosen now, if anything: a file's name, say. */
  chosen: string | undefined;
  /** What it says with nothing chosen. */
  empty: string;
  onPick: (file: File) => void;
}): ReactNode {
  const id = useId();
  const { picker, open } = useFilePicker({ accept: props.accept, onPick: props.onPick });
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <button
        id={id}
        type="button"
        onClick={open}
        className="flex h-11 w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-field px-2.5 text-left text-base outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-accent md:text-sm"
      >
        <span
          className={props.chosen === undefined ? "truncate text-muted-foreground" : "truncate"}
        >
          {props.chosen ?? props.empty}
        </span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <span className="shrink-0 font-semibold text-primary-text">
          {props.chosen === undefined ? "Choose" : "Change"}
        </span>
      </button>
      {picker}
    </div>
  );
}
