import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Nothing jumps in late (owner, 2026-10-12): what a page loads after it shows is kept in memory
 * for as long as the tab is open, one store per kind of answer (`createKept`), by a key naming
 * whose it is (a workspace's id). A page that comes back shows the last-known answer at once and
 * asks again quietly, updating in place (`useKept`), and keeps asking the one shared way while it
 * shows (`useFresh`, #387); one with nothing known yet shows its block's
 * placeholder rows (`PlaceholderRows`) in the block's place until the answer comes. A whole page
 * that waits (a pull request's, Tidy) shows them in its own shape, under its title. Its few
 * classes are in the first load's stylesheet, since every page may show it.
 */
export type Kept<T> = {
  readonly get: (key: string) => T | undefined;
  readonly set: (key: string, value: T) => void;
  readonly subscribe: (changed: () => void) => () => void;
};

/** A store for one kind of answer, kept for the tab's lifetime. */
export const createKept = <T,>(): Kept<T> => {
  const values = new Map<string, T>();
  const listeners = new Set<() => void>();
  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
      for (const listener of listeners) listener();
    },
    subscribe: (changed) => {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
};

/** How often a block asks again while nothing it shows is busy (#387). */
const CALM_EVERY_MS = 30 * 1000;

/**
 * How every block that shows the worker's data stays fresh (#387): `ask` every 30 seconds while
 * things are calm, or every `busyEveryMs` while something it shows is busy (a session working,
 * main's build running); never while the tab is hidden, and at once when it's shown again. One
 * question at a time. While `asking` is false, nothing is asked.
 */
export const useFresh = (options: {
  ask: () => unknown;
  asking?: boolean;
  busyEveryMs?: number | undefined;
}) => {
  const { asking = true } = options;
  const everyMs = options.busyEveryMs ?? CALM_EVERY_MS;
  const ask = useRef(options.ask);
  ask.current = options.ask;
  useEffect(() => {
    if (!asking) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;
    const askNow = async () => {
      clearTimeout(timer);
      // Hidden: nothing more until it's shown again, which asks at once.
      if (waiting || document.hidden) return;
      waiting = true;
      try {
        await ask.current();
      } finally {
        // One that failed asks again next time, as one that answered does.
        waiting = false;
        if (current) timer = setTimeout(askNow, everyMs);
      }
    };
    // Hidden, the next ask finds it so and waits; shown again, it asks at once.
    const shown = () => void askNow();
    timer = setTimeout(askNow, everyMs);
    document.addEventListener("visibilitychange", shown);
    return () => {
      current = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [asking, everyMs]);
};

/**
 * The last-known answer in `kept` for `key` (`undefined` until there's one), asked for with `load`
 * when the page shows it, again whenever `again` changes, and kept fresh the shared way
 * (`useFresh`): `busy` says, of what's known, how often to ask while it's busy. An answer `load`
 * can't give (`undefined`) keeps what was known. While `asking` is false, nothing is asked.
 */
export const useKept = <T,>(
  kept: Kept<T>,
  options: {
    key: string;
    load: () => Promise<T | undefined>;
    again?: unknown;
    asking?: boolean;
    busy?: (known: T) => number | undefined;
  },
): T | undefined => {
  const { key, asking = true, again } = options;
  const value = useSyncExternalStore(kept.subscribe, () => kept.get(key));
  const load = useRef(options.load);
  load.current = options.load;
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again as `again` changes
  useEffect(() => {
    if (!asking) return;
    let current = true;
    void load.current().then((loaded) => {
      if (current && loaded !== undefined) kept.set(key, loaded);
    });
    return () => {
      current = false;
    };
  }, [kept, key, asking, again]);
  useFresh({
    ask: async () => {
      const loaded = await load.current();
      if (loaded !== undefined) kept.set(key, loaded);
    },
    asking,
    busyEveryMs: value === undefined ? undefined : options.busy?.(value),
  });
  return value;
};

/**
 * A faint row the size of a real one: of a block (56 px), of a list of pull requests (76 px), a
 * line of a list (34 px), a line of text (20 px), a line in small type (16 px: a tile's line on
 * Home, #102), or a page's main panel (288 px: a pull request's files and diff).
 */
const ROWS = {
  row: "h-14 rounded-row bg-muted/50",
  tall: "h-19 rounded-row bg-muted/50",
  /** A bar row, as main's build on a code workspace's Home and New version on Home. */
  bar: "h-12.5 rounded-bubble bg-muted/50",
  /** One of Home's foot lines, as its problem line. */
  foot: "h-13 rounded-bubble bg-muted/50",
  line: "h-8.5 rounded-md bg-muted/50",
  text: "h-5 w-64 max-w-full rounded-sm bg-muted/50",
  label: "h-4 w-28 max-w-full rounded-sm bg-muted/50",
  panel: "h-72 rounded-card bg-muted/50",
} as const;

/**
 * Where a block's rows will be, while nothing is known of them yet: faint rows in the theme's
 * muted colour at a real row's height, no spinner and no words, so the block keeps its place and
 * is filled in place.
 */
export function PlaceholderRows(props: { count: number; size?: keyof typeof ROWS }) {
  const size = props.size ?? "row";
  return (
    <div aria-hidden data-placeholder="" className="flex flex-col gap-1.5">
      {Array.from({ length: props.count }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are only ever in this order
          key={index}
          className={ROWS[size]}
        />
      ))}
    </div>
  );
}
