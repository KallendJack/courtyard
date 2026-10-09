import { readFile } from "node:fs/promises";
import {
  THING_FORM_FIELD,
  THING_PHOTO_FIELD,
  type ThingChanged,
  type ThingDeleted,
  type ThingDetail,
  ThingForm,
  type ThingList,
  ThingSlug,
  WorkspaceId,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { prepareAttachments } from "../attachments/index.ts";
import { apiError, contextError, readWithFiles } from "../http.ts";
import { err, ok, type Result } from "../result.ts";
import {
  getThing,
  keptPhoto,
  readThings,
  saveThing,
  type ThingEdit,
  type ThingRefusal,
  type ThingTarget,
  type ThingUndoRefusal,
  thingPhoto,
} from "./index.ts";

/** A workspace's Things, a Thing, and its photo: the routes under `/api`. */
const ROUTES = {
  things: "/workspaces/:id/things",
  thing: "/workspaces/:id/things/:slug",
  photo: "/workspaces/:id/things/:slug/photo",
} as const;

/**
 * The requests that may send a Thing's photo as a multipart form (ADR 0020): Add Thing and Edit
 * with one, the form's fields as JSON in one field and the photo in another, and Change photo.
 */
export const THING_PHOTO_ROUTES = [
  { method: "POST", route: ROUTES.things },
  { method: "PUT", route: ROUTES.thing },
  { method: "POST", route: ROUTES.photo },
] as const;

/** Why a Thing wasn't saved, removed, read or undone, as the API answers it. */
export const thingError = (c: Context, refusal: ThingRefusal | ThingUndoRefusal) => {
  switch (refusal.kind) {
    case "workspace":
      return contextError(c, refusal.error);
    case "code-workspace":
      return apiError(c, { status: 409, error: "Only planning workspaces keep Things." });
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "incomplete":
      return apiError(c, { status: 400, error: "Give the Thing a name and a status." });
    case "clash":
      return apiError(c, {
        status: 409,
        error: `There's already a Thing called ${refusal.name}. Choose another name.`,
      });
    case "not-found":
      return apiError(c, { status: 404, error: "No such Thing." });
    case "unreadable":
      return apiError(c, {
        status: 409,
        error: `${refusal.path} can't be read as a Thing, so it can't be changed here: ${refusal.problem}`,
      });
    case "no-such-parent":
      return apiError(c, { status: 400, error: "The Thing it's part of isn't there." });
    case "nested":
      return apiError(c, {
        status: 400,
        error:
          "A Thing can be part of one that isn't a part itself, and a Thing with parts can't be part of another.",
      });
    case "has-parts":
      return apiError(c, {
        status: 409,
        error: `Its parts come first: delete ${refusal.parts.join(", ")}, or make them part of something else.`,
      });
    case "stale":
      return apiError(c, {
        status: 409,
        error: "That Thing has changed since, so this would lose the newer change.",
      });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "bad-photo":
      return apiError(c, { status: 400, error: "That photo can't be read." });
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "That Thing has changed since, so undoing this would lose the newer change.",
      });
    case "not-undoable":
      return apiError(c, { status: 409, error: "This change can't be undone from here." });
    case "already-undone":
      return apiError(c, { status: 409, error: "This change is already undone." });
    case "storage":
      return apiError(c, {
        status: 500,
        error: "The workspace's Things can't be read or written.",
      });
  }
};

/** Every field of the owner's form as a save sets it: a blank or missing one cleared. */
const fromForm = (form: ThingForm): NonNullable<ThingEdit["fields"]> => ({
  name: form.name,
  status: form.status,
  brand: form.brand || null,
  bought: form.bought || null,
  price: form.price || null,
  condition: form.condition || null,
  size: form.size || null,
  where: form.where || null,
  partOf: form.partOf || null,
});

/**
 * A photo the owner sent, checked as an attachment is and kept as a Thing keeps one; or the answer
 * refusing it.
 */
const photoKept = async (c: Context, file: File): Promise<Result<Uint8Array, Response>> => {
  const checked = await prepareAttachments([file]);
  if (!checked.ok) return err(apiError(c, { status: 400, error: checked.error }));
  const [photo] = checked.value;
  if (photo?.attachment.kind !== "photo") {
    return err(apiError(c, { status: 400, error: "A Thing's photo is a photo, not a PDF." }));
  }
  const kept = await keptPhoto(photo.bytes);
  return kept === undefined ? err(thingError(c, { kind: "bad-photo" })) : ok(kept);
};

/**
 * What Add Thing or Edit sent: every field, and the photo with them when there's one, so both are
 * one change with one Undo. JSON on its own, or a multipart form with the fields' JSON in one field
 * and the photo in another. Or the answer refusing it.
 */
const formSent = async (c: Context): Promise<Result<Omit<ThingEdit, "slug">, Response>> => {
  const sent = await readWithFiles(c, {
    schema: ThingForm,
    fields: { json: THING_FORM_FIELD, files: THING_PHOTO_FIELD },
  });
  if (!sent.ok) return err(apiError(c, { status: 400, error: sent.error }));
  const fields = fromForm(sent.value.body);
  const [file, ...more] = sent.value.files;
  if (more.length > 0) return err(apiError(c, { status: 400, error: "Send one photo." }));
  if (file === undefined) return ok({ fields });
  const photo = await photoKept(c, file);
  return photo.ok ? ok({ fields, photo: photo.value }) : photo;
};

/** A workspace's Things, under `/api`: listed, read, added, changed, deleted, and their photos. */
export const thingRoutes = (
  target: Pick<ThingTarget, "contextDir" | "contextFolder"> & { now: () => number },
) => {
  const routes = new Hono();
  const { now, ...where } = target;

  /** The target for the workspace a path names, or `undefined` when it can't name one. */
  const inWorkspace = (c: Context) => {
    const id = WorkspaceId.safeParse(c.req.param("id"));
    return id.success ? { ...where, workspaceId: id.data } : undefined;
  };
  /** The workspace and the Thing a path names, or `undefined` when it can't name one. */
  const thingIn = (c: Context) => {
    const workspace = inWorkspace(c);
    const slug = ThingSlug.safeParse(c.req.param("slug"));
    return workspace === undefined || !slug.success ? undefined : { workspace, slug: slug.data };
  };
  const noSuchThing = (c: Context) => apiError(c, { status: 404, error: "No such Thing." });

  /** A Thing as saved, as the API answers it. */
  const changed = async (
    c: Context,
    workspace: Pick<ThingTarget, "contextDir" | "workspaceId">,
    saved: Awaited<ReturnType<typeof saveThing>>,
    status: 200 | 201,
  ) => {
    if (!saved.ok) return thingError(c, saved.error);
    const now = await getThing(workspace, saved.value.save.thing.slug);
    if (!now.ok) return thingError(c, now.error);
    return c.json(
      { change: saved.value.change ?? null, thing: now.value.summary } satisfies ThingChanged,
      status,
    );
  };

  routes.get(ROUTES.things, async (c) => {
    const workspace = inWorkspace(c);
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const read = await readThings(workspace);
    if (!read.ok) return thingError(c, read.error);
    return c.json({
      things: read.value.things.map(({ summary }) => summary),
      problems: [...read.value.problems],
    } satisfies ThingList);
  });

  routes.post(ROUTES.things, async (c) => {
    const workspace = inWorkspace(c);
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const sent = await formSent(c);
    if (!sent.ok) return sent.error;
    const saved = await saveThing(workspace, sent.value, { now: now() });
    return changed(c, workspace, saved, 201);
  });

  routes.get(ROUTES.thing, async (c) => {
    const named = thingIn(c);
    if (named === undefined) return noSuchThing(c);
    const found = await getThing(named.workspace, named.slug);
    if (!found.ok) return thingError(c, found.error);
    return c.json({
      thing: found.value.summary,
      history: [...found.value.history].reverse(),
    } satisfies ThingDetail);
  });

  routes.put(ROUTES.thing, async (c) => {
    const named = thingIn(c);
    if (named === undefined) return noSuchThing(c);
    const sent = await formSent(c);
    if (!sent.ok) return sent.error;
    const saved = await saveThing(
      named.workspace,
      { slug: named.slug, ...sent.value },
      { now: now() },
    );
    return changed(c, named.workspace, saved, 200);
  });

  routes.delete(ROUTES.thing, async (c) => {
    const named = thingIn(c);
    if (named === undefined) return noSuchThing(c);
    const removed = await saveThing(
      named.workspace,
      { slug: named.slug, remove: true },
      { now: now() },
    );
    if (!removed.ok) return thingError(c, removed.error);
    return c.json({ change: removed.value.change ?? null } satisfies ThingDeleted);
  });

  routes.get(ROUTES.photo, async (c) => {
    const named = thingIn(c);
    if (named === undefined) return noSuchThing(c);
    const photo = await thingPhoto(named.workspace, named.slug);
    if (!photo.ok) return thingError(c, photo.error);
    if (photo.value === undefined) return apiError(c, { status: 404, error: "No photo." });
    try {
      const bytes = await readFile(photo.value);
      return c.body(new Uint8Array(bytes), 200, {
        "content-type": "image/jpeg",
        "cache-control": "no-cache",
      });
    } catch {
      return thingError(c, { kind: "storage" });
    }
  });

  routes.post(ROUTES.photo, async (c) => {
    const named = thingIn(c);
    if (named === undefined) return noSuchThing(c);
    const form = await c.req.formData().catch(() => undefined);
    const file = form?.get(THING_PHOTO_FIELD);
    if (!(file instanceof File)) {
      return apiError(c, { status: 400, error: "Send a photo." });
    }
    const kept = await photoKept(c, file);
    if (!kept.ok) return kept.error;
    const saved = await saveThing(
      named.workspace,
      { slug: named.slug, photo: kept.value },
      { now: now() },
    );
    return changed(c, named.workspace, saved, 200);
  });

  return routes;
};
