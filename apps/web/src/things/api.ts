import {
  type SessionId,
  THING_FORM_FIELD,
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
import { sendForm } from "../send-form.ts";
import { fromWorker, NOT_FOUND, sendJson } from "../worker.ts";

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

/**
 * Sends the owner's form, with the photo they picked when there's one: JSON on its own, or one
 * multipart form with both, so the worker saves them as one change with one Undo.
 */
const sendThing = (send: {
  path: string;
  method: "POST" | "PUT";
  form: ThingForm;
  photo: File | undefined;
}) => {
  const { path, method, form, photo } = send;
  if (photo === undefined) return sendJson({ path, method, body: form, schema: ThingChanged });
  const multipart = new FormData();
  multipart.set(THING_FORM_FIELD, JSON.stringify(form));
  multipart.set(THING_PHOTO_FIELD, photo);
  return sendForm({ path, method, form: multipart, schema: ThingChanged });
};

/** Adds a Thing from the owner's form, with its photo if they picked one. */
export const addThing = (workspaceId: WorkspaceId, form: ThingForm, photo?: File) =>
  sendThing({ path: thingsOf(workspaceId), method: "POST", form, photo });

/**
 * Changes a Thing from the owner's form: every field, a blank one cleared, and its photo if they
 * picked a new one.
 */
export const changeThing = (change: {
  workspaceId: WorkspaceId;
  slug: ThingSlug;
  form: ThingForm;
  photo: File | undefined;
}) =>
  sendThing({
    path: `${thingsOf(change.workspaceId)}/${change.slug}`,
    method: "PUT",
    form: change.form,
    photo: change.photo,
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
export const uploadThingPhoto = (workspaceId: WorkspaceId, slug: ThingSlug, photo: File) => {
  const form = new FormData();
  form.set(THING_PHOTO_FIELD, photo);
  return sendForm({ path: `${thingsOf(workspaceId)}/${slug}/photo`, form, schema: ThingChanged });
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
