import { Keyboard, Mic, X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { classes } from "@/lib/classes";
import { FrameButton } from "./frame-button.tsx";
import { type Dictation, type TalkTarget, typingIn, useFinePointer } from "./handheld.ts";
import { canListen, feel, type Listening, listen } from "./speech.ts";
import { useWakeLock } from "./wake-lock.ts";

/** How long a finger stays on the strip or the key before it's a hold (push to talk) rather than a tap. */
const HOLD_MS = 300;

/**
 * What talking is doing: waiting (with why it last couldn't listen, if it couldn't), or
 * listening, hands-free after a tap or while it's held, with the words heard so far.
 */
type Talk =
  | { kind: "idle"; problem?: string }
  | { kind: "listening"; held: boolean; words: string; overCancel: boolean; sends: boolean };

/**
 * What the strip or the key shows: waiting, or waiting while a turn runs; listening hands-free;
 * held, push to talk; or held with the finger slid onto Cancel, to drop it.
 */
type Showing = "idle" | "answering" | "listening" | "held" | "dropping";

/** `sends`: held by a key or the mouse's side button, which sends when let go (#197). */
type Now = {
  where: string;
  problem: string | undefined;
  words: string;
  sends: boolean;
  /** While it answers, what's said goes into the answer (#252), not the queue. */
  steers: boolean;
};

type Says = Record<Showing, (now: Now) => { title: string; detail: string }>;

/**
 * Talking to the page's message box (#79, #198), the same from the cover screen's talk strip and
 * a tablet's Talk key (#206). A tap listens hands-free, putting the words in the box as they're
 * heard, after anything typed, and a second tap stops; the owner sends them with Send. Held, it's
 * push to talk: letting go stops, and sliding onto `cancelKey`, where there is one, drops it.
 * While a turn runs, what's sent is queued (#177). Each step has its own vibration. Where the
 * browser can't listen, it opens the keyboard (`type`). Returns what it shows, and what goes on
 * the button that talks.
 */
function useTalk(props: {
  box: TalkTarget | undefined;
  type: () => void;
  says: Says;
  where: string;
  cancelKey?: RefObject<HTMLButtonElement | null>;
  /** Where a tap from elsewhere goes: the Reply box's mic (#251). */
  talker: RefObject<(() => void) | undefined>;
  /**
   * Hold Space (outside a field) or the mouse's side button to talk, anywhere on the page;
   * letting go sends what was said, and Escape drops it (#197).
   */
  holdKeys?: boolean;
}) {
  const { box } = props;
  const [talk, setTalk] = useState<Talk>({ kind: "idle" });
  const listening = useRef<Listening>(undefined);
  /** Where what's heard now goes: the message box, opened for it. */
  const dictation = useRef<Dictation>(undefined);
  /** The finger that started listening, until it lifts, and whether it has become a hold. */
  const press = useRef<{ pointer: number; timer: number; held: boolean }>(undefined);
  /** What a let-go key sends, once the browser has settled its last words. */
  const sending = useRef<Dictation>(undefined);

  const answering = box?.answering === true;
  const wasAnswering = useRef(answering);
  const hasBox = box !== undefined;
  useEffect(() => {
    if (wasAnswering.current && !answering && hasBox) feel("softTick");
    wasAnswering.current = answering;
  }, [answering, hasBox]);

  /**
   * Stops listening: keeping what was said (the browser settles the last words first), dropping
   * it, or because the box sent it.
   */
  const stop = (how: "keep" | "drop" | "sent" | "send") => {
    if (press.current !== undefined) window.clearTimeout(press.current.timer);
    press.current = undefined;
    if (how === "send") sending.current = dictation.current;
    if (how === "keep" || how === "send") listening.current?.finish();
    else listening.current?.cancel();
    if (how === "drop") dictation.current?.drop();
    dictation.current?.done();
    listening.current = undefined;
    dictation.current = undefined;
    setTalk({ kind: "idle" });
  };

  // The screen stays awake while the owner talks, and while an answer comes.
  useWakeLock(talk.kind === "listening" || answering);

  // Nowhere to put it (a page without a box, Home say), or the frame gone: listening stops.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the box going is the trigger
  useEffect(() => {
    if (!hasBox && listening.current !== undefined) stop("drop");
  }, [hasBox]);
  useEffect(() => () => listening.current?.cancel(), []);

  const begin = () => {
    if (box === undefined) return;
    setTalk({ kind: "listening", held: false, words: "", overCancel: false, sends: false });
    // Sent from the box while it listens, listening stops, and what was said has gone with it; or
    // the box's own ■ or ✕ stops it, keeping what was said or dropping it.
    const into: Dictation = box.dictate({
      stop: (how) => {
        if (dictation.current !== into) return;
        if (how === "keep") feel("doubleTick");
        stop(how);
      },
    });
    dictation.current = into;
    // It can fail before it returns (the browser refusing to start): then there's nothing to keep.
    let over = false;
    const started = listen({
      heard: (words) => {
        setTalk((was) => (was.kind === "listening" ? { ...was, words } : was));
        into.hear(words);
      },
      // The browser's last word on what was said, once it has settled; unless the owner has
      // started talking again meanwhile, when what it heard is in the box already, before the new.
      finished: (words) => {
        if (dictation.current !== undefined) return;
        if (words === "") setTalk({ kind: "idle", problem: "Nothing heard" });
        else into.hear(words);
        if (sending.current === into) {
          sending.current = undefined;
          into.send?.();
        }
      },
      failed: (problem, words) => {
        over = true;
        if (press.current !== undefined) window.clearTimeout(press.current.timer);
        press.current = undefined;
        listening.current = undefined;
        if (dictation.current === into) dictation.current = undefined;
        setTalk({ kind: "idle", problem });
        // Nothing said is lost: it waits in the box, to send or finish by keyboard.
        if (words !== "") into.hear(words);
        into.done();
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
    const key = props.cancelKey?.current?.getBoundingClientRect();
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
      // A second tap, while it listens hands-free: it stops, with the same feel as letting go.
      if (talk.kind === "listening" && event.button === 0) {
        feel("doubleTick");
        stop("keep");
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
    stop("keep");
  };

  // A browser that took the finger away (to scroll, say) drops a hold rather than keeping it.
  const lost = (event: PointerEvent<HTMLButtonElement>) => {
    if (press.current?.pointer === event.pointerId) stop("drop");
  };

  const click = (event: MouseEvent<HTMLButtonElement>) => {
    // Where the browser can't listen, talking is the keyboard's way in, as Type is.
    if (!canListen()) return props.type();
    // A finger or the mouse is handled as it goes down and up; Enter or Space toggles.
    if (event.detail !== 0) return;
    if (talk.kind === "idle") begin();
    else stop("keep");
  };

  /** A tap from the Reply box's mic (#251): as a tap on the key, listening hands-free or stopping. */
  const tap = () => {
    if (!canListen()) return props.type();
    if (talk.kind === "idle") {
      feel("thump");
      begin();
    } else {
      feel("doubleTick");
      stop("keep");
    }
  };

  // Hold Space or the mouse's side button, and the box's mic: the latest of what's here, for
  // listeners added once.
  const latest = useRef({ begin, stop, tap, idle: talk.kind === "idle", hasBox });
  latest.current = { begin, stop, tap, idle: talk.kind === "idle", hasBox };
  const { talker } = props;
  useEffect(() => {
    talker.current = () => latest.current.tap();
    return () => {
      talker.current = undefined;
    };
  }, [talker]);
  useEffect(() => {
    if (props.holdKeys !== true) return;
    let holding: "key" | "mouse" | undefined;
    const start = (how: "key" | "mouse") => {
      const now = latest.current;
      if (holding !== undefined || !now.idle || !now.hasBox || !canListen()) return false;
      holding = how;
      feel("thump");
      now.begin();
      setTalk((was) => (was.kind === "listening" ? { ...was, held: true, sends: true } : was));
      return true;
    };
    const end = (how: "send" | "drop" | "keep") => {
      holding = undefined;
      // Listening already ended while held (the browser can't listen, #422): what it said stays.
      if (!latest.current.idle) latest.current.stop(how);
    };
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (holding !== undefined && event.key === "Escape") {
        event.preventDefault();
        end("drop");
        return;
      }
      if (event.code !== "Space") return;
      // Held, Space does nothing else: no scrolling, no button pressed.
      if (holding === "key") {
        event.preventDefault();
        return;
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typingIn(event.target)) return;
      if (start("key")) event.preventDefault();
    };
    const keyUp = (event: globalThis.KeyboardEvent) => {
      if (holding !== "key" || event.code !== "Space") return;
      event.preventDefault();
      end("send");
    };
    // The side button (4) is the browser's Back: not while Courtyard is open.
    const mouseDown = (event: globalThis.MouseEvent) => {
      if (event.button === 3 && start("mouse")) event.preventDefault();
    };
    const mouseUp = (event: globalThis.MouseEvent) => {
      if (event.button !== 3) return;
      event.preventDefault();
      if (holding === "mouse") end("send");
    };
    const notBack = (event: globalThis.MouseEvent) => {
      if (event.button === 3) event.preventDefault();
    };
    // Away from the window mid-hold, its let-go never comes: what was said stays in the box.
    const away = () => {
      if (holding !== undefined) end("keep");
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("mousedown", mouseDown);
    window.addEventListener("mouseup", mouseUp);
    window.addEventListener("auxclick", notBack);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("mousedown", mouseDown);
      window.removeEventListener("mouseup", mouseUp);
      window.removeEventListener("auxclick", notBack);
      window.removeEventListener("blur", away);
    };
  }, [props.holdKeys]);

  const titleId = useId();
  const detailId = useId();
  const listeningNow = talk.kind === "listening";
  const held = listeningNow && talk.held;
  const overCancel = held && talk.overCancel;
  const showing: Showing = !listeningNow
    ? answering
      ? "answering"
      : "idle"
    : !held
      ? "listening"
      : overCancel
        ? "dropping"
        : "held";
  const problem = talk.kind === "idle" ? talk.problem : undefined;
  const words = talk.kind === "listening" ? talk.words : "";
  const sends = talk.kind === "listening" && talk.sends;
  const steers = box?.steers === true;
  const { title, detail } = props.says[showing]({
    where: props.where,
    problem,
    words,
    sends,
    steers,
  });

  return {
    showing,
    listening: listeningNow,
    held,
    overCancel,
    problem,
    words,
    /** Stops listening, dropping what it heard (Cancel). */
    drop: () => stop("drop"),
    title: { id: titleId, text: title },
    detail: { id: detailId, text: detail },
    /** What goes on the button that talks: its name stays "Talk", and what it says describes it. */
    button: {
      type: "button" as const,
      disabled: box === undefined,
      "aria-label": "Talk",
      "aria-pressed": listeningNow,
      "aria-describedby": `${titleId} ${detailId}`,
      "data-talk": showing,
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: lost,
      onClick: click,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "Escape" && listeningNow) stop("drop");
      },
      // A held finger is push to talk, not the browser's menu or a text selection.
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(),
    },
  };
}

/** Why it couldn't listen, said out loud for a screen reader as it happens. */
function Problem(props: { problem: string | undefined }) {
  return (
    <span role="status" className="sr-only">
      {props.problem}
    </span>
  );
}

/** What the strip says in each, in a line and a smaller one under it (Paper board Handheld · 02). */
const STRIP_SAYS: Says = {
  idle: (now) => ({ title: "Tap or hold to talk", detail: now.problem ?? now.where }),
  answering: (now) => ({
    title: "Answering · talk to add",
    detail:
      now.problem ??
      (now.steers ? "What you say now goes into this answer" : "What you say now queues"),
  }),
  listening: (now) => ({
    title: "Listening · tap to stop",
    detail: now.words === "" ? now.where : `“${now.words}”`,
  }),
  held: (now) =>
    now.sends
      ? { title: "Let go to send", detail: "Escape drops it" }
      : { title: "Let go to stop", detail: "Slide onto Cancel to drop it" },
  dropping: () => ({ title: "Let go to drop it", detail: "Slide back to keep it" }),
};

/**
 * The cover screen's Type key and talk strip (#79, Paper board Handheld · 02). Talking is
 * `useTalk`'s; the strip fills violet while held. Type opens the message box, and becomes Cancel
 * while it listens, which drops what was said.
 */
export function TalkBar(props: {
  /** Where the owner is: the workspace's name, or Home. */
  where: string;
  /** Where talking goes: the page's message box, or a field it offers (#264). */
  box: TalkTarget | undefined;
  /** Opens the box, or the field, with the keyboard in it. */
  type: () => void;
  talker: RefObject<(() => void) | undefined>;
}) {
  const cancelKey = useRef<HTMLButtonElement>(null);
  const where = props.box?.hint ?? props.where;
  const talk = useTalk({ ...props, where, says: STRIP_SAYS, cancelKey, holdKeys: true });
  const { listening, held } = talk;

  return (
    <>
      <FrameButton
        ref={cancelKey}
        look="key"
        lit={talk.overCancel}
        disabled={props.box === undefined}
        onClick={listening ? talk.drop : props.type}
      >
        {listening ? (
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
      </FrameButton>
      <button
        {...talk.button}
        className={classes(
          "relative flex min-w-0 flex-1 touch-none items-center gap-3 overflow-clip rounded-card px-4.5 text-left outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40",
          !listening && "bg-primary/5 ring-1 ring-primary/30 ring-inset active:translate-y-px",
          talk.showing === "answering" && "bg-linear-to-r from-primary/14 to-primary/0 to-45%",
          listening &&
            !held &&
            "bg-primary/12 shadow-glow-talk ring-stroke ring-primary ring-inset",
          held && "bg-primary shadow-glow-held ring-5 ring-primary/20",
        )}
      >
        {!held && (
          <span
            aria-hidden
            className={classes(
              "absolute inset-x-4.5 top-0 h-0.5 rounded-hair bg-linear-to-r from-transparent via-primary-text to-transparent",
              listening ? "shadow-glow-hair-live" : "shadow-glow-hair",
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
            id={talk.title.id}
            className={classes(
              "truncate text-base/5 font-extrabold tracking-[-0.01em]",
              held ? "text-background" : "text-foreground",
            )}
          >
            {talk.title.text}
          </span>
          <span
            id={talk.detail.id}
            className={classes(
              "truncate text-meta",
              held
                ? "font-semibold text-background/75"
                : listening && talk.words !== ""
                  ? "text-foreground/85"
                  : !listening && talk.problem !== undefined
                    ? "text-warning"
                    : "text-muted-foreground",
            )}
          >
            {talk.detail.text}
          </span>
        </span>
      </button>
      <Problem problem={talk.problem} />
    </>
  );
}

/**
 * What the Talk key says (#206, Paper board "Draft · Component · Talk key states"): what it does,
 * under its name. The words heard go live into the Reply box beside it, so it doesn't repeat them.
 */
const KEY_SAYS: Says = {
  idle: (now) => ({ title: "Talk", detail: now.problem ?? now.where }),
  answering: (now) => ({ title: "Talk", detail: now.problem ?? "Answering…" }),
  listening: () => ({ title: "Listening", detail: "Tap to stop" }),
  held: (now) => ({ title: "Listening", detail: now.sends ? "Let go to send" : "Let go to stop" }),
  dropping: () => ({ title: "Listening", detail: "Let go to drop it" }),
};

/**
 * A tablet's Talk key, at the foot of the right rail (#206, the agreed tablet boards): a tall
 * black key with a lilac mic tile, its name and what it does, a line of light and a soft glow.
 * Talking is `useTalk`'s, as the cover screen's strip has it; while it listens the Reply box
 * shows its ✕, ■ and ↑ (or Escape drops what was said).
 * While it listens it lights up and its tile shows sound bars; while an answer comes it goes
 * quiet, and what's said queues.
 */
export function TalkKey(props: {
  box: TalkTarget | undefined;
  type: () => void;
  talker: RefObject<(() => void) | undefined>;
}) {
  // With a mouse, there's a keyboard: Space is the way to talk, and the key says so (#197).
  const how = useFinePointer() ? "Hold Space" : "Hold to speak";
  const where = props.box?.hint ?? how;
  const talk = useTalk({ ...props, says: KEY_SAYS, where, holdKeys: true });
  const { listening, showing } = talk;
  const quiet = showing === "answering";

  return (
    <>
      <button
        {...talk.button}
        className={classes(
          "relative flex h-60 w-full shrink-0 touch-none flex-col items-center justify-center gap-3.5 overflow-clip rounded-ask px-2 text-center outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40",
          listening
            ? "bg-primary/16 shadow-talk-key-live"
            : "bg-secondary shadow-talk-key active:translate-y-px",
        )}
      >
        <span
          aria-hidden
          className={classes(
            "flex h-14 shrink-0 items-center justify-center rounded-lg",
            listening
              ? "w-18 bg-primary-text text-secondary shadow-glow-mic"
              : quiet
                ? "w-14 bg-muted text-foreground/95 ring-1 ring-input ring-inset"
                : "w-14 bg-primary-text text-secondary shadow-glow-mic",
          )}
        >
          {listening ? <KeyBars /> : <MicGlyph />}
        </span>
        <span className="flex flex-col items-center gap-1">
          <span
            id={talk.title.id}
            className="text-talk font-semibold tracking-[0.01em] text-foreground/95"
          >
            {talk.title.text}
          </span>
          <span
            id={talk.detail.id}
            className={classes(
              "text-meta font-medium",
              talk.problem === undefined ? "text-muted-foreground" : "text-warning",
            )}
          >
            {talk.detail.text}
          </span>
        </span>
        {/* The soft glow under it, stronger while it listens, faint while an answer comes. */}
        <span
          aria-hidden
          className={classes(
            "absolute -bottom-7.5 left-1/2 h-17.5 w-25 -translate-x-1/2 rounded-full bg-primary-text blur-xl",
            listening ? "opacity-60" : quiet ? "opacity-8" : "opacity-30",
          )}
        />
        <span
          aria-hidden
          className="absolute bottom-3.5 left-1/2 h-1 w-15 -translate-x-1/2 rounded-full bg-primary-text shadow-glow-line"
        />
      </button>
      <Problem problem={talk.problem} />
    </>
  );
}

/** The Talk key's mic, as drawn: a solid capsule on a stand. */
function MicGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-7">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The sound bars in the Talk key's tile while it listens, as drawn: each bar's x, top, width and height. */
const KEY_BARS = [
  [1, 11, 4, 6],
  [9, 6, 4, 16],
  [17, 2, 4, 24],
  [25, 8, 4, 12],
  [33, 4, 4, 20],
  [41, 11, 2, 6],
] as const;

/** They move (handheld-frame.css), unless the device asks for less motion. */
function KeyBars() {
  return (
    <svg aria-hidden data-talk-bars="" viewBox="0 0 44 28" className="h-7 w-11 fill-current">
      {KEY_BARS.map(([x, y, width, height]) => (
        <rect key={x} x={x} y={y} width={width} height={height} rx={width / 2} />
      ))}
    </svg>
  );
}
