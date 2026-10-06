import type { SessionId } from "@courtyard/contract";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Turn } from "./events.ts";
import { TurnView } from "./turn-view.tsx";

/** A first guess at a turn's height, before it's been measured. */
const ESTIMATED_TURN_HEIGHT = 140;
/** Turns drawn beyond the edges of the screen, so scrolling never shows a gap. */
const OVERSCAN = 6;
/** How close to the bottom still counts as "at the end", in pixels. */
const NEAR_THE_END = 150;

const atTheEnd = () =>
  window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - NEAR_THE_END;

/**
 * A session's turns, drawing only those near the screen, so a session hundreds of turns long
 * stays smooth. Each drawn turn is measured, so turns of any height (or one still streaming) sit
 * in the right place. Opens at the end, and follows new text only while already at the end, so
 * reading back up isn't interrupted.
 *
 * Turns not drawn can't be found with the browser's Find, and screen readers only see the drawn
 * ones (each says where it sits, "turn 180 of 200"): the price of a long session staying smooth.
 */
export function SessionTurns(props: {
  sessionId: SessionId;
  turns: readonly Turn[];
  onRetry: (turn: Turn) => void;
}) {
  const { sessionId, turns, onRetry } = props;
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const opened = useRef(false);
  // How far down the page the list starts. Measured once it's on screen, and again whenever the
  // page above it changes height (the "reconnecting" banner appearing, say).
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: turns.length,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => turns[index]?.seq ?? index,
  });

  useEffect(() => {
    const onScroll = () => {
      following.current = atTheEnd();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const last = turns.at(-1);
  const lastLength =
    (last?.answer.length ?? 0) + (last?.activities.length ?? 0) + (last?.notes.length ?? 0);
  const lastState = last?.state.kind;
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastLength and lastState are the triggers, so the end stays in view while text streams in or a turn fails
  useLayoutEffect(() => {
    if (turns.length === 0) return;
    if (!opened.current || following.current) {
      opened.current = true;
      virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
      requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    }
  }, [turns.length, lastLength, lastState, virtualizer]);

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
              // Only the last turn can be retried, so only it gets the handler.
              {...(turn === last ? { onRetry } : {})}
            />
          </li>
        );
      })}
    </ol>
  );
}
