import type { ChangedFile } from "@courtyard/contract";
import { classes } from "@/lib/classes";

type Line = { kind: "added" | "removed" | "same"; text: string };
type Hunk = { lines: string; rows: Line[] };

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** The lines a hunk shows in the file as it is now: "Lines 14–20", or "Line 14" for one. */
const linesOf = (start: number, count: number) =>
  count <= 1 ? `Line ${start}` : `Lines ${start}–${start + count - 1}`;

/** A file's diff, as git's unified hunks, into rows to show. */
const hunksOf = (patch: string) => {
  const hunks: Hunk[] = [];
  for (const line of patch.split("\n")) {
    const header = HUNK.exec(line);
    if (header) {
      hunks.push({ lines: linesOf(Number(header[1]), Number(header[2] ?? "1")), rows: [] });
      continue;
    }
    const hunk = hunks.at(-1);
    // "\ No newline at end of file", and anything before the first hunk, isn't the file's.
    if (hunk === undefined || line.startsWith("\\")) continue;
    const sign = line[0];
    hunk.rows.push({
      kind: sign === "+" ? "added" : sign === "-" ? "removed" : "same",
      text: line.slice(1),
    });
  }
  return hunks;
};

const ROW = {
  added: { sign: "+", look: "bg-workspace-moss/12 text-code-string", name: "Added" },
  removed: { sign: "−", look: "bg-destructive/12 text-destructive", name: "Removed" },
  same: { sign: "", look: "text-muted-foreground", name: undefined },
} as const;

/**
 * One file's diff, sized for a narrow window (Paper, Handheld · 18 and 04): long lines wrap
 * rather than scroll sideways, under their own + or −, so it reads on the cover screen.
 */
export function Diff(props: { file: ChangedFile; place: string }) {
  const { file } = props;
  const hunks = file.patch === null ? [] : hunksOf(file.patch);
  return (
    <section
      aria-label={`Diff of ${file.path}`}
      className="flex min-w-0 flex-col overflow-clip rounded-card bg-surface"
    >
      <div className="flex items-baseline justify-between gap-3 px-3.5 py-3 shadow-[inset_0_-1px_0] shadow-border">
        <p className="min-w-0 truncate font-mono text-xs/4 text-foreground" title={file.path}>
          {file.path}
          {file.status === "added" ? " · new" : file.status === "removed" ? " · deleted" : ""}
        </p>
        <p className="shrink-0 text-xs/4 font-semibold text-placeholder">{props.place}</p>
      </div>
      {hunks.length === 0 ? (
        <p className="px-3.5 py-3 text-xs/5 text-muted-foreground">
          {file.status === "renamed"
            ? "Moved here, with nothing in it changed."
            : "GitHub shows no diff for this file: it's binary, or too large to show."}
        </p>
      ) : (
        hunks.map((hunk) => (
          // Each hunk shows different lines of the file.
          <div key={hunk.lines} className="flex flex-col py-1">
            <p className="px-3.5 pt-1.5 pb-1 font-mono text-[11px]/4 text-placeholder">
              {hunk.lines}
            </p>
            {hunk.rows.map((row, line) => {
              const shown = ROW[row.kind];
              return (
                <p
                  // biome-ignore lint/suspicious/noArrayIndexKey: a hunk's lines never move
                  key={line}
                  className={classes(
                    "flex gap-2 px-3.5 py-0.5 font-mono text-xs/[18px] whitespace-pre-wrap",
                    shown.look,
                  )}
                >
                  <span aria-hidden className="w-2 shrink-0 select-none">
                    {shown.sign}
                  </span>
                  {shown.name !== undefined && <span className="sr-only">{shown.name}: </span>}
                  <span className="min-w-0 wrap-anywhere">{row.text || " "}</span>
                </p>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}
