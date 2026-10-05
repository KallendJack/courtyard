import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef } from "react";
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
 */
export function SessionTurns(props: { turns: readonly Turn[]; onRetry: (turn: Turn) => void }) {
  const { turns, onRetry } = props;
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const opened = useRef(false);

  const virtualizer = useWindowVirtualizer({
    count: turns.length,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin: list.current?.offsetTop ?? 0,
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
  const lastLength = (last?.answer.length ?? 0) + (last?.activities.length ?? 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastLength is the trigger, so the end stays in view while text streams in
  useLayoutEffect(() => {
    if (turns.length === 0) return;
    if (!opened.current || following.current) {
      opened.current = true;
      virtualizer.scrollToIndex(turns.length - 1, { align: "end" });
      requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    }
  }, [turns.length, lastLength, virtualizer]);

  const scrollMargin = virtualizer.options.scrollMargin;
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
          <TurnView
            key={item.key}
            turn={turn}
            index={item.index}
            offset={item.start - scrollMargin}
            measure={virtualizer.measureElement}
            // Only the last turn can be retried, so only it gets the handler.
            {...(turn === last ? { onRetry } : {})}
          />
        );
      })}
    </ol>
  );
}
