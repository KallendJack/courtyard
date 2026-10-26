import { type BuildStep, type DerivedBuild, tickedIn } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Camera, Check, Lightbulb, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Disclosure } from "@/components/disclosure";
import { CloseUp, Techniques } from "./close-up.tsx";
import { LengthBar } from "./cut-plan.tsx";
import { Findings } from "./findings.tsx";
import { type Detail, type Progress, useDetail } from "./progress.ts";
import { chipOf, listed, stepFindings, wayChanges } from "./words.ts";

// A Build's steps as an instruction manual (#699; Paper, 2 · Agreed, "Fabrication · Build steps
// v2, teaching · Tablet (#699)" and "· Build steps, cutting by your tools · Tablet (#699)"): one
// step at a time, a checklist of one action a line, the words a beginner may not know a tap away,
// the check before moving on, the tools to hand, and Back and Done big enough for dusty hands.

/** A step's sentence with the words it uses as buttons that say what they mean. */
function WithWords(props: {
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
function Ways(props: { ways: BuildStep["ways"] }) {
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

/**
 * What "show me how" walks through first (#777): each move in order, numbered, with its close-up
 * where one shows it (the tape's hook, the square's stock).
 */
function WalkThrough(props: { step: BuildStep; parts: DerivedBuild["parts"]; big: boolean }) {
  if (props.step.walkThrough.length === 0) return null;
  return (
    <section aria-label="How it's done" className="flex flex-col gap-2">
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        How it's done
      </CapsLabel>
      <ol className="flex flex-col gap-3">
        {props.step.walkThrough.map((move, at) => (
          <li key={move.title} className="flex flex-col gap-2">
            <p className={classes("text-foreground", props.big ? "text-bench" : "text-answer")}>
              <span className="font-bold">
                {at + 1}. {move.title}:
              </span>{" "}
              {move.says}
            </p>
            {move.closeUp !== null && <CloseUp closeUp={move.closeUp} parts={props.parts} narrow />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "Show me how" or "Just the numbers". */
function DetailSwitch(props: { detail: Detail; choose: (detail: Detail) => void }) {
  const options = [
    { detail: "how", name: "Show me how" },
    { detail: "numbers", name: "Just the numbers" },
  ] as const;
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">Detail</legend>
      {options.map((option) => (
        <button
          key={option.detail}
          type="button"
          aria-pressed={props.detail === option.detail}
          onClick={() => props.choose(option.detail)}
          className={classes(
            "min-h-11 rounded-row border px-3 text-interface",
            props.detail === option.detail
              ? "border-primary bg-primary/15 font-semibold text-foreground"
              : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {option.name}
        </button>
      ))}
    </fieldset>
  );
}

/** One action a line: ticked lines go grey, and the first not ticked is the one to do now. */
function Checklist(props: {
  step: BuildStep;
  detail: Detail;
  ticked: readonly number[];
  tick: (line: number) => void;
  openWord: (word: string) => void;
  big: boolean;
}) {
  const { step, ticked, big } = props;
  const now = step.actions.findIndex((_, line) => !ticked.includes(line));
  return (
    <ul aria-label="Checklist" className="flex flex-col gap-1">
      {step.actions.map((action, line) => {
        const done = ticked.includes(line);
        const text = props.detail === "how" ? action.howTo : action.numbers;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a step's lines are in a fixed order.
          <li key={line}>
            <div
              className={classes(
                "flex items-start gap-3 rounded-row px-2.5 py-2",
                line === now && "bg-primary/15",
              )}
            >
              <span className={classes("relative flex shrink-0", big ? "size-8" : "size-7")}>
                <input
                  type="checkbox"
                  checked={done}
                  aria-label={`Line ${line + 1} done`}
                  onChange={() => props.tick(line)}
                  className={classes(
                    "appearance-none rounded-md border-2",
                    big ? "size-8" : "size-7",
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
                    className={classes(
                      "pointer-events-none absolute text-background",
                      big ? "inset-1.5 size-5" : "inset-1.5 size-4",
                    )}
                  />
                )}
              </span>
              <p
                className={classes(
                  "min-w-0 flex-1 pt-0.5",
                  big ? "text-bench" : "text-answer",
                  done
                    ? "text-muted-foreground line-through"
                    : line === now
                      ? "font-semibold text-foreground"
                      : "text-foreground",
                )}
              >
                <WithWords text={text} words={step.words} open={props.openWord} />
              </p>
            </div>
            {action.length !== undefined && (
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
function Tips(props: { tips: readonly string[]; big: boolean }) {
  if (props.tips.length === 0) return null;
  return (
    <Disclosure
      look="row"
      big={props.big}
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

/** The step's tools as chips, as the bench board has them: ticked, or gold to check. */
function ToolChips(props: { step: BuildStep; big: boolean }) {
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
              "flex items-center gap-2 rounded-full border px-4 font-semibold",
              props.big ? "h-11 text-interface" : "h-9 text-meta",
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

/** How to know it's right before moving on, and a photo of it to the chat to have it checked. */
function BeforeMovingOn(props: { step: BuildStep; sendPhoto: (photo: File) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <section
      aria-label="Before you move on"
      className="flex flex-col gap-2 rounded-card border border-border p-4"
    >
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        Before you move on
      </CapsLabel>
      <p className="text-answer text-foreground">{props.step.check.says}</p>
      <div>
        <Button variant="soft" size="md" onClick={() => picker.current?.click()}>
          <Camera aria-hidden />
          Send a photo to check
        </Button>
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Photo to check"
        className="hidden"
        onChange={(event) => {
          const photo = event.target.files?.[0];
          event.target.value = "";
          if (photo !== undefined) props.sendPhoto(photo);
        }}
      />
    </section>
  );
}

/**
 * The step reached, as the instruction manual shows it (#699; at the bench, #753): which step and
 * how long it takes, its title and how to batch it, its checklist, a word's meaning when tapped,
 * its tips behind a tap (#789), its tools, its
 * fixings, what's left before moving on (`children`: its close-up), its techniques in full the
 * first time or a "how?" tap (#813), the check before moving on,
 * and how it's done and how much is said. `big` at the bench on the unfolded Fold, read at arm's
 * length.
 */
export function StepPanel(props: {
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
  sendPhoto: (photo: File) => void;
  big?: boolean;
  children?: ReactNode;
}) {
  const { derived, step, progress } = props;
  const big = props.big === true;
  const [detail, choose] = useDetail();
  const [word, setWord] = useState<string>();
  const meaning = derived.glossary.find((each) => each.word === word);
  // How the steps are done now Your tools have changed, said whichever step is showing.
  const changes = wayChanges(derived);
  return (
    <section aria-label="Steps" className="flex min-w-0 flex-col gap-4 pb-2">
      <div className="flex flex-col gap-1.5">
        <CapsLabel tone="primary">
          Step {step.number} of {derived.steps.length} · about {step.minutes} min
          {step.helper ? " · needs a helper" : ""}
        </CapsLabel>
        <h2
          className={classes(
            "display-title text-foreground",
            big ? "text-step" : "text-sheet-title",
          )}
        >
          {step.title}
        </h2>
        <p className={classes("text-muted-foreground", big ? "text-answer" : "text-interface")}>
          {step.batch}
        </p>
      </div>
      {changes.map((change) => (
        <p key={change} className="text-interface text-primary-text">
          {change}
        </p>
      ))}
      {detail === "how" && <WalkThrough step={step} parts={derived.parts} big={big} />}
      <Checklist
        step={step}
        detail={detail}
        ticked={tickedIn(progress.progress, step.id)}
        tick={progress.tick}
        openWord={setWord}
        big={big}
      />
      {meaning !== undefined && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-row border border-primary/35 bg-popover p-3.5"
        >
          <p className="min-w-0 flex-1 text-interface text-foreground">
            <span className="font-bold capitalize">{meaning.word}:</span> {meaning.means}
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setWord(undefined)}
            className="rounded-full p-1 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
      <Tips tips={step.tips} big={big} />
      <ToolChips step={step} big={big} />
      {step.fixings.length > 0 && (
        <p className={classes("text-muted-foreground", big ? "text-answer" : "text-interface")}>
          Fixings:{" "}
          <span className="text-foreground">
            {/* "5 × 80 screws (16)": a count before a size would read as one more size. */}
            {listed(step.fixings.map((fixing) => `${fixing.name} (${fixing.count})`))}
          </span>
        </p>
      )}
      <Findings findings={stepFindings(derived, step)} label="To check in this step" />
      {props.children}
      <Techniques step={step} parts={derived.parts} />
      <BeforeMovingOn step={step} sendPhoto={props.sendPhoto} />
      <Ways ways={step.ways} />
      <DetailSwitch detail={detail} choose={choose} />
    </section>
  );
}
