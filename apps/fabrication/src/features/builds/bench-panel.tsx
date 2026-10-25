import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { RotateCcw, X } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { CloseUp } from "./close-up.tsx";
import type { InView } from "./progress.ts";
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

/** The Build at a step (#699): the step, and how it shows in 3D. */
export type AtStep = { step: BuildStep; view: InView };

/**
 * The Build in 3D (#698; #753's boards): fitted to its panel, drag to turn it, Reset view to turn
 * it back, and tap a part or its letter for its card. While the steps show (#699), it's the Build
 * up to the step reached. Along its foot, what the page puts there (Hold to ask) and Reset view;
 * on a computer, the step's close-up below it and the parts' key.
 */
export function BenchPanel(props: {
  name: string;
  derived: DerivedBuild;
  lit: string | undefined;
  pick: (label: string) => void;
  atStep?: AtStep | undefined;
  /** Whether the step's close-up goes under the 3D view: only on a computer. */
  closeUp?: boolean;
  /** Whether the parts' key goes under it: only on a computer, with room for it. */
  withKey?: boolean;
  /** Whether it has Reset view: not on the cover screen, where the panel is small. */
  resettable?: boolean;
  /** What sits at the view's foot, left of Reset view: Hold to ask. */
  children?: ReactNode;
  /** What shows over the top of the view in place of a part's card: an answer. */
  over?: ReactNode;
}) {
  const { derived, lit, pick, atStep, resettable = true } = props;
  const [reset, setReset] = useState(0);
  const closeUp = props.closeUp === true ? atStep?.step.closeUp : null;
  const over =
    props.over ??
    (lit === undefined ? undefined : (
      <PartCard derived={derived} label={lit} close={() => pick(lit)} />
    ));
  return (
    <section aria-label="In 3D" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <CapsLabel tone="muted" heading={{ level: 2 }} className="min-w-0 truncate">
          {atStep === undefined ? props.name : `Step ${atStep.step.number} · ${atStep.step.title}`}
        </CapsLabel>
        <span className="shrink-0 text-meta text-muted-foreground">
          {atStep === undefined ? "Drag to turn · tap a part" : "Drag to turn"}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={null}>
          <BenchView derived={derived} lit={lit} view={atStep?.view} pick={pick} reset={reset} />
        </Suspense>
        {over !== undefined && over !== null && (
          // Over the view, clear of its foot, as tall as what's in it.
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-18 flex flex-col *:pointer-events-auto">
            {over}
          </div>
        )}
        <div
          className={classes(
            "pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 *:pointer-events-auto",
            resettable ? "justify-between" : "justify-end",
          )}
        >
          {props.children}
          {resettable && (
            <Button variant="outline" size="lg" onClick={() => setReset((count) => count + 1)}>
              <RotateCcw aria-hidden />
              Reset view
            </Button>
          )}
        </div>
      </div>
      {closeUp !== undefined && closeUp !== null && (
        <div className="flex max-h-[45%] shrink-0">
          <CloseUp closeUp={closeUp} parts={derived.parts} />
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
