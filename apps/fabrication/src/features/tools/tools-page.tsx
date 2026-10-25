import type { ChangeId, YourTools } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useLayout } from "@courtyard/ui/frame/handheld.ts";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { saveTools, undoTools, yourTools } from "@/api/fabrication";
import {
  describePrinter,
  type Picks,
  recount,
  startingPicks,
  tickHeard,
  tileNote,
  toggle,
  unchanged,
} from "./picks.ts";
import { SayIt } from "./say-it.tsx";
import { type Ticking, ToolTiles } from "./tiles.tsx";

/**
 * Kept once the owner has skipped Your tools, or has tools saved, so a Build doesn't ask again on
 * this visit; the next visit asks again when there are still none.
 */
const ASKED = "fabrication-tools-asked";

/**
 * Whether Your tools has been skipped or saved on this visit. Storage that's blocked (a private
 * window) keeps nothing, so Your tools asks again, never stopping a Build from opening.
 */
export const toolsAsked = () => {
  try {
    return sessionStorage.getItem(ASKED) !== null;
  } catch {
    return false;
  }
};
export const askedTools = () => {
  try {
    sessionStorage.setItem(ASKED, "yes");
  } catch {
    // Kept for nothing: the next Build asks again.
  }
};

/** A panel, as the Build's page has them. */
const PANEL = "flex min-h-0 flex-col rounded-card border border-border bg-surface";

const UNREACHABLE = "Can't reach Courtyard's worker. Try again shortly.";

/** "Save 6 tools", or "Save 1 tool". */
const saveLabel = (picks: Picks) =>
  picks.length === 0
    ? "Save with no tools"
    : `Save ${picks.length} ${picks.length === 1 ? "tool" : "tools"}`;

/**
 * Your tools (#707; Paper, 2 · Agreed, "Fabrication · Your tools, first open", tablet and
 * desktop): the tools the owner has, ticked once and read by every Build. It shows before the
 * first Build, and from Tools on any Build. Tiles start ticked with what's saved and the
 * workspaces' tools, which move here with Save; Save has Undo. `back` is the Build it came from.
 */
export function ToolsPage(props: { tools: YourTools; back: string | undefined }) {
  const cover = useLayout() === "cover";
  const navigate = useNavigate();
  const [tools, setTools] = useState(props.tools);
  const [picks, setPicks] = useState(() => startingPicks(props.tools));
  const [saved, setSaved] = useState<{ change: ChangeId } | "undone">();

  const back = () => void navigate({ to: props.back ?? "/" });
  const skip = () => {
    askedTools();
    back();
  };
  const changeTo = (next: Picks) => {
    setPicks(next);
    setSaved(undefined);
  };
  const ticking: Ticking = {
    toggle: (name) => changeTo(toggle(picks, name)),
    recount: (name, by) => changeTo(recount(picks, name, by)),
    add: (name) => changeTo(tickHeard(picks, [{ name }])),
    describePrinter: (printer) => changeTo(describePrinter(picks, printer)),
    noteOf: (pick) => tileNote(tools, pick),
  };

  const save = useAction(async () => {
    const answer = await saveTools(picks);
    if (answer.kind === "failed") return answer.message;
    if (answer.kind !== "loaded") return UNREACHABLE;
    askedTools();
    setTools(answer.data.tools);
    setPicks(startingPicks(answer.data.tools));
    if (answer.data.change !== null) setSaved({ change: answer.data.change });
    return undefined;
  });
  const undo = useAction(async (change: ChangeId) => {
    const undone = await undoTools(change);
    if (undone.kind === "failed") return undone.message;
    if (undone.kind !== "loaded") return UNREACHABLE;
    const now = await yourTools();
    if (now.kind !== "loaded") return UNREACHABLE;
    setTools(now.data);
    setPicks(startingPicks(now.data));
    setSaved("undone");
    return undefined;
  });

  const header = (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <Link
        to={props.back ?? "/"}
        className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="size-4" />
        <span className="sr-only">Back to </span>
        {props.back === undefined ? "Fabrication" : "the Build"}
      </Link>
      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
      <h1 className="display-title shrink-0 text-xl">Your tools</h1>
      {!cover && (
        <p className="truncate font-mono text-label text-muted-foreground">used by every Build</p>
      )}
      <span className="grow" />
      {tools.saved ? (
        <Button variant="quiet" size="xs" onClick={back}>
          Done
        </Button>
      ) : (
        <Button variant="quiet" size="xs" onClick={skip}>
          Skip for now
        </Button>
      )}
    </header>
  );

  const intro = (
    <div className="flex flex-col gap-2">
      <CapsLabel tone="primary">
        {tools.saved ? "Ticked once, used by every Build" : "Before your first Build"}
      </CapsLabel>
      <h2 className="display-title text-title">What's in your garage?</h2>
      <p className="text-interface text-foreground">
        Tick what you've got. Every step is written for these tools, never for ones you don't have.
      </p>
    </div>
  );

  const footer = (
    <div className="flex flex-col gap-2.5">
      <div role="status" className="text-meta text-muted-foreground">
        {saved === undefined ? (
          "Bought something new? Tick it here, or under Tools on any Build. Its steps switch over, and the parts stay the same."
        ) : saved === "undone" ? (
          "Undone: your tools are as they were."
        ) : (
          <span className="flex items-center justify-between gap-2">
            Saved your tools.
            <Button
              variant="quiet"
              size="xs"
              busy={undo.busy}
              busyLabel="Undoing…"
              onClick={() => void undo.run(saved.change)}
            >
              Undo
            </Button>
          </span>
        )}
      </div>
      <FormError message={save.error ?? undo.error} />
      <Button
        size="thumb"
        fullWidth
        busy={save.busy}
        busyLabel="Saving…"
        disabled={unchanged(picks, tools)}
        onClick={() => void save.run()}
      >
        {saveLabel(picks)}
      </Button>
    </div>
  );

  const tiles = <ToolTiles picks={picks} ticking={ticking} />;
  const sayIt = <SayIt onHeard={(heard) => changeTo(tickHeard(picks, heard))} />;
  const printerNote = (
    <p className="text-meta text-muted-foreground">
      Tick 3D printer and it asks which one, so printed parts fit its plate. Its size and clearance
      are kept with it.
    </p>
  );

  if (cover) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <Scroller className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4 px-4 pt-4 pb-4">
            {intro}
            {sayIt}
            {tiles}
            {printerNote}
          </div>
        </Scroller>
        <div className="shrink-0 border-t border-border px-4 pt-3 pb-4">{footer}</div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex min-h-0 flex-1 gap-3 p-3 xl:gap-4 xl:p-4">
        <div className={classes(PANEL, "w-67 shrink-0 gap-4 px-4.5 py-5 xl:w-90")}>
          <Scroller className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-col gap-4">
              {intro}
              {sayIt}
            </div>
          </Scroller>
          {footer}
        </div>
        <div className={classes(PANEL, "min-w-0 flex-1 gap-3.5 p-4.5 xl:px-7 xl:py-6")}>
          <Scroller className="flex min-h-0 flex-1 flex-col">{tiles}</Scroller>
          <div className="border-t border-border pt-3.5">{printerNote}</div>
        </div>
      </div>
    </div>
  );
}
