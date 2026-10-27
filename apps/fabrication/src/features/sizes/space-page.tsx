import type {
  ChangeId,
  OldSizesConfirm,
  SizeLine,
  SpaceSizes,
  ThingSlug,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { useLayout } from "@courtyard/ui/frame/handheld.ts";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { useFresh } from "@courtyard/ui/layout/kept.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { Sheet } from "@courtyard/ui/layout/sheet.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ToCheck } from "@/components/to-check";
import {
  type Answer,
  addSize,
  confirmOldSizes,
  correctSize,
  keepSize,
  undoSizeChange,
} from "../../api/fabrication.ts";
import { PANEL } from "../builds/at-the-bench.tsx";
import { OldSizesList } from "./old-sizes.tsx";
import { SizeForm, type SizeSaving } from "./size-form.tsx";
import { ThingSizesBlock } from "./size-lines.tsx";
import { remeasured } from "./words.ts";

/** What's open over the page: a size, + Size for a Thing, or the old sizes to confirm. */
type Open =
  | { readonly kind: "line"; readonly line: SizeLine; readonly thing: ThingSlug }
  | { readonly kind: "add"; readonly thing: ThingSlug }
  | { readonly kind: "old" };

/** Why a save or its Undo didn't happen, as the page says it. */
const problemOf = (answer: Exclude<Answer<unknown>, { kind: "loaded" }>) =>
  answer.kind === "failed" ? answer.message : "Can't reach Courtyard's worker. Try again.";

/** What a save did, for the line Undo sits on. */
const savedWords = (saving: SizeSaving, name: string) =>
  saving.kind === "keep"
    ? `Kept one answer for ${name}`
    : `${saving.kind === "add" ? "Recorded" : "Corrected"} ${name}`;

/**
 * A space's page in Fabrication (#709; Paper, 2 · Agreed, "Fabrication · Sizes in the room's
 * Things panel · Tablet (#709)"): its sizes and its Things', each with where it came from, the
 * ones that disagree side by side; tap one to correct it, with Undo. The guided re-measure goes
 * through the sizes the space and its Builds need, one at a time, where to measure each, and
 * records them as measured. The first time it opens, the old sizes written in sentences are
 * offered once to confirm. From a tablet up, the size being measured is beside the panel;
 * folded, it opens over it.
 */
export function SpacePage(props: { space: SpaceSizes }) {
  const { space } = props;
  const router = useRouter();
  const cover = useLayout() === "cover";
  const where = { workspaceId: space.workspace.id, slug: space.space.thing.slug };
  const now = Date.now();
  const [chosen, setOpen] = useState<Open>();
  // The old sizes open by themselves while there are any, until they're confirmed or closed.
  const [oldClosed, setOldClosed] = useState(false);
  const open: Open | undefined =
    chosen ?? (space.oldSizes.length > 0 && !oldClosed ? { kind: "old" } : undefined);
  const close = () => {
    if (open?.kind === "old") setOldClosed(true);
    setOpen(undefined);
  };
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [justSaved, setJustSaved] = useState<{ change: ChangeId; words: string }>();
  useFresh({ ask: () => router.invalidate() });

  const toMeasure = remeasured(space.space.lines);
  const done = toMeasure.filter((line) => !line.toMeasure).length;
  const waiting = toMeasure.filter((line) => line.toMeasure);
  const next = waiting.find((line) => !skipped.includes(line.property)) ?? waiting[0];
  const toCheck = [space.space, ...space.parts].flatMap((thing) =>
    thing.lines
      .filter((line) => line.records.length > 1)
      .map((line) => ({ line, thing: thing.thing.slug })),
  );

  const changed = async (answer: Awaited<ReturnType<typeof addSize>>, words: string) => {
    if (answer.kind !== "loaded") {
      // A size changed since it was read: read it again, so what's shown is what's there.
      await router.invalidate();
      return problemOf(answer);
    }
    const { change } = answer.data;
    setJustSaved(change === null ? undefined : { change, words });
    setOpen(undefined);
    await router.invalidate();
    return undefined;
  };

  const save = (name: string) => async (saving: SizeSaving) => {
    const words = savedWords(saving, name);
    switch (saving.kind) {
      case "add": {
        const { kind: _, ...size } = saving;
        return changed(await addSize(where, size), words);
      }
      case "correct": {
        const { kind: _, id, ...correction } = saving;
        return changed(await correctSize(where, id, correction), words);
      }
      case "keep":
        return changed(
          await keepSize(where, saving.id, {
            revision: saving.revision,
            others: [...saving.others],
          }),
          words,
        );
    }
  };
  const confirm = async (picks: OldSizesConfirm) =>
    changed(await confirmOldSizes(where, picks), "Recorded the old sizes");
  const undoing = useAction(async () => {
    if (justSaved === undefined) return undefined;
    const undone = await undoSizeChange(where, justSaved.change);
    if (undone.kind !== "loaded") return problemOf(undone);
    setJustSaved(undefined);
    await router.invalidate();
    return undefined;
  });

  const thingOf = (line: SizeLine) =>
    space.parts.find((part) => part.lines.includes(line))?.thing.slug ?? space.space.thing.slug;
  const tap = (line: SizeLine) => setOpen({ kind: "line", line, thing: thingOf(line) });
  const skip = () => {
    if (next !== undefined)
      setSkipped((now) => [...now.filter((one) => one !== next.property), next.property]);
  };

  const progress = (
    <div className="flex min-h-9.5 items-center justify-between gap-2 rounded-row bg-secondary pr-1.5 pl-3">
      <span className="text-meta text-foreground">
        Re-measure · {done} of {toMeasure.length} done
      </span>
      {next !== undefined && (cover || waiting.length > 1) && (
        <Button
          variant="quietPrimary"
          size="words"
          onClick={
            cover
              ? () => setOpen({ kind: "line", line: next, thing: space.space.thing.slug })
              : skip
          }
        >
          Next size
          <ChevronRight aria-hidden className="size-3.5" />
        </Button>
      )}
    </div>
  );

  const things = (
    <div className="flex flex-col gap-4 pb-2">
      <ThingSizesBlock
        sizes={space.space}
        next={next?.property}
        now={now}
        tap={tap}
        add={() => setOpen({ kind: "add", thing: space.space.thing.slug })}
      />
      {space.parts.map((part) => (
        <ThingSizesBlock
          key={part.thing.slug}
          sizes={part}
          now={now}
          tap={tap}
          add={() => setOpen({ kind: "add", thing: part.thing.slug })}
        />
      ))}
      {toMeasure.length > 0 && progress}
      {space.problems.length > 0 && (
        <p className="text-meta text-destructive">
          {space.problems.length === 1
            ? `${space.problems[0]?.path} can't be read as a size.`
            : `${space.problems.length} size files can't be read as sizes.`}
        </p>
      )}
    </div>
  );

  const measuring =
    next === undefined ? (
      <p className="text-interface text-success">Every size the room needs is measured.</p>
    ) : (
      <div className="flex flex-col gap-3">
        <h2 className="display-title text-sheet-title">{next.property}</h2>
        <SizeForm
          key={`${next.property} ${next.records.map(({ id }) => id).join(" ")}`}
          line={next}
          thing={space.space.thing.slug}
          save={save(next.property)}
          now={now}
        />
      </div>
    );

  const sheetTitle =
    open?.kind === "old"
      ? "Old sizes to confirm"
      : open?.kind === "add"
        ? "+ Size"
        : (open?.line.property ?? "");

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <a
          href={`/workspaces/${encodeURIComponent(space.workspace.id)}`}
          className="flex min-w-0 shrink items-center gap-1.5 text-meta font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-3.5 shrink-0" />
          <span className={classes("truncate", cover && "sr-only")}>
            <span className="sr-only">Back to </span>
            {space.workspace.name}
          </span>
        </a>
        {!cover && <span aria-hidden className="h-5 w-px shrink-0 bg-border" />}
        <h1 className="display-title shrink-0 truncate text-xl">{space.space.thing.name}</h1>
        {!cover && toMeasure.length > 0 && (
          <p className="truncate font-mono text-label text-muted-foreground">
            re-measuring · {done} of {toMeasure.length} · space
          </p>
        )}
        <span className="grow" />
        {space.oldSizes.length > 0 && (
          <Button variant="needsOutline" size="sm" onClick={() => setOpen({ kind: "old" })}>
            {space.oldSizes.length} old {space.oldSizes.length === 1 ? "size" : "sizes"}
          </Button>
        )}
        {toCheck.length > 0 && (
          <ToCheck
            count={toCheck.length}
            size="sm"
            onClick={() => {
              const [first] = toCheck;
              if (first !== undefined) setOpen({ kind: "line", ...first });
            }}
          />
        )}
      </header>
      {cover ? (
        <Scroller className="flex min-h-0 flex-1 flex-col px-3 pt-3">{things}</Scroller>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-2.5 p-2.5 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-4 xl:p-4">
          <section aria-label="Measuring" className={classes(PANEL, "gap-3")}>
            <CapsLabel tone="muted">Measuring</CapsLabel>
            <Scroller className="flex min-h-0 flex-1 flex-col">{measuring}</Scroller>
          </section>
          <section aria-label="Things" className={classes(PANEL, "gap-3")}>
            <CapsLabel tone="muted">Things</CapsLabel>
            {/* Room in its sides for the lit line's light. */}
            <Scroller className="-mx-2 flex min-h-0 flex-1 flex-col px-2">{things}</Scroller>
          </section>
        </div>
      )}
      {justSaved !== undefined && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2">
          <span className="text-meta text-foreground">{justSaved.words}</span>
          <span className="flex items-center gap-2">
            {undoing.error !== undefined && (
              <span className="text-meta text-destructive">{undoing.error}</span>
            )}
            <Button
              variant="quiet"
              size="xs"
              busy={undoing.busy}
              busyLabel="Undoing…"
              onClick={() => void undoing.run()}
            >
              Undo
            </Button>
          </span>
        </footer>
      )}
      <Sheet
        title={sheetTitle}
        open={open !== undefined}
        onClose={close}
        from={cover ? "bottom" : "right"}
      >
        {open?.kind === "old" ? (
          <OldSizesList oldSizes={space.oldSizes} confirm={confirm} />
        ) : open !== undefined ? (
          <SizeForm
            line={open.kind === "line" ? open.line : undefined}
            thing={open.thing}
            save={async (saving) =>
              save(saving.kind === "add" && open.kind === "add" ? saving.property : sheetTitle)(
                saving,
              )
            }
            now={now}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
