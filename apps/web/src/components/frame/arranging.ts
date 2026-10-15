import type { WorkspaceId, WorkspaceSummary } from "@courtyard/contract";
import { arrangeWorkspaces } from "../../api/worker.ts";
import { type Arranging, dragging, type Press } from "./arrange.ts";

/**
 * Arrange workspaces (#321), loaded with the first press on a workspace (arrange.ts): the drag,
 * the keyboard's moves, and saving the order. Held still this long, a workspace lifts and follows
 * the pointer, its slot showing where it lands in its group, until it's let go.
 */
const HOLD_MS = 350;
/** Moved further than this before it lifts, a touch is a scroll; the mouse lifts it at once. */
const SLOP_PX = 8;

const isCode = (workspace: WorkspaceSummary) => workspace.mode === "code";

/** A workspace's group: the planning ones, or the code ones. */
const groupOf = (list: readonly WorkspaceSummary[], workspace: WorkspaceSummary) =>
  list.filter((each) => isCode(each) === isCode(workspace));

/** The list with workspace `id` moved to `at` in its own group: planning ones first, then code. */
export const moved = (list: readonly WorkspaceSummary[], id: WorkspaceId, at: number) => {
  const workspace = list.find((each) => each.id === id);
  if (workspace === undefined) return list;
  const group = groupOf(list, workspace).filter((each) => each !== workspace);
  group.splice(at, 0, workspace);
  const others = list.filter((each) => isCode(each) !== isCode(workspace));
  return isCode(workspace) ? [...others, ...group] : [...group, ...others];
};

/** The list in the order given, while the worker saves it. */
export const inOrder = (list: readonly WorkspaceSummary[], order: readonly WorkspaceId[]) => {
  const place = new Map(order.map((id, index) => [id, index]));
  return [...list].sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
};

/**
 * Puts workspace `id` at `at` in its group and saves the order, showing it so at once; it goes
 * back if it can't be saved. Let go where it was, it `stayed`.
 */
const drop = (list: Arranging, id: WorkspaceId, at: number, by: "drag" | "key") => {
  list.show(undefined);
  const workspace = list.base.find((each) => each.id === id);
  if (workspace === undefined) return;
  const group = groupOf(list.base, workspace);
  const to = Math.max(0, Math.min(at, group.length - 1));
  if (to === group.indexOf(workspace)) {
    if (by === "drag") list.stayed?.(workspace);
    return;
  }
  const order = moved(list.base, id, to).map((each) => each.id);
  list.saving(order);
  void arrangeWorkspaces(order).then((saved) =>
    saved.kind === "loaded" ? list.saved() : list.saving(undefined),
  );
};

/** Moves workspace `id` a place up (`step` -1) or down (1) in its group, from the keyboard. */
export const nudge = (list: Arranging, id: WorkspaceId, step: number) => {
  const workspace = list.base.find((each) => each.id === id);
  if (workspace !== undefined)
    drop(list, id, groupOf(list.base, workspace).indexOf(workspace) + step, "key");
};

/** Stops what the browser would do with an event: open a link, or show a menu. */
const swallow = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
};

/** A workspace lifted: the middle of each slot in its group, and where on it the pointer holds. */
type Lifted = {
  readonly mids: readonly number[];
  readonly grab: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
};

/** Takes over a press on a workspace, lifting it once it's held. `list` is its list as it is now. */
export const hold = (press: Press, list: () => Arranging) => {
  if (press.released) return;
  let pointer = { x: press.x, y: press.y };
  let lifted: Lifted | undefined;

  /** The slot nearest the tile's middle: over the other group, the nearest end of its own. */
  const slot = ({ mids, grab, height }: Lifted) => {
    const middle = pointer.y - grab.y + height / 2;
    const distances = mids.map((mid) => Math.abs(mid - middle));
    return distances.indexOf(Math.min(...distances));
  };

  const show = (held: Lifted) =>
    list().show({
      id: press.id,
      at: slot(held),
      x: pointer.x - held.grab.x,
      y: pointer.y - held.grab.y,
      width: held.width,
      height: held.height,
    });

  const lift = () => {
    if (press.released || lifted !== undefined) return;
    const group = press.element.closest("[data-arrange-group]");
    const tiles = [...(group?.querySelectorAll<HTMLElement>("[data-arrange]") ?? [])];
    const box = press.element.getBoundingClientRect();
    lifted = {
      mids: tiles.map((tile) => {
        const { top, height } = tile.getBoundingClientRect();
        return top + height / 2;
      }),
      grab: { x: press.x - box.left, y: press.y - box.top },
      width: box.width,
      height: box.height,
    };
    dragging.now = true;
    // Held, it's the drag's: not the browser's menu, nor the rail's recent sessions.
    window.addEventListener("contextmenu", swallow, true);
    show(lifted);
  };

  const end = () => {
    clearTimeout(timer);
    window.removeEventListener("pointermove", moved);
    window.removeEventListener("pointerup", letGo);
    window.removeEventListener("pointercancel", cancelled);
    if (lifted === undefined) return;
    dragging.now = false;
    // The click that ends a drag isn't a tap on the workspace.
    window.addEventListener("click", swallow, true);
    setTimeout(() => {
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("contextmenu", swallow, true);
    });
  };

  const moved = (event: PointerEvent) => {
    if (event.pointerId !== press.pointerId) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (lifted !== undefined) return show(lifted);
    if (Math.hypot(pointer.x - press.x, pointer.y - press.y) <= SLOP_PX) return;
    if (press.pointerType === "mouse") lift();
    else end();
  };

  const letGo = (event: PointerEvent) => {
    if (event.pointerId !== press.pointerId) return;
    pointer = { x: event.clientX, y: event.clientY };
    const held = lifted;
    end();
    if (held !== undefined) drop(list(), press.id, slot(held), "drag");
  };

  const cancelled = (event: PointerEvent) => {
    if (event.pointerId !== press.pointerId) return;
    const held = lifted;
    end();
    if (held !== undefined) list().show(undefined);
  };

  const timer = setTimeout(lift, Math.max(0, press.at + HOLD_MS - performance.now()));
  window.addEventListener("pointermove", moved);
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", cancelled);
};
