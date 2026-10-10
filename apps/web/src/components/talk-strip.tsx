import { Keyboard, Mic, X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { classes } from "@/lib/classes";
import type { MessageBox } from "./handheld.ts";
import { canListen, feel, type Listening, listen } from "./speech.ts";

/** How long a finger stays on the strip before it's a hold (push to talk) rather than a tap. */
const HOLD_MS = 300;

/**
 * What the strip is doing: waiting (with why it last couldn't listen, if it couldn't), or
 * listening, hands-free after a tap or while it's held, with the words heard so far.
 */
type Talk =
  | { kind: "idle"; problem?: string }
  | { kind: "listening"; held: boolean; words: string; overCancel: boolean };

/**
 * The Handheld frame's Type key and talk strip (#79, Paper board Handheld · 02). A tap on the
 * strip listens hands-free, showing the words as they're heard, and a second tap sends them; Type
 * becomes Cancel meanwhile. Held, it's push to talk: it fills violet, letting go sends, and sliding
 * onto Cancel drops it. While a turn runs, what's said is queued (#177). Each step has its own
 * vibration. Where the browser can't listen, the strip opens the keyboard, as Type does.
 */
export function TalkBar(props: {
  wide: boolean;
  /** Where the owner is: the workspace's name, or Home. */
  where: string;
  /** The page's message box, when it has one. */
  box: MessageBox | undefined;
  /** Opens the box with the keyboard in it. */
  type: () => void;
}) {
  const { box, wide } = props;
  const [talk, setTalk] = useState<Talk>({ kind: "idle" });
  const listening = useRef<Listening>(undefined);
  /** The finger that started listening, until it lifts, and whether it has become a hold. */
  const press = useRef<{ pointer: number; timer: number; held: boolean }>(undefined);
  const cancelKey = useRef<HTMLButtonElement>(null);
  // What's heard goes to the box that's there once it's heard, not the one there when it began.
  const boxNow = useRef(box);
  boxNow.current = box;
  const typeNow = useRef(props.type);
  typeNow.current = props.type;

  const answering = box?.answering === true;
  const wasAnswering = useRef(answering);
  useEffect(() => {
    if (wasAnswering.current && !answering && boxNow.current !== undefined) feel("softTick");
    wasAnswering.current = answering;
  }, [answering]);

  const stop = (how: "send" | "drop") => {
    if (press.current !== undefined) window.clearTimeout(press.current.timer);
    press.current = undefined;
    if (how === "send") listening.current?.finish();
    else listening.current?.cancel();
    listening.current = undefined;
    setTalk({ kind: "idle" });
  };

  // Nowhere to send it (a page without a box, Home say), or the frame gone: listening stops.
  const hasBox = box !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the box going is the trigger
  useEffect(() => {
    if (!hasBox && listening.current !== undefined) stop("drop");
  }, [hasBox]);
  useEffect(() => () => listening.current?.cancel(), []);

  const begin = () => {
    setTalk({ kind: "listening", held: false, words: "", overCancel: false });
    // It can fail before it returns (the browser refusing to start): then there's nothing to keep.
    let over = false;
    const started = listen({
      heard: (words) => setTalk((was) => (was.kind === "listening" ? { ...was, words } : was)),
      finished: (words) => {
        if (words === "") setTalk({ kind: "idle", problem: "Nothing heard, so nothing was sent" });
        else boxNow.current?.say(words);
      },
      failed: (problem, words) => {
        over = true;
        if (press.current !== undefined) window.clearTimeout(press.current.timer);
        press.current = undefined;
        listening.current = undefined;
        setTalk({ kind: "idle", problem });
        // Nothing said is lost: it waits in the box, to finish by keyboard.
        if (words !== "") {
          boxNow.current?.write(words);
          typeNow.current();
        }
      },
    });
    if (!over) listening.current = started;
  };

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canListen() || talk.kind !== "idle" || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    feel("tick");
    const pointer = event.pointerId;
    const timer = window.setTimeout(() => {
      if (press.current?.pointer !== pointer) return;
      press.current.held = true;
      feel("thump");
      setTalk((was) => (was.kind === "listening" ? { ...was, held: true } : was));
    }, HOLD_MS);
    press.current = { pointer, timer, held: false };
    begin();
  };

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!press.current?.held || press.current.pointer !== event.pointerId) return;
    const key = cancelKey.current?.getBoundingClientRect();
    const overCancel =
      key !== undefined &&
      event.clientX >= key.left &&
      event.clientX <= key.right &&
      event.clientY >= key.top &&
      event.clientY <= key.bottom;
    setTalk((was) =>
      was.kind === "listening" && was.overCancel !== overCancel ? { ...was, overCancel } : was,
    );
  };

  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const pressed = press.current;
    if (pressed === undefined) {
      // A second tap, while it listens hands-free: send, with the same feel as letting go.
      if (talk.kind === "listening" && event.button === 0) {
        feel("doubleTick");
        stop("send");
      }
      return;
    }
    if (pressed.pointer !== event.pointerId) return;
    window.clearTimeout(pressed.timer);
    press.current = undefined;
    if (!pressed.held) {
      // A tap: it carries on listening, hands-free.
      feel("thump");
      return;
    }
    if (talk.kind === "listening" && talk.overCancel) return stop("drop");
    feel("doubleTick");
    stop("send");
  };

  // A browser that took the finger away (to scroll, say) drops a hold rather than sending it.
  const lost = (event: PointerEvent<HTMLButtonElement>) => {
    if (press.current?.pointer === event.pointerId) stop("drop");
  };

  const click = (event: MouseEvent<HTMLButtonElement>) => {
    // Where the browser can't listen, the strip is the keyboard's way in, as Type is.
    if (!canListen()) return props.type();
    // A finger or the mouse is handled as it goes down and up; Enter or Space toggles.
    if (event.detail !== 0) return;
    if (talk.kind === "idle") begin();
    else stop("send");
  };

  const titleId = useId();
  const detailId = useId();
  const listeningNow = talk.kind === "listening";
  const held = listeningNow && talk.held;
  const overCancel = held && talk.overCancel;
  const title = !listeningNow
    ? answering
      ? "Answering · talk to add"
      : "Tap or hold to talk"
    : !held
      ? "Listening · tap to send"
      : overCancel
        ? "Let go to drop it"
        : "Let go to send";
  const detail = !listeningNow
    ? (talk.problem ?? (answering ? "What you say now queues" : props.where))
    : held
      ? overCancel
        ? "Slide back to send it"
        : "Slide onto Cancel to drop it"
      : talk.words === ""
        ? props.where
        : `“${talk.words}”`;

  return (
    <>
      <button
        ref={cancelKey}
        type="button"
        disabled={box === undefined}
        onClick={listeningNow ? () => stop("drop") : props.type}
        className={classes(
          "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-[18px] bg-secondary text-[10px]/3 font-bold tracking-[0.08em] text-muted-foreground uppercase ring-1 ring-input outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:opacity-40 [&_svg]:text-foreground",
          wide ? "h-15 w-18 [&_svg]:size-6" : "w-16 [&_svg]:size-5.5",
          overCancel && "bg-muted text-foreground ring-2 ring-foreground",
        )}
      >
        {listeningNow ? (
          <>
            <X aria-hidden strokeWidth={2} className="size-5!" />
            Cancel
          </>
        ) : (
          <>
            <Keyboard aria-hidden strokeWidth={1.6} />
            Type
          </>
        )}
      </button>
      <button
        type="button"
        disabled={box === undefined}
        // Its name stays the same: what it says now, the words heard included, describes it.
        aria-label="Talk"
        aria-pressed={listeningNow}
        aria-describedby={`${titleId} ${detailId}`}
        data-talk={held ? "held" : listeningNow ? "listening" : answering ? "answering" : "idle"}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={lost}
        onClick={click}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === "Escape" && listeningNow) stop("drop");
        }}
        // A held finger is push to talk, not the browser's menu or a text selection.
        onContextMenu={(event) => event.preventDefault()}
        className={classes(
          "relative flex min-w-0 flex-1 touch-none items-center overflow-clip rounded-[18px] text-left outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40",
          wide ? "h-15 gap-3.5 pr-6 pl-5" : "gap-3 px-4.5",
          !listeningNow && "bg-primary/5 ring-1 ring-primary/30 ring-inset active:translate-y-px",
          !listeningNow && answering && "bg-linear-to-r from-primary/14 to-primary/0 to-45%",
          listeningNow &&
            !held &&
            "bg-primary/12 shadow-[0_0_30px] shadow-primary/45 ring-[1.5px] ring-primary ring-inset",
          held && "bg-primary shadow-[0_0_40px] shadow-primary/60 ring-5 ring-primary/20",
        )}
      >
        {!held && (
          <span
            aria-hidden
            className={classes(
              "absolute inset-x-4.5 top-0 h-0.5 rounded-[2px] bg-linear-to-r from-transparent via-primary-text to-transparent",
              listeningNow
                ? "shadow-[0_0_14px_2px] shadow-primary"
                : "shadow-[0_0_12px_1px] shadow-primary/70",
            )}
          />
        )}
        <Mic
          aria-hidden
          className={classes("size-6 shrink-0", held ? "text-background" : "text-primary-text")}
          strokeWidth={1.8}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            id={titleId}
            className={classes(
              "truncate font-extrabold tracking-[-0.01em]",
              wide ? "text-[17px]/5" : "text-base/5",
              held ? "text-background" : "text-foreground",
            )}
          >
            {title}
          </span>
          <span
            id={detailId}
            className={classes(
              "truncate text-xs/[18px]",
              held
                ? "font-semibold text-background/75"
                : listeningNow && talk.words !== ""
                  ? "text-foreground/85"
                  : !listeningNow && talk.problem !== undefined
                    ? "text-warning"
                    : "text-muted-foreground",
            )}
          >
            {detail}
          </span>
        </span>
        {wide &&
          (listeningNow ? (
            <Bars heights={held ? HELD_BARS : LISTENING_BARS} held={held} />
          ) : answering ? (
            <span
              aria-hidden
              className="h-0.5 w-15 shrink-0 rounded-[2px] bg-primary shadow-[0_0_10px] shadow-primary"
            />
          ) : (
            <Bars heights={IDLE_BARS} />
          ))}
      </button>
      {/* Why it couldn't listen, said out loud for a screen reader as it happens. */}
      <span role="status" className="sr-only">
        {talk.kind === "idle" ? talk.problem : undefined}
      </span>
    </>
  );
}

/** The strip's sound bars, as drawn on the boards: each bar's top and height, out of 28 or 24. */
const IDLE_BARS = [
  [11, 6],
  [8, 12],
  [4, 20],
  [9, 10],
  [2, 24],
  [7, 14],
  [10, 8],
  [5, 18],
  [9, 10],
  [6, 16],
  [10, 8],
  [11, 6],
] as const;
const LISTENING_BARS = [
  [9, 6],
  [5, 14],
  [1, 22],
  [7, 10],
  [2, 20],
  [6, 12],
  [3, 18],
  [8, 8],
  [4, 16],
  [7, 10],
  [9, 6],
  [10, 4],
] as const;
const HELD_BARS = [
  [8, 8],
  [3, 18],
  [6, 12],
  [1, 22],
  [5, 14],
  [2, 20],
  [7, 10],
  [4, 16],
  [8, 8],
  [5, 14],
  [9, 6],
  [10, 4],
] as const;

/**
 * Sound bars: faint while it waits, and moving while it listens (handheld-frame.css), unless the
 * device asks for less motion.
 */
function Bars(props: { heights: readonly (readonly [number, number])[]; held?: boolean }) {
  const live = props.heights !== IDLE_BARS;
  return (
    <svg
      aria-hidden
      viewBox={live ? "0 0 120 24" : "0 0 120 28"}
      {...(live ? { "data-talk-bars": "" } : {})}
      className={classes(
        "w-30 shrink-0",
        live ? "h-6" : "h-7",
        !live ? "fill-primary/25" : props.held ? "fill-background/85" : "fill-primary-text",
      )}
    >
      {props.heights.map(([y, height], at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the bars are fixed, a drawing's parts
        <rect key={at} x={at * 10} y={y} width="4" height={height} rx="2" />
      ))}
    </svg>
  );
}
