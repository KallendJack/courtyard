import { type BuildStep, type DerivedBuild, tickedIn } from "@courtyard/contract";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { Camera, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { BenchAsk } from "../chat/hold-to-ask.tsx";
import { CloseUp, Techniques } from "../close-up.tsx";
import { Findings } from "../findings.tsx";
import { UsesStrip } from "../parts/uses-strip.tsx";
import type { Progress } from "../progress.ts";
import { Tips, WayChanges, Ways } from "../step-panel.tsx";
import { checkQuestion, stepFindings } from "../words.ts";
import { BeforeMovingOn, PhotoPicker, WalkThrough } from "./how.tsx";

/** What a photo sent by Is this right? is, on its answer's card. */
const IS_IT_RIGHT = "Is this right? (a photo)";

/** What's open over the step: Show me how, I don't have…, or Can't do this now's reasons. */
export type Open = "how" | "missing" | "why";

/** Why a step can't be done now (#792's three): missing something opens I don't have…. */
const WHY_NOT = ["Went wrong", "Out of time"] as const;

/** Something the step needs that the owner may not have: a tool, or a part or fixing. */
type Needed = { name: string; standIn: string | undefined; tool: boolean };

/** The step's own tools and parts, nothing else's (#793): its tools, its parts by name, its fixings. */
const neededFor = (derived: DerivedBuild, step: BuildStep): Needed[] => [
  ...[...step.tools, ...step.safety].map((tool) => ({
    name: tool.name,
    standIn: tool.standIn,
    tool: true,
  })),
  ...step.parts.map((label) => {
    const part = derived.parts.find((each) => each.label === label);
    return {
      name: part === undefined ? label : `${part.name} (${label})`,
      standIn: undefined,
      tool: false,
    };
  }),
  ...step.fixings.map((fixing) => ({ name: fixing.name, standIn: undefined, tool: false })),
];

/** I don't have…: the step's tools and parts to pick, then the stand-in from Your tools, or Park. */
function Missing(props: { needed: Needed[]; park: (why: string) => void }) {
  const [picked, pick] = useState<Needed>();
  if (picked !== undefined) {
    return (
      <>
        <CapsLabel tone="muted" heading={{ level: 3 }}>{`No ${picked.name}`}</CapsLabel>
        <p className="text-answer text-foreground">
          {picked.standIn !== undefined
            ? `Your ${picked.standIn.toLowerCase()} will do instead.`
            : picked.tool
              ? "Nothing in Your tools will do instead."
              : "Nothing will do instead."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="needsOutline"
            size="lg"
            onClick={() => props.park(`Missing: ${picked.name}`)}
          >
            Park this step
          </Button>
          <Button variant="quiet" size="lg" onClick={() => pick(undefined)}>
            Something else
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        Which don't you have?
      </CapsLabel>
      <div className="flex flex-wrap gap-2">
        {props.needed.map((each) => (
          <Button key={each.name} variant="outline" size="lg" onClick={() => pick(each)}>
            {each.name}
          </Button>
        ))}
      </div>
    </>
  );
}

/** Each panel a button opens, by name for screen readers. */
const OPENED: Readonly<Record<Open, string>> = {
  how: "How it's done, close up",
  missing: "What you don't have",
  why: "Why not now",
};

/**
 * What a step's button opens (#793), over the step rather than down it (#826): Show me how's
 * what the step uses first (#778), then its walk-through, close-ups, techniques, tips and check,
 * everything the board leaves off the step; I don't have…'s list; or why it can't be done now.
 * Its own title and ×, and it scrolls itself when it's long.
 */
export function StepOpened(props: {
  open: Open;
  setOpen: (open: Open | undefined) => void;
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
}) {
  const { open, derived, step, progress } = props;
  const park = (why: string) => {
    props.setOpen(undefined);
    progress.park(why);
  };
  let body: ReactNode;
  if (open === "how") {
    body = (
      <>
        <UsesStrip
          step={step}
          done={tickedIn(progress.progress, step.id).length >= step.actions.length}
          bench
        />
        <WayChanges derived={derived} />
        <WalkThrough step={step} parts={derived.parts} />
        {step.closeUps.map((closeUp) => (
          <CloseUp key={closeUp.title} closeUp={closeUp} parts={derived.parts} narrow />
        ))}
        <Techniques step={step} parts={derived.parts} />
        <Findings findings={stepFindings(derived, step)} label="To check in this step" />
        <Tips tips={step.tips} />
        <BeforeMovingOn step={step} />
        <Ways ways={step.ways} />
      </>
    );
  } else if (open === "missing") {
    body = <Missing needed={neededFor(derived, step)} park={park} />;
  } else {
    body = (
      <>
        <CapsLabel tone="muted" heading={{ level: 3 }}>
          Why not now?
        </CapsLabel>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={() => props.setOpen("missing")}>
            Missing something
          </Button>
          {WHY_NOT.map((why) => (
            <Button key={why} variant="outline" size="lg" onClick={() => park(why)}>
              {why}
            </Button>
          ))}
        </div>
      </>
    );
  }
  return (
    <section
      aria-label={OPENED[open]}
      className="absolute inset-0 z-10 flex flex-col gap-3 rounded-card border border-border bg-popover p-4"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h3 className="display-section text-interface text-foreground">{step.title}</h3>
        <IconButton
          label="Close"
          icon={<X aria-hidden />}
          onClick={() => props.setOpen(undefined)}
        />
      </div>
      <Scroller className="flex min-h-0 flex-1 flex-col gap-4">{body}</Scroller>
    </section>
  );
}

/**
 * The step's four buttons under its lines (#793; Paper, 2 · Agreed, "Fabrication · Asking at the
 * bench: step buttons + answer card · Fold (#793)"), so asking never leaves the step: Show me how,
 * I don't have… and Can't do this now open over the step (`StepOpened`); Is this right? takes a
 * photo, checked against the step, its answer over the picture. A parked step says why, with Do
 * it now.
 */
export function StepButtons(props: {
  step: BuildStep;
  progress: Progress;
  open: Open | undefined;
  toggle: (which: Open) => void;
  /** Is this right?: the photo, asked about against this step; why it couldn't go, if it didn't. */
  check: (ask: BenchAsk) => Promise<string | undefined>;
}) {
  const { step, progress, open, toggle } = props;
  const [problem, setProblem] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      {progress.parked !== undefined && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-row border border-warning/50 bg-warning/10 px-3.5 py-2"
        >
          <p className="min-w-0 flex-1 text-interface text-warning">Parked: {progress.parked}</p>
          <Button variant="needsOutline" size="sm" onClick={progress.unpark}>
            Do it now
          </Button>
        </div>
      )}
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">This step</legend>
        <Button
          variant="outline"
          size="snug"
          aria-expanded={open === "how"}
          onClick={() => toggle("how")}
        >
          Show me how
        </Button>
        <Button variant="outline" size="snug" onClick={() => picker.current?.click()}>
          Is this right?
          <Camera aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="snug"
          aria-expanded={open === "missing"}
          onClick={() => toggle("missing")}
        >
          I don't have…
        </Button>
        <Button
          variant="needsOutline"
          size="snug"
          aria-expanded={open === "why"}
          onClick={() => toggle("why")}
        >
          Can't do this now
        </Button>
      </fieldset>
      <PhotoPicker
        picker={picker}
        sendPhoto={(photo) => {
          setProblem(undefined);
          const ask = { text: checkQuestion(step), said: IS_IT_RIGHT, files: [photo] };
          void props.check(ask).then(setProblem);
        }}
      />
      {problem !== undefined && (
        <p role="alert" className="text-meta text-warning">
          {problem}
        </p>
      )}
    </>
  );
}
