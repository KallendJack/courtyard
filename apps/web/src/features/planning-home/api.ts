import {
  type HomeViewId,
  type HomeViewPick,
  PlanningHome,
  ThingChanged,
  type ThingMark,
  type ThingPin,
  type ThingPinMove,
  type ThingSlug,
  type WorkspaceId,
} from "@courtyard/contract";
import { type FromWorker, fromWorker, sendJson } from "../../api/worker.ts";
import { createKept } from "../../components/layout/kept.tsx";

// A planning workspace's Home's calls (#208, #481), beside it so their schemas stay off the first
// load.

const homeOf = (workspaceId: WorkspaceId) => `/workspaces/${encodeURIComponent(workspaceId)}/home`;
const thingOf = (workspaceId: WorkspaceId, slug: ThingSlug) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/things/${slug}`;

/** Each planning workspace's Home as last heard, by its id, so a revisit shows it at once. */
export const KEPT_HOME = createKept<PlanningHome>();

/** A planning workspace's Home: its views, the one showing, its photo and the last question. */
export const loadHome = (workspaceId: WorkspaceId) =>
  fromWorker(homeOf(workspaceId), PlanningHome);

/** Home again, kept for the next visit: nothing when the worker didn't answer. */
export const loadKeptHome = async (workspaceId: WorkspaceId) => {
  const home = await loadHome(workspaceId);
  if (home.kind !== "loaded") return undefined;
  KEPT_HOME.set(workspaceId, home.data);
  return home.data;
};

/** The owner's pick of the view Home shows, which sticks; Home as it is then. */
export const pickView = (workspaceId: WorkspaceId, view: HomeViewId) =>
  sendJson({
    path: `${homeOf(workspaceId)}/showing`,
    method: "PUT",
    body: { view } satisfies HomeViewPick,
    schema: PlanningHome,
  });

/** A part's pin, where the owner dragged it on its Thing's photo. */
export const movePin = (workspaceId: WorkspaceId, slug: ThingSlug, pin: ThingPin) =>
  sendJson({
    path: `${thingOf(workspaceId, slug)}/pin`,
    method: "PUT",
    body: { pin } satisfies ThingPinMove,
    schema: ThingChanged,
  });

/** Done it, or Add to wanted, from a part's card. */
export const markThing = (
  workspaceId: WorkspaceId,
  slug: ThingSlug,
  mark: ThingMark["mark"],
): Promise<FromWorker<ThingChanged>> =>
  sendJson({
    path: `${thingOf(workspaceId, slug)}/mark`,
    method: "PUT",
    body: { mark } satisfies ThingMark,
    schema: ThingChanged,
  });
