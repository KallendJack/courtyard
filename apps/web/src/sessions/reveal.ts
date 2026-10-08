import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** The slowest the reveal goes, in characters a millisecond, so the last few never crawl in. */
const SLOWEST = 0.06;
/** Roughly how far behind the arrived text the reveal runs, in milliseconds: it speeds up to match. */
const BEHIND_MS = 250;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const watchReducedMotion = (changed: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};

/** Whether the owner's device asks for less motion. */
const useReducedMotion = () =>
  useSyncExternalStore(watchReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches);

/** Where to cut `text` near `length`, never between the two halves of an emoji's character. */
const cutAt = (text: string, length: number) => {
  const code = text.charCodeAt(length - 1);
  return code >= 0xd800 && code <= 0xdbff ? length + 1 : length;
};

/**
 * The part of a streaming answer to show: text arrives in uneven bursts, and this reveals it at an
 * even pace, a little each frame, speeding up with how much is waiting so it never falls far
 * behind. The first `replayed` characters show at once, as does whatever there is when the answer
 * is first drawn (say, scrolled back into view), and everything once the turn isn't running any
 * more (it finished, was stopped or failed), or on a device asking for less motion.
 */
export const useReveal = (text: string, options: { running: boolean; replayed: number }) => {
  const reducedMotion = useReducedMotion();
  const live = options.running && !reducedMotion;
  const [shown, setShown] = useState(text.length);
  // What the frames read, kept up to date without restarting them.
  const latest = useRef({ length: text.length, replayed: options.replayed });
  useEffect(() => {
    latest.current = { length: text.length, replayed: options.replayed };
  });

  useEffect(() => {
    if (!live) return;
    let position = latest.current.length;
    let before = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const { length, replayed } = latest.current;
      position = Math.max(position, replayed);
      const waiting = length - position;
      if (waiting > 0) {
        position = Math.min(length, position + (now - before) * (SLOWEST + waiting / BEHIND_MS));
        setShown(Math.floor(position));
      }
      before = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [live]);

  if (!live) return text;
  return text.slice(0, cutAt(text, Math.min(text.length, Math.max(shown, options.replayed))));
};
