import {
  type BuildSlug,
  type Project,
  type ProjectStep,
  type StepWho,
  unknownNeedsOf,
  type WorkspaceId,
} from "@courtyard/contract";
import { buttonLook } from "@courtyard/ui/buttons/button.tsx";
import { Chip, type ChipTone } from "@courtyard/ui/buttons/chip.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { useId, useState } from "react";
import { dayWords } from "@/lib/when";

/**
 * A step's Build opened in Fabrication (#698), its own app beside Courtyard: a page load, not a
 * move within Courtyard.
 */
export function OpenInFabrication(props: { workspaceId: WorkspaceId; build: BuildSlug }) {
  const href = `/fabrication/workspaces/${encodeURIComponent(props.workspaceId)}/builds/${props.build}`;
  return (
    <a href={href} className={classes(buttonLook({ variant: "soft", size: "row" }), "shrink-0")}>
      Open in Fabrication
    </a>
  );
}

/** Who does a step, as its chip says it, by what its colour means (AGENTS.md): violet the owner's, gold a pro. */
export const WHO: Readonly<Record<StepWho, { label: string; tone: ChipTone }>> = {
  you: { label: "You", tone: "owner" },
  "a pro": { label: "A pro", tone: "needs" },
  courtyard: { label: "Courtyard", tone: "quiet" },
};

/** What a step still needs before it's ready, in a line: "Not ready yet: needs the wall's construction". */
export const notReadyWords = (step: ProjectStep) => {
  const unknown = unknownNeedsOf(step);
  return unknown.length === 0
    ? undefined
    : `Not ready yet: needs ${unknown.map(({ what }) => what).join("; ")}`;
};

type StepState = "done" | "next" | "not ready" | "to do";

/** A step's ring: ticked in moss once done, violet when it's next, dashed gold when it isn't ready. */
const MARKS: Readonly<Record<StepState, { label: string; look: string }>> = {
  done: { label: "Done", look: "bg-success text-background" },
  next: { label: "Next", look: "border-2 border-primary bg-primary/12" },
  "not ready": { label: "Not ready yet", look: "border-2 border-dashed border-warning" },
  "to do": { label: "To do", look: "border-2 border-muted-foreground" },
};

function StepRow(props: { workspaceId: WorkspaceId; step: ProjectStep; next: boolean }) {
  const { step, next } = props;
  const notReady = step.done ? undefined : notReadyWords(step);
  const state: StepState = step.done
    ? "done"
    : notReady !== undefined
      ? "not ready"
      : next
        ? "next"
        : "to do";
  // The Next card above gives the next step's detail, so its row leaves it out. On a line of its
  // own a detail starts with a capital, though it's written to follow "You · ".
  const sub = step.done
    ? undefined
    : notReady !== undefined
      ? { words: notReady, look: "text-warning" }
      : step.build !== undefined
        ? { words: `A Build: ${step.build}`, look: "text-primary-text" }
        : next || step.detail === undefined
          ? undefined
          : {
              words: step.detail.charAt(0).toUpperCase() + step.detail.slice(1),
              look: "text-muted-foreground",
            };
  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-border py-2">
      <span
        role="img"
        aria-label={MARKS[state].label}
        className={classes(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          MARKS[state].look,
        )}
      >
        {state === "done" && (
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
            <path
              d="M2.5 6.5 5 9l4.5-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="flex min-w-0 grow flex-col">
        <span
          className={classes(
            "text-sm/4.5 wrap-anywhere",
            step.done ? "text-muted-foreground" : "text-foreground",
            !step.done && step.build !== undefined && "font-semibold",
          )}
        >
          {step.text}
        </span>
        {sub !== undefined && <span className={classes("text-label", sub.look)}>{sub.words}</span>}
      </span>
      {!step.done && !next && step.build !== undefined && (
        <OpenInFabrication workspaceId={props.workspaceId} build={step.build} />
      )}
      <span className="flex w-30 shrink-0 justify-end">
        {step.done ? (
          <span className="text-label text-muted-foreground">
            {step.doneOn === undefined ? "Done" : `Done ${dayWords(step.doneOn)}`}
          </span>
        ) : (
          <Chip tone={WHO[step.who].tone}>{WHO[step.who].label}</Chip>
        )}
      </span>
    </li>
  );
}

/**
 * A project's steps (#710; Paper, "Tablet · Project page: steps (#710)"): how many are done, then
 * each, ticked once done, the next in violet, one not ready in gold saying what it needs, and who
 * does each. Then its decisions, folded into one row that opens to show each.
 */
export function ProjectSteps(props: {
  workspaceId: WorkspaceId;
  project: Project;
  next: ProjectStep | undefined;
}) {
  const { steps, decisions } = props.project;
  const done = steps.filter((step) => step.done).length;
  const [open, setOpen] = useState(false);
  const decisionsId = useId();
  return (
    <>
      {steps.length > 0 && (
        <section aria-labelledby="project-steps" className="flex flex-col gap-1">
          <div className="px-0.5 pt-1">
            <CapsLabel tone="muted" heading={{ level: 3, id: "project-steps" }}>
              {`Steps · ${done} of ${steps.length} done`}
            </CapsLabel>
          </div>
          <ul className="flex flex-col">
            {steps.map((step) => (
              <StepRow
                key={step.id}
                workspaceId={props.workspaceId}
                step={step}
                next={step === props.next}
              />
            ))}
          </ul>
        </section>
      )}
      {decisions.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={decisionsId}
            onClick={() => setOpen((was) => !was)}
            className="flex h-10 items-center justify-between gap-3 rounded-row bg-secondary px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 text-sm/4.5 text-foreground">Decisions</span>
            <span className="min-w-0 truncate text-meta text-muted-foreground">
              {`${decisions.length} made · ${decisions.map(({ about }) => about).join(", ")}`}
            </span>
          </button>
          {open && (
            <ul id={decisionsId} aria-label="Decisions" className="flex flex-col px-3.5">
              {decisions.map(({ about, pick }) => (
                <li key={about} className="flex flex-col border-b border-border py-2">
                  <span className="text-label text-muted-foreground">{about}</span>
                  <span className="text-sm/4.5 text-foreground">{pick}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
