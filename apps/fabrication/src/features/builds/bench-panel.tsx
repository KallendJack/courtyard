import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { X } from "lucide-react";
import { lazy, Suspense } from "react";
import { CloseUp } from "./close-up.tsx";
import type { Progress } from "./progress.ts";
import { StepStrip } from "./step-panel.tsx";
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

/** The Build at a step (#699): the step, with its picture (#754), and the way to another step. */
export type AtStep = { step: BuildStep; progress: Progress };

/**
 * The Build in 3D (#698; the board's middle panel): drag to turn it, tap a part or its letter in
 * the key for its card. While the steps show (#699), it's the step's picture (#754): the job as
 * it's done, with the step strip above and the step's close-up below.
 */
export function BenchPanel(props: {
  name: string;
  derived: DerivedBuild;
  lit: string | undefined;
  pick: (label: string) => void;
  atStep?: AtStep | undefined;
  /** Whether the close-up goes under the 3D view: not on the cover screen, where the step has it. */
  closeUp?: boolean;
}) {
  const { derived, lit, pick, atStep } = props;
  const closeUp = props.closeUp === false ? null : atStep?.step.closeUp;
  return (
    <section aria-label="In 3D" className="flex min-h-0 flex-1 flex-col gap-3">
      {atStep === undefined ? (
        <div className="flex items-baseline justify-between gap-3">
          <CapsLabel tone="muted" heading={{ level: 2 }}>
            {props.name}
          </CapsLabel>
          <span className="text-meta text-muted-foreground">Drag to turn</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <CapsLabel tone="muted" heading={{ level: 2 }} className="min-w-0 truncate">
            Step {atStep.step.number} · {atStep.step.title}
          </CapsLabel>
          <StepStrip derived={derived} step={atStep.step} progress={atStep.progress} />
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={null}>
          <BenchView
            derived={derived}
            lit={lit}
            scene={atStep?.step.scene}
            sceneId={atStep?.step.id ?? "whole"}
            pick={pick}
          />
        </Suspense>
        {lit !== undefined && (
          <div className="absolute inset-x-0 bottom-0">
            <PartCard derived={derived} label={lit} close={() => pick(lit)} />
          </div>
        )}
      </div>
      {closeUp !== undefined && closeUp !== null && (
        <div className="flex max-h-[45%] shrink-0">
          <CloseUp closeUp={closeUp} parts={derived.parts} />
        </div>
      )}
      {/* At a step, the letters on the parts are the key, and the 3D view keeps the room. */}
      <ul
        aria-label="Parts"
        className={classes("flex flex-wrap gap-x-3 gap-y-1", atStep !== undefined && "hidden")}
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
