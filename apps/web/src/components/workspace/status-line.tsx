import {
  STATUS_ITEM_MAX_LENGTH,
  type StatusItem,
  type StatusLine,
  type StatusLineChange,
  type StatusPlace,
} from "@courtyard/contract";
import { useState } from "react";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { Button } from "../buttons/button.tsx";
import { FormError } from "../forms/form-error.tsx";
import { RenameForm } from "../forms/rename-form.tsx";
import { CapsLabel } from "../layout/caps-label.tsx";
import { placeUnder, useAnchorName } from "../layout/place-under.ts";
import { useDialog } from "../layout/use-dialog.ts";

const PLACES: readonly StatusPlace[] = ["done", "now", "next"];

const PLACE_NAMES: Readonly<Record<StatusPlace, string>> = {
  done: "Just done",
  now: "Now",
  next: "Next",
};

/** Where an item came from, in a few calm words: never a date (#256). */
const fromWords = (item: StatusItem, now: number) => {
  if (item.edited) return "In your own words";
  if (item.from === undefined) return undefined;
  const day = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const at = Date.parse(item.from.at);
  const daysAgo = Math.round((day(now) - day(at)) / 86_400_000);
  if (daysAgo <= 0) return "From today's chat";
  if (daysAgo === 1) return "From yesterday's chat";
  if (daysAgo < 7) {
    return `From ${new Date(at).toLocaleDateString("en-GB", { weekday: "long" })}'s chat`;
  }
  return "From an earlier chat";
};

/**
 * The status line under a workspace's name (#256; Paper, "Tablet · Header with the status line"
 * and "Cover · Header with the status line"): a tiny checklist, ✓ just done · ● now · ○ next, in
 * grey with only now in violet, and never a date or a nudge. Until it's known it keeps its place
 * as one faint line (#283). On a planning workspace each item opens a small card under it
 * ("Tablet · Status line: an item tapped") with Done, which moves the line along at once, Edit
 * and Remove; a code workspace's is built from its data, so its items are only words.
 */
export function StatusLineView(props: {
  line: StatusLine | undefined;
  /** The owner's change: an error to show, or nothing once it's kept. */
  change: (change: StatusLineChange) => Promise<string | undefined>;
}) {
  const { line } = props;
  const [open, setOpen] = useState<StatusPlace>();
  const anchor = useAnchorName();
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
    <>
      <ul aria-label="Status" className="flex h-6 min-w-0 items-center gap-3.5">
        {shown.map(({ place, item }, index) => (
          <li key={place} className="flex min-w-0 items-center gap-3.5">
            {index > 0 && (
              <span aria-hidden className="text-interface font-semibold text-input">
                ·
              </span>
            )}
            <Item
              place={place}
              item={item}
              opens={line.editable}
              open={open === place}
              onOpen={() => setOpen(place)}
              anchor={open === place ? anchor : undefined}
            />
          </li>
        ))}
      </ul>
      {open !== undefined && line[open] !== null && (
        <ItemCard
          place={open}
          line={line}
          anchor={anchor}
          change={props.change}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

/** One item: ✓ and its words, ● in a violet pill, or ○; a button when it opens its card. */
function Item(props: {
  place: StatusPlace;
  item: StatusItem;
  opens: boolean;
  open: boolean;
  onOpen: () => void;
  anchor: string | undefined;
}) {
  const { place, item } = props;
  const now = place === "now";
  const look = classes(
    "flex min-w-0 items-center gap-1.5 text-interface font-semibold outline-none",
    now
      ? "rounded-full bg-primary/15 px-2.5 py-0.5 text-primary-text ring-1 ring-primary-text"
      : "text-muted-foreground",
    props.opens && "focus-visible:ring-3 focus-visible:ring-ring/50",
    props.opens && !now && "rounded-sm hover:text-foreground",
  );
  const content = (
    <>
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
    </>
  );
  return props.opens ? (
    <button
      type="button"
      className={look}
      aria-haspopup="dialog"
      aria-expanded={props.open}
      onClick={props.onOpen}
      style={props.anchor === undefined ? undefined : { anchorName: props.anchor }}
    >
      {content}
    </button>
  ) : (
    <span className={look}>{content}</span>
  );
}

/** An item's card, under it: what it is, where it came from, and Done · Edit · Remove. */
function ItemCard(props: {
  place: StatusPlace;
  line: StatusLine;
  anchor: string;
  change: (change: StatusLineChange) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const { place, line } = props;
  const item = line[place];
  const [editing, setEditing] = useState(false);
  const dialog = useDialog(true, props.onClose);
  const act = useAction(async (change: StatusLineChange) => {
    const problem = await props.change(change);
    if (problem === undefined) props.onClose();
    return problem;
  });
  if (item === null) return null;
  const ticks = place !== "done";
  const note = [
    fromWords(item, Date.now()),
    place === "now" && line.next !== null ? `next is ${line.next.text}` : undefined,
  ]
    .filter((words) => words !== undefined)
    .join(" · ");
  const doneMeans =
    place === "now"
      ? `Done moves the line along: ${item.text} ✓${line.next === null ? "" : ` · ${line.next.text} now`}`
      : `Done ticks it: ${item.text} ✓`;
  const busy = (kind: StatusLineChange["kind"]) => act.running?.[0].kind === kind;
  return (
    <dialog
      {...dialog}
      aria-label={`${PLACE_NAMES[place]}: ${item.text}`}
      style={placeUnder(props.anchor, { side: "left", gap: 10, width: 340 })}
      className="fixed m-0 rounded-lg border border-input bg-secondary text-foreground shadow-raised backdrop:bg-card/60"
    >
      <div className="flex flex-col gap-3.5 p-4.5">
        {editing ? (
          <RenameForm
            label={PLACE_NAMES[place]}
            value={item.text}
            maxLength={STATUS_ITEM_MAX_LENGTH}
            save={(text) => props.change({ kind: "edit", place, text })}
            onDone={props.onClose}
          />
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <CapsLabel tone="muted">{PLACE_NAMES[place]}</CapsLabel>
              <p className="text-card-title font-bold wrap-anywhere">{item.text}</p>
              {note !== "" && <p className="text-meta font-medium text-muted-foreground">{note}</p>}
            </div>
            <div className="flex gap-2">
              {ticks && (
                <Button
                  size="lg"
                  grow
                  busy={busy("done")}
                  busyLabel="Ticking…"
                  waiting={act.busy && !busy("done")}
                  onClick={() => void act.run({ kind: "done", place })}
                >
                  Done
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                grow
                waiting={act.busy}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                size="lg"
                grow
                busy={busy("remove")}
                busyLabel="Removing…"
                waiting={act.busy && !busy("remove")}
                onClick={() => void act.run({ kind: "remove", place })}
              >
                Remove
              </Button>
            </div>
            <FormError message={act.error} />
            {ticks && <p className="text-label font-medium text-placeholder">{doneMeans}</p>}
          </>
        )}
      </div>
    </dialog>
  );
}
