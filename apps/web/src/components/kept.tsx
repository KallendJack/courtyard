import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Nothing jumps in late (owner, 2026-10-12): what a page loads after it shows is kept in memory
 * for as long as the tab is open, one store per kind of answer (`createKept`), by a key naming
 * whose it is (a workspace's id). A page that comes back shows the last-known answer at once and
 * asks again quietly, updating in place (`useKept`); one with nothing known yet shows its block's
 * placeholder rows (`PlaceholderRows`) in the block's place until the answer comes. Its classes
 * are in the stylesheet of the page that shows it (code-home.css, home.css), off the first load.
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

/**
 * The last-known answer in `kept` for `key` (`undefined` until there's one), asked for with `load`
 * when the page shows it and again whenever `again` changes. An answer `load` can't give
 * (`undefined`) keeps what was known. While `asking` is false, nothing is asked.
 */
export const useKept = <T,>(
  kept: Kept<T>,
  options: {
    key: string;
    load: () => Promise<T | undefined>;
    again?: unknown;
    asking?: boolean;
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
  return value;
};

/**
 * A faint row the size of a real one: of a block (56 px), of a list of pull requests (76 px), a
 * line of a list (34 px), a line of text (20 px), or a line in small type (16 px: a tile's line on
 * Home, #102).
 */
const ROWS = {
  row: "h-14 rounded-row bg-muted/50",
  tall: "h-19 rounded-row bg-muted/50",
  line: "h-8.5 rounded-md bg-muted/50",
  text: "h-5 w-64 max-w-full rounded-sm bg-muted/50",
  label: "h-4 w-28 max-w-full rounded-sm bg-muted/50",
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
