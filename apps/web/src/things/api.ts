import {
  type SessionId,
  THING_PHOTO_FIELD,
  ThingChanged,
  ThingDeleted,
  ThingDetail,
  type ThingForm,
  ThingList,
  ThingSlug,
  type ThingSummary,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { type FromWorker, fromWorker, NOT_FOUND, readResponse, sendJson } from "../worker.ts";

// Things' calls live with Things rather than in worker.ts, so their schemas stay off the first
// load.

const thingsOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/things`;

/** A workspace's Things, each part straight after the Thing it's part of (ADR 0020). */
export const loadThings = (workspaceId: WorkspaceId) =>
  fromWorker(thingsOf(workspaceId), ThingList);

/** One Thing for its card, by its address's workspace and file name, with the workspace's Things. */
export const loadThing = async (at: { workspaceId: string; slug: string }) => {
  const workspaceId = WorkspaceId.safeParse(at.workspaceId);
  const slug = ThingSlug.safeParse(at.slug);
  if (!workspaceId.success || !slug.success) return { thing: NOT_FOUND, list: NOT_FOUND };
  const [thing, list] = await Promise.all([
    fromWorker(`${thingsOf(workspaceId.data)}/${slug.data}`, ThingDetail),
    loadThings(workspaceId.data),
  ]);
  return { thing, list };
};

/** Adds a Thing from the owner's form. */
export const addThing = (workspaceId: WorkspaceId, form: ThingForm) =>
  sendJson({ path: thingsOf(workspaceId), body: form, schema: ThingChanged });

/** Changes a Thing from the owner's form: every field, a blank one cleared. */
export const changeThing = (workspaceId: WorkspaceId, slug: ThingSlug, form: ThingForm) =>
  sendJson({
    path: `${thingsOf(workspaceId)}/${slug}`,
    method: "PUT",
    body: form,
    schema: ThingChanged,
  });

/** Deletes a Thing and its photo, as a change Undo brings back. */
export const deleteThing = (workspaceId: WorkspaceId, slug: ThingSlug) =>
  sendJson({
    path: `${thingsOf(workspaceId)}/${slug}`,
    method: "DELETE",
    body: {},
    schema: ThingDeleted,
  });

/** Sets a Thing's photo from one the owner picked; the worker keeps a resized copy. */
export const uploadThingPhoto = async (
  workspaceId: WorkspaceId,
  slug: ThingSlug,
  photo: File,
): Promise<FromWorker<ThingChanged>> => {
  const form = new FormData();
  form.set(THING_PHOTO_FIELD, photo);
  try {
    const response = await fetch(`/api${thingsOf(workspaceId)}/${slug}/photo`, {
      method: "POST",
      body: form,
    });
    return await readResponse({ response, schema: ThingChanged, unauthorised: "logged-out" });
  } catch {
    return { kind: "offline" };
  }
};

/** Where a Thing's photo is served from, named by when the Thing last changed so a new one shows. */
export const thingPhotoUrl = (workspaceId: WorkspaceId, thing: ThingSummary) =>
  `/api${thingsOf(workspaceId)}/${thing.slug}/photo?at=${encodeURIComponent(thing.updatedAt)}`;

/** Undoes one of a session's Thing saves, named by its event number (ADR 0020). */
export const undoThingSave = (sessionId: SessionId, save: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/things/${save}/undo`,
    body: {},
    schema: z.unknown(),
  });
