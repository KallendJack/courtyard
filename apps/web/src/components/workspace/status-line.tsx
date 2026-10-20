import type { StatusItem, StatusLine } from "@courtyard/contract";
import { classes } from "@/lib/classes";

type StatusPlace = keyof StatusLine;

const PLACES: readonly StatusPlace[] = ["done", "now", "next"];

const PLACE_NAMES: Readonly<Record<StatusPlace, string>> = {
  done: "Just done",
  now: "Now",
  next: "Next",
};

/**
 * The status line under a code workspace's name (#256; Paper, "Tablet · Header with the status
 * line" and "Cover · Header with the status line"): a tiny checklist, ✓ just done · ● now · ○ next,
 * in grey with only now in violet, and never a date or a nudge. Until it's known it keeps its place
 * as one faint line (#283). It's built from the workspace's data, so its items are only words.
 */
export function StatusLineView(props: { line: StatusLine | undefined }) {
  const { line } = props;
  if (line === undefined) {
    return (
      <span aria-hidden data-placeholder="" className="block h-6 w-56 rounded-sm bg-muted/50" />
    );
  }
  const shown = PLACES.flatMap((place) => {
    const item = line[place];
    return item === null ? [] : [{ place, item }];
  });
  if (shown.length === 0) return null;
  return (
    <ul aria-label="Status" className="flex h-6 min-w-0 items-center gap-3.5">
      {shown.map(({ place, item }, index) => (
        <li key={place} className="flex min-w-0 items-center gap-3.5">
          {index > 0 && (
            <span aria-hidden className="text-interface font-semibold text-input">
              ·
            </span>
          )}
          <Item place={place} item={item} />
        </li>
      ))}
    </ul>
  );
}

/** One item: ✓ and its words, ● in a violet pill, or ○. */
function Item(props: { place: StatusPlace; item: StatusItem }) {
  const { place, item } = props;
  const now = place === "now";
  return (
    <span
      className={classes(
        "flex min-w-0 items-center gap-1.5 text-interface font-semibold",
        now
          ? "rounded-full bg-primary/15 px-2.5 py-0.5 text-primary-text ring-1 ring-primary-text"
          : "text-muted-foreground",
      )}
    >
      {place === "done" ? (
        <span aria-hidden>✓</span>
      ) : (
        <span
          aria-hidden
          className={classes(
            "size-2 shrink-0 rounded-full",
            now ? "bg-primary-text" : "border border-muted-foreground",
          )}
        />
      )}
      <span className="truncate">
        <span className="sr-only">{PLACE_NAMES[place]}: </span>
        {item.text}
      </span>
    </span>
  );
}
