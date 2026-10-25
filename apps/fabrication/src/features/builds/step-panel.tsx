import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Camera, Check, ChevronRight, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { type Detail, type Progress, tickedIn, useDetail } from "./progress.ts";
import { listed } from "./words.ts";

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
}) {
  const { step, ticked } = props;
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
              <span className="relative flex size-7 shrink-0">
                <input
                  type="checkbox"
                  checked={done}
                  aria-label={`Line ${line + 1} done`}
                  onChange={() => props.tick(line)}
                  className={classes(
                    "size-7 appearance-none rounded-md border-2",
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
                  "min-w-0 flex-1 pt-0.5 text-answer",
                  done
                    ? "text-muted-foreground"
                    : line === now
                      ? "font-semibold text-foreground"
                      : "text-foreground",
                )}
              >
                <WithWords text={text} words={step.words} open={props.openWord} />
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The tools on one line, "4 tools ready · 2 to check", opening to each: ticked, or gold to check. */
function ToolsLine(props: { step: BuildStep }) {
  const [open, setOpen] = useState(false);
  const tools = [...props.step.tools, ...props.step.safety];
  if (tools.length === 0) return null;
  const ready = tools.filter((tool) => tool.toHand).length;
  const check = tools.length - ready;
  return (
    <section aria-label="Tools for this step" className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-12 items-center gap-2 rounded-row bg-muted px-4 text-interface"
      >
        <Check aria-hidden className="size-4 shrink-0 text-success" />
        <span className="font-semibold text-foreground">
          {ready} {ready === 1 ? "tool" : "tools"} ready
        </span>
        <span className="flex flex-1 items-center justify-end gap-1 font-semibold text-warning">
          {check > 0 && `${check} to check`}
          <ChevronRight
            aria-hidden
            className={classes("size-4 text-muted-foreground", open && "rotate-90")}
          />
        </span>
      </button>
      {open && (
        <ul className="flex flex-wrap gap-2">
          {tools.map((tool) => (
            <li
              key={tool.tool}
              className={classes(
                "flex h-9 items-center gap-1.5 rounded-full border px-3 text-meta font-semibold",
                tool.toHand
                  ? "border-transparent bg-muted text-foreground"
                  : "border-warning/50 bg-warning/10 text-warning",
              )}
            >
              {tool.toHand ? (
                <>
                  <Check aria-hidden className="size-3.5 text-success" />
                  {tool.name}
                </>
              ) : (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                  {tool.name}? Check
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
 * The step reached, as the instruction manual shows it: which step and how long it takes, its
 * title, how it's done and how much is said, its checklist, a word's meaning when tapped, its
 * fixings, the check before moving on, and its tools.
 */
export function StepPanel(props: {
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
  sendPhoto: (photo: File) => void;
}) {
  const { derived, step, progress } = props;
  const [detail, choose] = useDetail();
  const [word, setWord] = useState<string>();
  const meaning = derived.glossary.find((each) => each.word === word);
  return (
    <section aria-label="Steps" className="flex flex-col gap-4 pb-2">
      <div className="flex flex-col gap-1.5">
        <CapsLabel tone="primary">
          Step {step.number} of {derived.steps.length} · about {step.minutes} min
          {step.helper ? " · needs a helper" : ""}
        </CapsLabel>
        <h2 className="display-title text-sheet-title text-foreground">{step.title}</h2>
      </div>
      <Ways ways={step.ways} />
      <DetailSwitch detail={detail} choose={choose} />
      <Checklist
        step={step}
        detail={detail}
        ticked={tickedIn(progress.progress, step.number)}
        tick={progress.tick}
        openWord={setWord}
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
      {step.fixings.length > 0 && (
        <p className="text-interface text-muted-foreground">
          Fixings:{" "}
          <span className="text-foreground">
            {/* "5 × 80 screws (16)": a count before a size would read as one more size. */}
            {listed(step.fixings.map((fixing) => `${fixing.name} (${fixing.count})`))}
          </span>
        </p>
      )}
      <BeforeMovingOn step={step} sendPhoto={props.sendPhoto} />
      <ToolsLine step={step} />
    </section>
  );
}

/** Back, and "Done, next step", pinned at the foot, big enough for dusty hands. */
export function StepFoot(props: { derived: DerivedBuild; step: BuildStep; progress: Progress }) {
  const { derived, step, progress } = props;
  const last = step.number === derived.steps.length;
  return (
    <div className="flex shrink-0 flex-col gap-2 pt-3">
      {progress.problem !== undefined && (
        <p role="status" className="text-meta text-warning">
          {progress.problem}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          variant="outline"
          size="thumb"
          disabled={step.number === 1}
          onClick={() => progress.go(step.number - 1)}
        >
          Back
        </Button>
        <Button variant="primary" size="thumb" grow onClick={progress.done}>
          {last ? "Done, all built" : "Done, next step"}
        </Button>
      </div>
    </div>
  );
}

/** Each step as a dot, done · now · to go, to jump to one: the 3D view moves with it. */
export function StepStrip(props: { derived: DerivedBuild; step: BuildStep; progress: Progress }) {
  const { step } = props;
  return (
    <ol aria-label="Step by step" className="flex items-center gap-1">
      {props.derived.steps.map((each) => (
        <li key={each.number} className="flex">
          <button
            type="button"
            aria-label={`Step ${each.number}, ${each.title}`}
            aria-current={each.number === step.number ? "step" : undefined}
            onClick={() => props.progress.go(each.number)}
            className="flex h-6 items-center px-0.5"
          >
            <span
              aria-hidden
              className={classes(
                "block h-2 rounded-full",
                each.number === step.number
                  ? "w-6 bg-primary"
                  : each.number < step.number
                    ? "w-2 bg-success"
                    : "w-2 bg-input",
              )}
            />
          </button>
        </li>
      ))}
    </ol>
  );
}
