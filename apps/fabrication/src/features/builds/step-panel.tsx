import { type BuildStep, type DerivedBuild, tickedIn } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check, Lightbulb, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Disclosure } from "@/components/disclosure";
import { Techniques } from "./close-up.tsx";
import { LengthBar } from "./cut-plan.tsx";
import { Findings } from "./findings.tsx";
import { type Detail, type Progress, useDetail } from "./progress.ts";
import { BeforeMovingOn, WalkThrough } from "./step/how.tsx";
import { chipOf, listed, stepFindings, wayChanges } from "./words.ts";

// A Build's steps as an instruction manual (#699; Paper, 2 · Agreed, "Fabrication · Build steps
// v2, teaching · Tablet (#699)" and "· Build steps, cutting by your tools · Tablet (#699)"): one
// step at a time, a checklist of one action a line, the words a beginner may not know a tap away,
// the check before moving on, the tools to hand, and Back and Done big enough for dusty hands.

/** A step's sentence with the words it uses as buttons that say what they mean. */
export function WithWords(props: {
  text: string;
  words: readonly string[];
  open: (word: string) => void;
}): ReactNode {
  const words = [...props.words].sort((a, b) => b.length - a.length);
  if (words.length === 0) return props.text;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pieces = props.text.split(new RegExp(`\\b(${escaped.join("|")})\\b`, "i"));
  return pieces.map((piece, at) => {
    const word = words.find((each) => each.toLowerCase() === piece.toLowerCase());
    // Split keeps the words it splits on at the odd places.
    if (at % 2 === 0 || word === undefined) return piece;
    return (
      <button
        // biome-ignore lint/suspicious/noArrayIndexKey: a sentence's pieces don't move.
        key={at}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          props.open(word);
        }}
        className="rounded-sm text-primary-text underline decoration-dotted underline-offset-4"
      >
        {piece}
      </button>
    );
  });
}

/** The ways a step can be done: the one in use, and the others, "not yet" until they're to hand. */
export function Ways(props: { ways: BuildStep["ways"] }) {
  if (props.ways.length === 0) return null;
  return (
    <section aria-label="How you'll do it" className="flex flex-col gap-2">
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        How you'll do it
      </CapsLabel>
      <ul className="grid grid-cols-2 gap-2">
        {props.ways.map((way) => (
          <li
            key={way.name}
            aria-current={way.using ? "true" : undefined}
            className={classes(
              "flex min-h-11 items-center justify-center rounded-row border px-3 text-center text-interface",
              way.using
                ? "border-primary bg-primary/15 font-semibold text-foreground"
                : "border-transparent bg-muted text-muted-foreground",
            )}
          >
            {way.using || way.toHand ? way.name : `${way.name} · not yet`}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One of how much is said, pressed while it's the one chosen. */
function DetailOption(props: { pressed: boolean; press: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      onClick={props.press}
      className={classes(
        "min-h-11 rounded-row border px-4 text-interface",
        props.pressed
          ? "border-primary bg-primary/15 font-semibold text-foreground"
          : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </button>
  );
}

/** "Show me how" or "Just the numbers", beside the steps on a computer. */
function DetailSwitch(props: { detail: Detail; choose: (detail: Detail) => void }) {
  const numbers = props.detail === "numbers";
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">Detail</legend>
      <DetailOption pressed={!numbers} press={() => props.choose("how")}>
        Show me how
      </DetailOption>
      <DetailOption pressed={numbers} press={() => props.choose("numbers")}>
        Just the numbers
      </DetailOption>
    </fieldset>
  );
}

/**
 * One action a line: ticked lines go grey, and the first not ticked is the one to do now. At the
 * bench (#826, its boards), each line is numbered as its badge on the picture is, its box ringed in
 * violet while it's the one to do now, and its marked length is on the picture, not under it.
 */
export function Checklist(props: {
  step: BuildStep;
  detail: Detail;
  ticked: readonly number[];
  tick: (line: number) => void;
  openWord: (word: string) => void;
  bench?: boolean;
}) {
  const { step, ticked } = props;
  const bench = props.bench === true;
  const now = step.actions.findIndex((_, line) => !ticked.includes(line));
  return (
    <ul aria-label="Checklist" className={classes("flex flex-col", bench ? "gap-2.5" : "gap-1")}>
      {step.actions.map((action, line) => {
        const done = ticked.includes(line);
        const text = props.detail === "how" ? action.howTo : action.numbers;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a step's lines are in a fixed order.
          <li key={line}>
            <div
              className={classes(
                "flex items-start gap-3",
                !bench && "rounded-row px-2.5 py-2",
                !bench && line === now && "bg-primary/15",
              )}
            >
              <span className={classes("relative flex shrink-0", bench ? "size-6.5" : "size-7")}>
                <input
                  type="checkbox"
                  checked={done}
                  aria-label={`Line ${line + 1} done`}
                  onChange={() => props.tick(line)}
                  className={classes(
                    "appearance-none border-2",
                    bench ? "size-6.5 rounded-picture" : "size-7 rounded-md",
                    done
                      ? "border-success bg-success"
                      : line === now
                        ? "border-primary"
                        : "border-input",
                  )}
                />
                {done && (
                  <Check
                    aria-hidden
                    className="pointer-events-none absolute inset-1.5 size-4 text-background"
                  />
                )}
              </span>
              <p
                className={classes(
                  "min-w-0 flex-1",
                  bench ? "text-bench" : "pt-0.5 text-answer",
                  done
                    ? "text-muted-foreground line-through"
                    : line === now && !bench
                      ? "font-semibold text-foreground"
                      : "text-foreground",
                )}
              >
                {bench && <span className="pr-2">{line + 1}</span>}
                <WithWords text={text} words={step.words} open={props.openWord} />
              </p>
            </div>
            {action.length !== undefined && !bench && (
              <div className="pt-1 pr-2.5 pb-2 pl-12">
                <LengthBar length={action.length} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Extras for anyone who wants them, closed until tapped, never in the checklist (#789). */
export function Tips(props: { tips: readonly string[] }) {
  if (props.tips.length === 0) return null;
  return (
    <Disclosure
      look="row"
      icon={<Lightbulb aria-hidden className="size-4 text-primary-text" />}
      label="Tips"
    >
      <ul className="flex flex-col gap-2 px-3.5 pb-3.5">
        {props.tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** The step's tools as chips: ticked, or gold to check. */
function ToolChips(props: { step: BuildStep }) {
  const tools = [...props.step.tools, ...props.step.safety];
  if (tools.length === 0) return null;
  return (
    <ul aria-label="Tools for this step" className="flex flex-wrap gap-2">
      {tools.map((tool) => {
        const { says, ready } = chipOf(tool);
        return (
          <li
            // Two chips can be one tool: a spanner on the head, another on the nut (#783).
            key={`${tool.tool} ${tool.name}`}
            className={classes(
              "flex h-9 items-center gap-2 rounded-full border px-4 text-meta font-semibold",
              ready
                ? "border-transparent bg-muted text-foreground"
                : "border-warning/50 bg-warning/10 text-warning",
            )}
          >
            {ready ? (
              <Check aria-hidden className="size-4 text-success" />
            ) : (
              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
            )}
            {says}
          </li>
        );
      })}
    </ul>
  );
}

/** A word tapped in a step's line, and what it means, with × to close it. */
export function Meaning(props: { meaning: { word: string; means: string }; close: () => void }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-row border border-primary/35 bg-popover p-3.5"
    >
      <p className="min-w-0 flex-1 text-interface text-foreground">
        <span className="font-bold capitalize">{props.meaning.word}:</span> {props.meaning.means}
      </p>
      <button
        type="button"
        aria-label="Close"
        onClick={props.close}
        className="rounded-full p-1 text-muted-foreground hover:text-foreground"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** A step's fixings: "5 × 80 screws (16)", a count after its size so it doesn't read as one more. */
export function Fixings(props: { step: BuildStep }) {
  if (props.step.fixings.length === 0) return null;
  return (
    <p className="text-interface text-muted-foreground">
      Fixings:{" "}
      <span className="text-foreground">
        {listed(props.step.fixings.map((fixing) => `${fixing.name} (${fixing.count})`))}
      </span>
    </p>
  );
}

/** How the steps are done now Your tools have changed (#777), said whichever step is showing. */
export function WayChanges(props: { derived: DerivedBuild }) {
  return wayChanges(props.derived).map((change) => (
    <p key={change} className="text-interface text-primary-text">
      {change}
    </p>
  ));
}

/**
 * The step reached, as the instruction manual shows it beside the 3D view on a computer (#699):
 * which step and how long it takes, its title and how to batch it, its walk-through, its
 * checklist, a word's meaning when tapped, its tips behind a tap (#789), its tools, its fixings,
 * its techniques in full the first time or a "how?" tap (#813), the check before moving on with
 * its photo sent by `sendPhoto`, and how it's done and how much is said. At the bench it's
 * `BenchStep`, as its boards have it (#826).
 */
export function StepPanel(props: {
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
  sendPhoto?: (photo: File) => void;
}) {
  const { derived, step, progress } = props;
  const [detail, choose] = useDetail();
  const [word, setWord] = useState<string>();
  const meaning = derived.glossary.find((each) => each.word === word);
  return (
    <section aria-label="Steps" className="flex min-w-0 flex-col gap-4 pb-2">
      <div className="flex flex-col gap-1.5">
        <CapsLabel tone="primary">
          Step {step.number} of {derived.steps.length} · about {step.minutes} min
          {step.helper ? " · needs a helper" : ""}
        </CapsLabel>
        <h2 className="display-title text-sheet-title text-foreground">{step.title}</h2>
        <p className="text-interface text-muted-foreground">{step.batch}</p>
      </div>
      <WayChanges derived={derived} />
      {detail === "how" && <WalkThrough step={step} parts={derived.parts} />}
      <Checklist
        step={step}
        detail={detail}
        ticked={tickedIn(progress.progress, step.id)}
        tick={progress.tick}
        openWord={setWord}
      />
      {meaning !== undefined && <Meaning meaning={meaning} close={() => setWord(undefined)} />}
      <Tips tips={step.tips} />
      <ToolChips step={step} />
      <Fixings step={step} />
      <Findings findings={stepFindings(derived, step)} label="To check in this step" />
      <Techniques step={step} parts={derived.parts} />
      <BeforeMovingOn step={step} sendPhoto={props.sendPhoto} />
      <Ways ways={step.ways} />
      <DetailSwitch detail={detail} choose={choose} />
    </section>
  );
}
