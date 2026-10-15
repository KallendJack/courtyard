import type { ProviderList, SessionId, WorkspaceId } from "@courtyard/contract";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePageScroll } from "@/components/page-scroll";
import type { DocumentsHere } from "./documents.tsx";
import type { QueuedMessage, Turn } from "./events.ts";
import type { Steps } from "./steps.ts";
import { TurnView } from "./turn-view.tsx";

/** A first guess at a turn's height, before it's been measured. */
const ESTIMATED_TURN_HEIGHT = 140;
/** Turns drawn beyond the edges of the screen, so scrolling never shows a gap. */
const OVERSCAN = 6;
/** How close to the bottom still counts as "at the end", in pixels. */
const NEAR_THE_END = 150;

const atTheEnd = (scroller: HTMLElement) =>
  scroller.clientHeight + scroller.scrollTop >= scroller.scrollHeight - NEAR_THE_END;

/** Scrolls the page to its end. */
const toTheEnd = (scroller: HTMLElement) => scroller.scrollTo({ top: scroller.scrollHeight });

/**
 * A session's turns, drawing only those near the screen, so a session hundreds of turns long
 * stays smooth. Each drawn turn is measured, so turns of any height (or one still streaming) sit
 * in the right place. Opens at the end, and follows new text only while already at the end, so
 * reading back up isn't interrupted: nothing that arrives, ends or goes moves the owner then (#168).
 *
 * Turns not drawn can't be found with the browser's Find, and screen readers only see the drawn
 * ones (each says where it sits, "turn 180 of 200"): the price of a long session staying smooth.
 */
export function SessionTurns(props: {
  sessionId: SessionId;
  turns: readonly Turn[];
  providers: ProviderList["providers"];
  onRetry: (turn: Turn) => void;
  onCarryOn: (turn: Turn) => Promise<string | undefined>;
  /** Continue a turn a restart cut off (#186). */
  onContinue: (turn: Turn) => Promise<string | undefined>;
  /**
   * Opens Allow all for this task's choice of how long (#428), from an approval it would cover;
   * left out where the session can't allow all.
   */
  onAllowAll?: () => void;
  /** Sends a suggested reply; left out when the session can't be carried on. */
  onReply?: (turn: Turn, reply: string) => Promise<boolean>;
  /** The session's workspace, where its documents' notes open. */
  workspaceId: WorkspaceId;
  /** Where Save as document saves; left out where answers can't be saved as documents. */
  documents?: DocumentsHere;
  /** Starts step by step on an answer's steps (#241); left out where answers don't offer it. */
  onStepByStep?: (turn: Turn, steps: Steps) => void;
  /** The owner's messages waiting for the running turn to end (#177), shown under the latest. */
  queuedMessages: readonly QueuedMessage[];
  /** Removes a queued message: what went wrong, or nothing once it's removed. */
  onRemoveQueued: (queued: number) => Promise<string | undefined>;
  /** Takes a queued message back into the Reply box (#252): what went wrong, or nothing. */
  onEditQueued?: (queued: QueuedMessage) => Promise<string | undefined>;
  /** Told when the owner scrolls away from the end to read back, and when they're back (#168). */
  onAway?: (away: boolean) => void;
  /** Set to what goes to the end and follows again: Jump to latest, or the owner sending (#168). */
  follow?: Ref<() => void>;
}) {
  const { sessionId, turns, providers, onRetry, onCarryOn, onContinue, onReply } = props;
  const { workspaceId, documents } = props;
  const { onStepByStep, onAllowAll } = props;
  const { queuedMessages, onRemoveQueued, onEditQueued } = props;
  const queued = useMemo(
    () => ({
      messages: queuedMessages,
      remove: onRemoveQueued,
      ...(onEditQueued === undefined ? {} : { edit: onEditQueued }),
    }),
    [queuedMessages, onRemoveQueued, onEditQueued],
  );
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const opened = useRef(false);
  // How far down the page the list starts. Measured once it's on screen, and again whenever the
  // page above it changes height (the "reconnecting" banner appearing, say).
  const [scrollMargin, setScrollMargin] = useState(0);

  // The page scrolls on its panel, not the window (#266).
  const scroller = usePageScroll();

  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !scroller) return;
    const measure = () =>
      setScrollMargin(
        element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          scroller.clientTop +
          scroller.scrollTop,
      );
    measure();
    const observer = new ResizeObserver(measure);
    for (const child of scroller.children) observer.observe(child);
    return () => observer.disconnect();
  }, [scroller]);

  const virtualizer = useVirtualizer({
    getScrollElement: () => scroller,
    count: turns.length,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => turns[index]?.seq ?? index,
  });

  // The page hears when the owner is away from the end, for Jump to latest (#168), which follows
  // again through `follow`.
  const onAway = useRef(props.onAway);
  onAway.current = props.onAway;
  const setFollowing = useRef((now: boolean) => {
    if (following.current === now) return;
    following.current = now;
    onAway.current?.(!now);
  }).current;
  useImperativeHandle(
    props.follow,
    () => () => {
      setFollowing(true);
      if (scroller) toTheEnd(scroller);
    },
    [setFollowing, scroller],
  );

  // Only scrolling up stops following: the page grows between scrolling to the end and the
  // browser reporting it, by more than "near the end" on a slow frame, which isn't the owner
  // reading back. Only scrolling down to the end follows again: the browser moving the page up
  // because it got shorter for a moment (a new turn not measured yet) isn't the owner coming back.
  useEffect(() => {
    if (!scroller) return;
    let lastScrollTop = scroller.scrollTop;
    const onScroll = () => {
      const now = scroller.scrollTop;
      const down = now > lastScrollTop;
      setFollowing(
        following.current ? atTheEnd(scroller) || now >= lastScrollTop : atTheEnd(scroller) && down,
      );
      lastScrollTop = now;
    };
    // The keyboard opening or closing, or the message box growing, changes the page's height
    // (#168): at the end, the end stays in view above the message box; reading back, the page
    // stays where it is, which the browser does by itself.
    const resized = new ResizeObserver(() => {
      if (opened.current && following.current) toTheEnd(scroller);
    });
    resized.observe(scroller);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resized.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [setFollowing, scroller]);

  // A new turn (or the session opening) goes to the end, which may not be drawn yet.
  useLayoutEffect(() => {
    if (turns.length === 0 || !scroller) return;
    if (!opened.current || following.current) {
      opened.current = true;
      virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
      requestAnimationFrame(() => toTheEnd(scroller));
    }
  }, [turns.length, virtualizer, scroller]);

  // While following, the end stays in view as the turns grow: an answer being revealed, a turn
  // failing, or every turn redrawn. The browser reports a change of size at most once a frame, so
  // this scrolls in step with the reveal. Not while a finger or button is down on a turn: the page
  // moving under it would make the tap land on whatever moved there (a row, not the table heading
  // tapped to sort it, #163). Let go, the end comes back into view once the tap has landed; a
  // press that becomes a scroll leaves the page to the owner.
  useEffect(() => {
    const element = list.current;
    if (!element || !scroller) return;
    let pressed = false;
    const follow = () => {
      if (opened.current && following.current && !pressed) toTheEnd(scroller);
    };
    const press = () => {
      pressed = true;
    };
    const letGo = () => {
      if (!pressed) return;
      pressed = false;
      requestAnimationFrame(follow);
    };
    const cancel = () => {
      pressed = false;
    };
    const observer = new ResizeObserver(follow);
    observer.observe(element);
    element.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", letGo);
    window.addEventListener("pointercancel", cancel);
    return () => {
      observer.disconnect();
      element.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", letGo);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [scroller]);

  const last = turns.at(-1);

  return (
    <ol
      ref={list}
      aria-label="Session"
      className="relative mt-6"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const turn = turns[item.index];
        if (!turn) return null;
        return (
          <li
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            aria-posinset={item.index + 1}
            aria-setsize={turns.length}
            className="absolute top-0 left-0 w-full pb-6"
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <TurnView
              sessionId={sessionId}
              turn={turn}
              providers={providers}
              workspaceId={workspaceId}
              {...(documents === undefined ? {} : { documents })}
              {...(onStepByStep === undefined ? {} : { onStepByStep })}
              // Only the last turn can be retried, carried on, continued or replied to, so only it
              // gets the handlers.
              {...(turn === last
                ? {
                    onRetry,
                    onCarryOn,
                    onContinue,
                    ...(onReply ? { onReply } : {}),
                    ...(onAllowAll ? { onAllowAll } : {}),
                    latest: true,
                    queued,
                  }
                : {})}
            />
          </li>
        );
      })}
    </ol>
  );
}
