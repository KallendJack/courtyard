import type { ChangedFile } from "@courtyard/contract";
import { type ReactNode, useEffect, useRef } from "react";
import { Scroller } from "@/components/layout/scroller";
import { classes } from "@/lib/classes";

/** A row of a hunk, and its line in the file as it is now (none for a removed one). */
type Line = { kind: "added" | "removed" | "same"; text: string; now: number | undefined };
type Hunk = { lines: string; rows: Line[] };

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** The lines a hunk shows in the file as it is now: "Lines 14–20", or "Line 14" for one. */
const linesOf = (start: number, count: number) =>
  count <= 1 ? `Line ${start}` : `Lines ${start}–${start + count - 1}`;

/** A file's diff, as git's unified hunks, into rows to show. */
const hunksOf = (patch: string) => {
  const hunks: Hunk[] = [];
  let next = 0;
  for (const line of patch.split("\n")) {
    const header = HUNK.exec(line);
    if (header) {
      next = Number(header[1]);
      hunks.push({ lines: linesOf(next, Number(header[2] ?? "1")), rows: [] });
      continue;
    }
    const hunk = hunks.at(-1);
    // "\ No newline at end of file", and anything before the first hunk, isn't the file's.
    if (hunk === undefined || line.startsWith("\\")) continue;
    const sign = line[0];
    const kind = sign === "+" ? "added" : sign === "-" ? "removed" : "same";
    hunk.rows.push({ kind, text: line.slice(1), now: kind === "removed" ? undefined : next });
    if (kind !== "removed") next += 1;
  }
  return hunks;
};

const ROW = {
  added: { sign: "+", look: "bg-success/12 text-code-string", name: "Added" },
  removed: { sign: "−", look: "bg-destructive/12 text-destructive", name: "Removed" },
  same: { sign: "", look: "text-muted-foreground", name: undefined },
} as const;

/**
 * One file's diff. On a phone (Paper, Handheld · 18 and 04) long lines wrap rather than scroll
 * sideways, under their own + or −, so it reads on the cover screen. From a tablet up (#278) it
 * takes the height it's given and scrolls inside it, and lines never wrap: each scrolls sideways.
 * A line a quick question's answer points at (#327) is marked, and brought into view.
 */
export function Diff(props: {
  file: ChangedFile;
  /** Where it is among the files: "1 of 4", or the switcher between them. */
  place: ReactNode;
  /** The line marked, by its number in the file as it is now. */
  marked?: number | undefined;
}) {
  const { file, marked } = props;
  const hunks = file.patch === null ? [] : hunksOf(file.patch);
  const markedRow = useRef<HTMLParagraphElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: brought into view each time a line is marked, in this file or another
  useEffect(() => {
    markedRow.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [file.path, marked]);

  return (
    <section
      aria-label={`Diff of ${file.path}`}
      className="flex min-w-0 flex-col overflow-clip rounded-card border bg-surface md:h-full"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-3.5 py-2 shadow-divide">
        <p className="min-w-0 truncate font-mono text-meta/4 text-foreground" title={file.path}>
          {file.path}
          {file.status === "added" ? " · new" : file.status === "removed" ? " · deleted" : ""}
        </p>
        <div className="flex min-h-8 shrink-0 items-center text-meta/4 font-semibold text-placeholder">
          {props.place}
        </div>
      </div>
      {hunks.length === 0 ? (
        <p className="px-3.5 py-3 text-meta/5 text-muted-foreground">
          {file.status === "renamed"
            ? "Moved here, with nothing in it changed."
            : "GitHub shows no diff for this file: it's binary, or too large to show."}
        </p>
      ) : (
        // From a tablet up, the lines scroll here, both ways, under the file's name. What a screen
        // reader hears of each line (its sr-only "Added:") is placed in it too, never past the
        // window's foot, where it would scroll the window (#420).
        <Scroller
          data-diff-lines=""
          axis="both"
          from="tablet"
          className="relative md:min-h-0 md:flex-1"
        >
          <div className="md:w-max md:min-w-full">
            {hunks.map((hunk) => (
              // Each hunk shows different lines of the file.
              <div key={hunk.lines} className="flex flex-col py-1">
                <p className="px-3.5 pt-1.5 pb-1 font-mono text-caption text-placeholder">
                  {hunk.lines}
                </p>
                {hunk.rows.map((row, line) => {
                  const shown = ROW[row.kind];
                  const isMarked = marked !== undefined && row.now === marked;
                  return (
                    <p
                      // biome-ignore lint/suspicious/noArrayIndexKey: a hunk's lines never move
                      key={line}
                      ref={isMarked ? markedRow : undefined}
                      {...(isMarked ? { "data-marked": "", "aria-current": "true" } : {})}
                      className={classes(
                        "flex gap-2 px-3.5 py-0.5 font-mono text-meta whitespace-pre-wrap md:whitespace-pre",
                        shown.look,
                        isMarked && "ring-2 ring-primary ring-inset",
                      )}
                    >
                      <span aria-hidden className="w-2 shrink-0 select-none">
                        {shown.sign}
                      </span>
                      {shown.name !== undefined && <span className="sr-only">{shown.name}: </span>}
                      <span className="min-w-0 wrap-anywhere md:wrap-normal">
                        {row.text || " "}
                      </span>
                    </p>
                  );
                })}
              </div>
            ))}
          </div>
        </Scroller>
      )}
    </section>
  );
}
