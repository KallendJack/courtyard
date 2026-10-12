import type { WorkspaceId, WorkspaceSummary } from "@courtyard/contract";
import { useRouter } from "@tanstack/react-router";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefCallback,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Arrange workspaces (#321, Paper board "Tablet · Arrange workspaces"): hold a workspace on the
 * rail (tablet) or the sidebar (desktop) and drag it up or down within its group; letting go saves
 * the order on the worker, so every list of workspaces follows it. Alt+↑ and Alt+↓ move a focused
 * one a place, for the keyboard and screen readers. Only the press is here, on the first load: the
 * rest (arranging.ts) loads with the first press.
 */

/** A workspace held to move it: its slot in its group, and where its lifted copy is drawn. */
export type Held = {
  readonly id: WorkspaceId;
  /** Its slot: where it lands in its group when let go. */
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A press on a workspace, handed to the drag once its code has loaded. */
export type Press = {
  readonly id: WorkspaceId;
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
  readonly at: number;
  /** Let go (or taken by the browser, for a scroll) before the drag's code had loaded. */
  released: boolean;
};

/** One list of workspaces being arranged, as it is now, for the drag to act on. */
export type Arranging = {
  /** The workspaces in the order shown, before any held one moves. */
  readonly base: readonly WorkspaceSummary[];
  /** A workspace let go where it was. */
  readonly stayed: ((workspace: WorkspaceSummary) => void) | undefined;
  readonly show: (held: Held | undefined) => void;
  /** The order being saved, shown until the worker's list comes back; none if it failed. */
  readonly saving: (order: readonly WorkspaceId[] | undefined) => void;
  /** Saved: every list of workspaces loads it. */
  readonly saved: () => void;
};

/** While a workspace is held, touch moves are the drag's, not a scroll of the rail or sidebar. */
export const dragging = { now: false };

/** The dashed slot where a held workspace lands. */
export const ARRANGE_SLOT = "border-2 border-dashed border-primary-text bg-primary-text/8";
/** A held workspace's lifted copy, drawn over everything at the pointer. */
export const ARRANGE_HELD =
  "pointer-events-none fixed z-50 bg-muted font-bold text-foreground ring-2 ring-primary-text shadow-lifted";

/** The rest of arranging, once a first press has loaded it. */
let drag: typeof import("./arranging.ts") | undefined;
const loadDrag = () =>
  import("./arranging.ts").then((loaded) => {
    drag = loaded;
    return loaded;
  });

/**
 * Arranging for one list of workspaces: the order to show them in, the one held, and what each
 * workspace's tile or row takes to be held. Each group's list carries `group` as its ref and
 * `data-arrange-group`; each tile `data-arrange` with its id. `stayed` is a workspace let go where
 * it was (the rail shows the open one's recent sessions).
 */
export const useArrange = (options: {
  workspaces: readonly WorkspaceSummary[];
  stayed?: (workspace: WorkspaceSummary) => void;
}) => {
  const router = useRouter();
  const [saving, setSaving] = useState<readonly WorkspaceId[]>();
  const [held, setHeld] = useState<Held>();
  // The worker's list, once it comes back, replaces the order kept while saving.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list from the worker is the trigger
  useEffect(() => setSaving(undefined), [options.workspaces]);
  const base =
    saving === undefined || drag === undefined
      ? options.workspaces
      : drag.inOrder(options.workspaces, saving);
  const current: Arranging = {
    base,
    stayed: options.stayed,
    show: setHeld,
    saving: setSaving,
    saved: () => void router.invalidate(),
  };
  // The drag acts on the list as it is when it acts, not as it was when it was pressed.
  const now = useRef(current);
  now.current = current;
  const list = () => now.current;

  /** The props a workspace's tile or row takes. */
  const handle = (workspace: WorkspaceSummary) => ({
    "data-arrange": workspace.id,
    draggable: false,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      const press: Press = {
        id: workspace.id,
        element: event.currentTarget,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
        released: false,
      };
      const release = () => {
        press.released = true;
      };
      window.addEventListener("pointerup", release, { once: true });
      window.addEventListener("pointercancel", release, { once: true });
      void loadDrag().then((loaded) => loaded.hold(press, list));
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (step === undefined || !event.altKey) return;
      event.preventDefault();
      const group = event.currentTarget.closest("[data-arrange-group]");
      void loadDrag().then((loaded) => {
        loaded.nudge(list(), workspace.id, step);
        // Moving it in the page can lose the focus; it stays on the workspace moved.
        requestAnimationFrame(() =>
          group?.querySelector<HTMLElement>(`[data-arrange="${workspace.id}"]`)?.focus(),
        );
      });
    },
  });

  /** A group's list: a touch that holds a workspace there moves it rather than scrolling. */
  const group = useCallback<RefCallback<HTMLElement>>((element) => {
    if (element === null) return;
    const holdStill = (event: TouchEvent) => {
      if (dragging.now) event.preventDefault();
    };
    element.addEventListener("touchmove", holdStill, { passive: false });
    return () => element.removeEventListener("touchmove", holdStill);
  }, []);

  return {
    workspaces:
      held === undefined || drag === undefined ? base : drag.moved(base, held.id, held.at),
    held,
    handle,
    group,
  };
};
