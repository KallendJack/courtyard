import { classes } from "@/lib/classes";

/** A file in the tree: where it is, and the lines it adds and removes. */
export type TreeFile = { path: string; additions: number; deletions: number };

/** The files under each folder, folders in the order their first file comes. */
const byFolder = (files: readonly TreeFile[]) => {
  const folders = new Map<string, { name: string; file: TreeFile }[]>();
  for (const file of files) {
    const cut = file.path.lastIndexOf("/");
    const folder = cut === -1 ? "" : file.path.slice(0, cut + 1);
    const inFolder = folders.get(folder) ?? [];
    inFolder.push({ name: file.path.slice(cut + 1), file });
    folders.set(folder, inFolder);
  }
  return [...folders];
};

/** Lines added and removed, as a diff counts them: "+14 −18", "+64". */
export const lineCounts = (file: { additions: number; deletions: number }) =>
  [file.additions > 0 && `+${file.additions}`, file.deletions > 0 && `−${file.deletions}`]
    .filter(Boolean)
    .join(" ") || "±0";

/**
 * The files a change touches as a small tree (Paper, Handheld · 18 and 04): grouped by folder,
 * each with the lines it adds and removes, the chosen one raised. Tapping a file chooses it. Its
 * classes are off the first load, in review.css with the review that uses it.
 */
export function FileTree(props: {
  files: readonly TreeFile[];
  chosen: string | undefined;
  onChoose: (path: string) => void;
}) {
  const count = props.files.length;
  return (
    <nav
      aria-label="Changed files"
      className="flex max-h-80 flex-col gap-0.5 overflow-y-auto rounded-card bg-surface p-2 md:max-h-none"
    >
      <p className="px-2.5 pt-1.5 pb-1 text-[11px]/4 font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {count === 1 ? "1 file" : `${count} files`}
      </p>
      {byFolder(props.files).map(([folder, files]) => (
        <div key={folder} className="flex flex-col gap-0.5">
          {folder !== "" && (
            <p className="truncate px-2.5 pt-1.5 pb-1 font-mono text-xs/4 text-placeholder">
              {folder}
            </p>
          )}
          {files.map(({ name, file }) => {
            const chosen = file.path === props.chosen;
            return (
              <button
                key={file.path}
                type="button"
                aria-current={chosen ? "true" : undefined}
                title={file.path}
                onClick={() => props.onChoose(file.path)}
                className={classes(
                  "flex h-11 shrink-0 items-center justify-between gap-3 rounded-row pr-3 text-left font-mono text-xs/4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  folder === "" ? "pl-2.5" : "pl-5.5",
                  chosen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                <span className="min-w-0 truncate">{name}</span>
                <span
                  className={classes("shrink-0", chosen ? "text-code-string" : "text-placeholder")}
                >
                  {lineCounts(file)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
