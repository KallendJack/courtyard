import { ChevronLeft, ChevronRight, Keyboard, Pause, Play, RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "@/components/button";
import { useDock } from "@/components/handheld";
import { Page } from "@/components/page";
import { ThumbButton } from "@/components/thumb-button";
import { useWakeLock } from "@/components/wake-lock";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import type { StandIn } from "../sessions/composer.tsx";
import type { Steps } from "../sessions/steps.ts";
import { readAloud } from "./read-aloud.ts";
import css from "./step-by-step.css?inline";

// Step by step's own stylesheet (step-by-step.css), added once, when it's first used.
addStylesheet("step-by-step", css);

/** What the owner can say, holding Talk, to steer step by step (#241). */
const COMMANDS = ["next", "back", "repeat"] as const;
type Command = (typeof COMMANDS)[number];

/** The command `words` are, said on their own ("Next."), or nothing. */
const commandIn = (words: string): Command | undefined => {
  const bare = words.toLowerCase().replace(/[^\p{L}]/gu, "");
  return COMMANDS.find((command) => command === bare);
};

/** Where reading the step aloud is: reading it, paused by the owner, or finished. */
type Reading = "reading" | "paused" | "read";

/** A step's title as Next's words: its full stop left off, and lower case unless it's "I" or capitals. */
const asNext = (title: string) => {
  const words = title.replace(/[.!?]+$/, "");
  const first = words.split(" ")[0] ?? "";
  return first === "I" || first === first.toUpperCase()
    ? words
    : `${words.charAt(0).toLowerCase()}${words.slice(1)}`;
};

/**
 * Step by step (#241, Paper board "Tablet · Step by step"): an answer's steps one at a time, in
 * place of the conversation. Each step shows its title and its line, under what they're for and
 * a row that says how far along it is, with Back and Next at the foot and Full answer to go back.
 * Each is read aloud as it shows, and the reading line takes the Reply box's place: Pause, Repeat
 * and Type a reply, which brings the box back. Holding Talk, "next", "back" and "repeat" steer it;
 * the microphone is never on by itself.
 */
export default function StepByStep(props: {
  steps: Steps;
  /** The page's header: the session's title. */
  header: ReactNode;
  /** The page's foot, with the Reply box given what stands in for it, while it does. */
  footer: (standIn: StandIn | undefined) => ReactNode;
  /** Back to the whole answer, in the conversation. */
  onFullAnswer: () => void;
}) {
  const { steps, about } = props.steps;
  const [at, setAt] = useState(0);
  const [reading, setReading] = useState<Reading>("reading");
  /** The owner has gone to the Reply box (Type a reply): the reading line has gone for now. */
  const [typing, setTyping] = useState(false);
  const stopReading = useRef<() => void>(undefined);
  const step = steps[at];
  const next = steps[at + 1];
  const last = at === steps.length - 1;

  useWakeLock(reading === "reading");

  /** Shows the step at `to` (from 0), reading it aloud, and the reading line back if it had gone. */
  const show = useCallback(
    (to: number) => {
      const shown = steps[to];
      if (shown === undefined) return;
      stopReading.current?.();
      setAt(to);
      setTyping(false);
      setReading("reading");
      stopReading.current = readAloud(`Step ${to + 1}. ${shown.title} ${shown.detail}`, () =>
        setReading("read"),
      );
    },
    [steps],
  );
  const pause = useCallback(() => {
    stopReading.current?.();
    stopReading.current = undefined;
    setReading((was) => (was === "reading" ? "paused" : was));
  }, []);

  // The first step is read as step by step opens, and reading stops as it closes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useEffect(() => {
    show(0);
    return () => stopReading.current?.();
  }, []);

  const forward = () => (last ? props.onFullAnswer() : show(at + 1));
  const steer = useRef<(command: Command) => void>(undefined);
  steer.current = (command) => {
    if (command === "next") forward();
    else if (command === "back") show(Math.max(0, at - 1));
    else show(at);
  };

  /** Type a reply, as the Reply box gives it, for a Talk key that can't listen. */
  const typeReply = useRef<() => void>(undefined);
  const standIn = useMemo<StandIn | undefined>(
    () =>
      typing
        ? undefined
        : {
            line: (toReply) => {
              typeReply.current = toReply;
              return (
                <ReadingLine
                  step={at + 1}
                  reading={reading}
                  onPause={pause}
                  onRead={() => show(at)}
                  onTypeReply={toReply}
                />
              );
            },
            leave: () => {
              pause();
              setTyping(true);
            },
          },
    [typing, at, reading, pause, show],
  );

  // Holding Talk (or tapping it), the owner says "next", "back" or "repeat": reading stops while
  // they talk, and what they say steers, once. Other words go nowhere.
  const dock = useDock();
  useEffect(() => {
    if (typing || dock === undefined) return;
    return dock.offerCommands({
      hint: "Say “next”",
      answering: false,
      focus: () => typeReply.current?.(),
      dictate: (listener) => {
        pause();
        let steered = false;
        return {
          hear: (words) => {
            const command = commandIn(words);
            if (steered || command === undefined) return;
            steered = true;
            listener.stop("sent");
            steer.current?.(command);
          },
          drop: () => {},
          done: () => {},
        };
      },
    });
  }, [dock, typing, pause]);

  if (step === undefined) return null;
  return (
    <Page header={props.header} footer={props.footer(standIn)} fill>
      <div data-step-by-step="page">
        <section aria-label="Step by step" className="flex flex-1 flex-col gap-4.5 pt-6 pb-4">
          <div className="flex items-center gap-3.5">
            {/* Short of room, what they're for gives way, never how far along. */}
            <p className="flex min-w-0 text-label font-bold tracking-label whitespace-pre text-muted-foreground uppercase">
              {/* A no-break space, which the truncated span's end keeps. */}
              {about !== undefined && (
                <span className="truncate">
                  {about} ·{" "}
                </span>
              )}
              <span className="shrink-0">
                Step {at + 1} of {steps.length}
              </span>
            </p>
            <div aria-hidden className="flex min-w-12 flex-1 gap-1.5">
              {steps.map((_, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: one per step, and the steps never change
                  key={index}
                  className={classes(
                    "h-1 flex-1 rounded-hair",
                    index < at
                      ? "bg-primary-text/55"
                      : index === at
                        ? "bg-primary-text"
                        : "bg-input",
                  )}
                />
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={props.onFullAnswer}>
              Full answer
            </Button>
          </div>
          <div aria-live="polite" className="flex flex-1 flex-col gap-2.5 md:pr-10">
            <h2 className="text-step font-bold tracking-[-0.01em] text-foreground">{step.title}</h2>
            {step.detail !== "" && (
              <p className="text-step-detail text-foreground/65">{step.detail}</p>
            )}
          </div>
          <div className="flex gap-3">
            <ThumbButton look="outline" tall disabled={at === 0} onClick={() => show(at - 1)}>
              <ChevronLeft aria-hidden strokeWidth={2} />
              Back
            </ThumbButton>
            <ThumbButton look="soft" tall grow={3} onClick={forward}>
              <span className="min-w-0 truncate">
                {next === undefined ? "Done" : `Next: ${asNext(next.title)}`}
              </span>
              {next !== undefined && <ChevronRight aria-hidden strokeWidth={2} />}
            </ThumbButton>
          </div>
        </section>
      </div>
    </Page>
  );
}

/**
 * The reading line, in the Reply box's place while a step is read aloud: Pause (or, once paused or
 * finished, read it again), its sound bars while it reads, what it's doing, Repeat, and Type a
 * reply.
 */
function ReadingLine(props: {
  step: number;
  reading: Reading;
  onPause: () => void;
  onRead: () => void;
  onTypeReply: () => void;
}) {
  const reading = props.reading === "reading";
  return (
    <div data-step-by-step="">
      <div className="flex h-15 items-center gap-3.5 rounded-full border border-primary-text/30 bg-field pr-2 pl-2">
        <IconButton
          look="playing"
          size="thumb"
          label={reading ? "Pause" : "Read it aloud"}
          icon={reading ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          onClick={reading ? props.onPause : props.onRead}
        />
        <ReadingBars moving={reading} />
        <p
          role="status"
          className="min-w-0 flex-1 truncate text-base/5 font-semibold text-foreground"
        >
          {reading
            ? `Reading step ${props.step} aloud`
            : props.reading === "paused"
              ? `Paused on step ${props.step}`
              : `Step ${props.step} read aloud`}
        </p>
        <Button variant="quiet" size="lg" narrowIcon={<RotateCcw />} onClick={props.onRead}>
          Repeat
        </Button>
        <Button variant="outline" size="lg" narrowIcon={<Keyboard />} onClick={props.onTypeReply}>
          Type a reply
        </Button>
      </div>
    </div>
  );
}

/** The reading line's sound bars, as drawn: each bar's x, top and height. */
const BARS = [
  [0, 7, 8],
  [6, 3, 16],
  [12, 0, 22],
  [18, 5, 12],
  [24, 2, 18],
  [30, 7.5, 7],
] as const;

/** They move while it reads (handheld-frame.css's talk bars), unless the device asks for less motion. */
function ReadingBars(props: { moving: boolean }) {
  return (
    <svg
      aria-hidden
      {...(props.moving ? { "data-talk-bars": "" } : {})}
      viewBox="0 0 33 22"
      // Short of room on the cover screen, what it says comes first.
      className="h-5.5 w-8.25 shrink-0 fill-primary-text max-md:hidden"
    >
      {BARS.map(([x, y, height]) => (
        <rect key={x} x={x} y={y} width={3} height={height} rx={1.5} />
      ))}
    </svg>
  );
}
