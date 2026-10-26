import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { RotateCcw, X } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { CloseUp } from "./close-up.tsx";
import { CloseUpCard } from "./picture/close-up-card.tsx";
import { WhereThisGoes } from "./picture/where-this-goes.tsx";
import { cutFrom, listed, partSize, stepsUsing } from "./words.ts";

/** The 3D view, with `three`, in a file of its own: only a Build's page loads it. */
const BenchView = lazy(() => import("./bench-view.tsx"));

/**
 * A part's card (#698, the owner's comment): its letter, name and count, its size, what it's cut
 * from, the steps that use it and what it does. Tapping the part again, or ×, closes it.
 */
function PartCard(props: { derived: DerivedBuild; label: string; close: () => void }) {
  const part = props.derived.parts.find((each) => each.label === props.label);
  if (part === undefined) return null;
  const steps = stepsUsing(props.derived, part.label);
  return (
    <section
      aria-label={`${part.label}, ${part.name}`}
      className="flex flex-col gap-1.5 rounded-row border border-primary/35 bg-popover p-3.5 shadow-raised"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-meta font-bold text-primary-foreground">
          {part.label}
        </span>
        <p className="min-w-0 flex-1 pt-0.5 text-interface font-bold text-foreground">
          {part.name} × {part.count}
        </p>
        <IconButton
          label="Close"
          look="quiet"
          size="sm"
          icon={<X aria-hidden />}
          onClick={props.close}
        />
      </div>
      <p className="text-meta text-foreground/90">{part.does}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-meta">
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono text-foreground">{partSize(part)}</dd>
        <dt className="text-muted-foreground">Cut from</dt>
        <dd className="text-foreground">{cutFrom(props.derived, part)}</dd>
        {steps.length > 0 && (
          <>
            <dt className="text-muted-foreground">{steps.length === 1 ? "Step" : "Steps"}</dt>
            <dd className="text-foreground">{listed(steps.map(String))}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** The Build at a step (#699): the step, with its picture (#754). */
export type AtStep = { step: BuildStep };

/** The most close-ups beside the model at the bench, at the board's size (#826). */
const AT_THE_BENCH = 2;

/**
 * The Build in 3D (#698; #753's boards): fitted to its panel, drag to turn it, Reset view to turn
 * it back, and tap a part or its letter for its card. While the steps show (#699), it's the step's
 * picture (#754): the job as it's done. Along its foot, what the page puts there (Hold to ask)
 * and Reset view; on a computer, the step's close-up below it and the parts' key. At the bench
 * (#826, its boards), titled with what the picture shows, with no Reset view; unfolded, the
 * step's close-ups as cards under the model (or beside it, for diagrams read top to bottom) and
 * where its pieces go in the corner.
 */
export function BenchPanel(props: {
  name: string;
  derived: DerivedBuild;
  lit: string | undefined;
  pick: (label: string) => void;
  atStep?: AtStep | undefined;
  /** Whether the step's close-ups go under the 3D view: only on a computer. */
  closeUp?: boolean;
  /** Whether the parts' key goes under it: only on a computer, with room for it. */
  withKey?: boolean;
  /** Whether it has Reset view: not on the cover screen, where the panel is small. */
  resettable?: boolean;
  /** Whether it's beside a step at the bench, as its boards draw it (#826): no Reset view. */
  bench?: boolean;
  /**
   * Whether the step's close-ups and where it goes show as cards over the model at the bench: not
   * folded, where the model needs the room and the close-ups are under Show me how.
   */
  withCards?: boolean;
  /** What sits at the view's foot, left of Reset view: Hold to ask. */
  children?: ReactNode;
  /** What shows over the view in place of a part's card: an answer, at its foot. */
  over?: ReactNode;
}) {
  const { derived, lit, pick, atStep } = props;
  const bench = props.bench === true && atStep !== undefined;
  const resettable = props.resettable !== false && !bench;
  const [reset, setReset] = useState(0);
  const closeUps = props.closeUp === true ? (atStep?.step.closeUps ?? []) : [];
  const cards = bench && props.withCards === true;
  // Folded at the bench, Hold to ask sits in the picture's heading, clear of the model.
  const askAbove = bench && !cards;
  const benchCloseUps = cards ? atStep.step.closeUps.slice(0, AT_THE_BENCH) : [];
  // Diagrams with headed words (a bolt, tightened and apart) read top to bottom, so they stack in
  // a column beside the model, as the castors' board has them; pictures sit in a row under it.
  const column =
    benchCloseUps.length > 0 &&
    benchCloseUps.every((closeUp) => (closeUp.labels ?? []).some((label) => label.heading));
  const over =
    props.over ??
    (lit === undefined ? undefined : (
      <PartCard derived={derived} label={lit} close={() => pick(lit)} />
    ));
  const view = (
    <Suspense fallback={null}>
      <BenchView
        derived={derived}
        lit={lit}
        scene={atStep?.step.scene ?? undefined}
        sceneId={atStep?.step.id ?? "whole"}
        pick={pick}
        reset={reset}
        bench={bench}
        pills={cards}
      />
    </Suspense>
  );
  // What's over the view: a part's card or an answer, and along its foot Hold to ask and Reset view.
  const overIt = (
    <>
      {over !== undefined && over !== null && (
        // Clear of the foot, as tall as what's in it: a part's card at the top, an answer just
        // above Hold to ask (#793's board).
        <div
          className={classes(
            "pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col *:pointer-events-auto",
            askAbove ? "bottom-0" : "bottom-18",
            props.over !== undefined && props.over !== null && "justify-end",
          )}
        >
          {over}
        </div>
      )}
      <div
        className={classes(
          "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end gap-3 *:pointer-events-auto",
          resettable ? "justify-between" : "justify-start",
        )}
      >
        {!askAbove && props.children}
        {resettable && (
          <Button variant="outline" size="lg" onClick={() => setReset((count) => count + 1)}>
            <RotateCcw aria-hidden />
            Reset view
          </Button>
        )}
      </div>
    </>
  );
  return (
    <section aria-label="In 3D" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div
        className={classes(
          "flex justify-between gap-3",
          askAbove ? "-mt-1.5 items-center" : "items-baseline",
        )}
      >
        <CapsLabel tone="muted" heading={{ level: 2 }} className="min-w-0 truncate">
          {atStep === undefined
            ? props.name
            : bench
              ? (atStep.step.scene?.title ?? atStep.step.title)
              : `Step ${atStep.step.number} · ${atStep.step.title}`}
        </CapsLabel>
        {askAbove ? (
          props.children
        ) : (
          <span className="shrink-0 text-meta text-muted-foreground">
            {atStep === undefined ? "Drag to turn · tap a part" : "Drag to turn"}
          </span>
        )}
      </div>
      {bench ? (
        // At the bench, Hold to ask and an answer sit over the close-ups too, as the board has them.
        // Folded, with no cards, Hold to ask sits over the model, which keeps the room.
        <div className={classes("relative flex min-h-0 flex-1 flex-col gap-3", cards && "pb-14")}>
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              {view}
              {cards && !column && <WhereThisGoes derived={derived} step={atStep.step} />}
            </div>
            {column && (
              <div className="flex w-46 shrink-0 flex-col gap-3 *:flex-1">
                {benchCloseUps.map((closeUp) => (
                  <CloseUpCard key={closeUp.title} closeUp={closeUp} parts={derived.parts} />
                ))}
              </div>
            )}
          </div>
          {!column && benchCloseUps.length > 0 && (
            <div className="flex h-38 shrink-0 gap-3 *:flex-1 *:last:flex-[0.6]">
              {benchCloseUps.map((closeUp) => (
                <CloseUpCard key={closeUp.title} closeUp={closeUp} parts={derived.parts} />
              ))}
            </div>
          )}
          {overIt}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {view}
          {overIt}
        </div>
      )}
      {closeUps.length > 0 && (
        <div className="flex max-h-[45%] shrink-0 gap-3">
          {closeUps.map((closeUp) => (
            <CloseUp key={closeUp.title} closeUp={closeUp} parts={derived.parts} />
          ))}
        </div>
      )}
      {/* At a step, the letters on the parts are the key, and the 3D view keeps the room. */}
      <ul
        aria-label="Parts"
        className={classes(
          "flex flex-wrap gap-x-3 gap-y-1",
          (props.withKey !== true || atStep !== undefined) && "hidden",
        )}
      >
        {derived.parts.map((part) => (
          <li key={part.label}>
            <button
              type="button"
              aria-pressed={lit === part.label}
              onClick={() => pick(part.label)}
              className={classes(
                "rounded-sm text-meta",
                lit === part.label
                  ? "text-primary-text"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {part.label} {part.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
