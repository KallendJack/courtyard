import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Camera } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { BenchAsk } from "../chat/hold-to-ask.tsx";
import { CloseUp } from "../close-up.tsx";
import type { Progress } from "../progress.ts";
import { checkQuestion } from "../words.ts";
import { BeforeMovingOn, PhotoPicker, WalkThrough } from "./how.tsx";

/** What a photo sent by Is this right? is, on its answer's card. */
const IS_IT_RIGHT = "Is this right? (a photo)";

/** What's open under the step's buttons: Show me how, I don't have…, or Can't do this now's reasons. */
type Open = "how" | "missing" | "why";

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

/** A panel opened under the buttons, named for screen readers. */
function Opened(props: { label: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-label={props.label}
      className="flex flex-col gap-3 rounded-card border border-border bg-popover p-4"
    >
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        {props.title}
      </CapsLabel>
      {props.children}
    </section>
  );
}

/** I don't have…: the step's tools and parts to pick, then the stand-in from Your tools, or Park. */
function Missing(props: { needed: Needed[]; park: (why: string) => void }) {
  const [picked, pick] = useState<Needed>();
  if (picked !== undefined) {
    return (
      <Opened label="What you don't have" title={`No ${picked.name}`}>
        <p className="text-answer text-foreground">
          {picked.standIn !== undefined
            ? `Your ${picked.standIn.toLowerCase()} will do instead.`
            : picked.tool
              ? `Nothing in Your tools stands in for a ${picked.name}.`
              : `Nothing stands in for the ${picked.name}.`}
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
      </Opened>
    );
  }
  return (
    <Opened label="What you don't have" title="Which don't you have?">
      <div className="flex flex-wrap gap-2">
        {props.needed.map((each) => (
          <Button key={each.name} variant="outline" size="lg" onClick={() => pick(each)}>
            {each.name}
          </Button>
        ))}
      </div>
    </Opened>
  );
}

/**
 * The step's four buttons under its lines (#793; Paper, 2 · Agreed, "Fabrication · Asking at the
 * bench: step buttons + answer card · Fold (#793)"), so asking never leaves the step: Show me how
 * opens its walk-through, close-ups and check; Is this right? takes a photo, checked against the
 * step, its answer over the picture; I don't have… picks one of the step's tools or parts and says
 * what stands in, or parks the step; Can't do this now parks it with why. A parked step says why,
 * with Do it now.
 */
export function StepButtons(props: {
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
  /** Is this right?: the photo, asked about against this step; why it couldn't go, if it didn't. */
  check: (ask: BenchAsk) => Promise<string | undefined>;
  big: boolean;
}) {
  const { derived, step, progress } = props;
  const [open, setOpen] = useState<Open>();
  const [problem, setProblem] = useState<string>();
  const [openFor, setOpenFor] = useState(step.id);
  const picker = useRef<HTMLInputElement>(null);
  // A new step opens with nothing open under its buttons.
  if (openFor !== step.id) {
    setOpenFor(step.id);
    setOpen(undefined);
  }
  const toggle = (which: Open) => setOpen((now) => (now === which ? undefined : which));
  const park = (why: string) => {
    setOpen(undefined);
    progress.park(why);
  };

  return (
    <>
      {progress.parked !== undefined && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-row border border-warning/50 bg-warning/10 p-3.5"
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
          size="thumb"
          aria-expanded={open === "how"}
          onClick={() => toggle("how")}
        >
          Show me how
        </Button>
        <Button variant="outline" size="thumb" onClick={() => picker.current?.click()}>
          Is this right?
          <Camera aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="thumb"
          aria-expanded={open === "missing"}
          onClick={() => toggle("missing")}
        >
          I don't have…
        </Button>
        <Button
          variant="needsOutline"
          size="thumb"
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
      {open === "how" && (
        <>
          <WalkThrough step={step} parts={derived.parts} big={props.big} />
          {step.closeUps.map((closeUp) => (
            <CloseUp key={closeUp.title} closeUp={closeUp} parts={derived.parts} narrow />
          ))}
          <BeforeMovingOn step={step} />
        </>
      )}
      {open === "missing" && <Missing needed={neededFor(derived, step)} park={park} />}
      {open === "why" && (
        <Opened label="Why not now" title="Why not now?">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen("missing")}>
              Missing something
            </Button>
            {WHY_NOT.map((why) => (
              <Button key={why} variant="outline" size="lg" onClick={() => park(why)}>
                {why}
              </Button>
            ))}
          </div>
        </Opened>
      )}
    </>
  );
}
