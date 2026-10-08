import {
  CarryOnRequest,
  FirstMessage,
  GetToKnowRequest,
  NewMessage,
  type Overflow,
  type ProviderList,
  SaveEdit,
  SessionChange,
  type SessionDetail,
  type SessionList,
  type SessionSummary,
  StopRequest,
  type WorkspaceId,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { apiError, contextError, readBody } from "../http.ts";
import { GET_TO_KNOW } from "../prompts/index.ts";
import type { Provider } from "../providers/index.ts";
import type { NoteRefusal } from "../saves/index.ts";
import { getWorkspace, isArchived, listWorkspaces } from "../workspaces/index.ts";
import type { NoteAct, SessionError, Sessions } from "./index.ts";

/** How often an idle event stream sends a comment, so proxies don't close it. */
const KEEP_ALIVE_MS = 25_000;

/** Where a subscriber wants to start: after this event number. Anything odd means the start. */
const Position = z.coerce.number().int().min(0).catch(0);

/** Why the owner's Undo or Edit of a save didn't happen, in their words. */
const noteRefused = (refusal: NoteRefusal, act: NoteAct) => {
  switch (refusal.kind) {
    case "changed-since":
      return act === "undo"
        ? "That line has changed since, so Undo would lose the newer wording. Edit it instead."
        : "That line has changed since, so it can't be edited from here.";
    case "already-undone":
      return "This save is already undone.";
    case "already-back":
      return "That line is back in the context file already.";
    case "nothing-to-edit":
      return "A removed line has nothing to edit.";
    case "storage":
      return refusal.message;
  }
};

/** Why there's no other provider to carry on with, in the owner's words. */
const noOverflow = (overflow: Exclude<Overflow, { kind: "carry-on" }>) => {
  switch (overflow.kind) {
    case "sign-in":
      return `${overflow.label} isn't signed in. Sign in to ${overflow.label} on the home page to carry on there.`;
    case "at-limit": {
      const names = overflow.others.map((other) => other.label);
      return names.length === 1
        ? `${names.join("")} is at its usage limit too.`
        : `${names.join(" and ")} are at their usage limits too.`;
    }
    case "none":
      return "There's no other provider to carry on with.";
  }
};

/** A session error as the API answers it, for every route that acts on a session. */
export const sessionError = (c: Context, error: SessionError) => {
  switch (error.kind) {
    case "not-found":
      return apiError(c, { status: 404, error: "No such session" });
    case "busy":
      return apiError(c, {
        status: 409,
        error: "A turn is already running in this session. Wait for it to finish.",
      });
    case "nothing-running":
      return apiError(c, { status: 409, error: "Nothing is running in this session." });
    case "delete-while-running":
      return apiError(c, {
        status: 409,
        error: "A turn is running in this session. Stop it first, then delete the session.",
      });
    case "workspace-archived":
      return apiError(c, {
        status: 409,
        error: "This session's workspace is archived, so the session can't carry on.",
      });
    case "starting-fresh":
      return apiError(c, {
        status: 409,
        error: "Courtyard is starting fresh, or just has, so this didn't start. Reload the page.",
      });
    case "model-unavailable":
      return apiError(c, { status: 400, error: "That model isn't available right now." });
    case "effort-unavailable":
      return apiError(c, { status: 400, error: "That model doesn't take that effort." });
    case "nothing-to-carry-on":
      return apiError(c, {
        status: 409,
        error: "Only the session's last turn can carry on, once it has hit a usage limit.",
      });
    case "no-overflow":
      return apiError(c, { status: 409, error: noOverflow(error.overflow) });
    case "save-not-found":
      return apiError(c, { status: 404, error: "No such save in this session." });
    case "note-refused":
      return apiError(c, {
        status: error.refusal.kind === "storage" ? 500 : 409,
        error: noteRefused(error.refusal, error.act),
      });
    case "storage":
      return apiError(c, { status: 500, error: error.message });
  }
};

/** A save's event number in a path; anything else names no save. */
const SaveNumber = z.coerce.number().int().positive().catch(0);

/** Providers, sessions and their event streams, mounted under `/api`. */
export const sessionRoutes = (options: {
  sessions: Sessions;
  providers: readonly Provider[];
  contextDir: string;
}) => {
  const { sessions, providers, contextDir } = options;
  const routes = new Hono();

  routes.get("/providers", async (c) =>
    c.json({
      providers: await Promise.all(providers.map((p) => p.status())),
    } satisfies ProviderList),
  );

  routes.get("/workspaces/:id/sessions", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    const list = await sessions.list(workspace.value.summary.id);
    if (!list.ok) return sessionError(c, list.error);
    return c.json({ sessions: list.value } satisfies SessionList);
  });

  /** Starts a session in a workspace with its first message, and answers with the session. */
  const startIn = async (
    c: Context,
    start: { workspaceId: WorkspaceId; message: FirstMessage; starter?: boolean },
  ) => {
    const session = await sessions.create(start);
    if (!session.ok) return sessionError(c, session.error);
    return c.json(session.value satisfies SessionSummary, 201);
  };

  routes.post("/workspaces/:id/sessions", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    const message = await readBody(c, FirstMessage);
    if (!message.ok) return apiError(c, { status: 400, error: message.error });
    return startIn(c, { workspaceId: workspace.value.summary.id, message: message.value });
  });

  /**
   * Gets to know a workspace or the owner context: a session in `workspaceId` started with the
   * worker's own starter message (docs/ai-conduct.md, Getting to know a workspace), answered by
   * the model the request names.
   */
  const getToKnow = async (c: Context, start: { workspaceId: WorkspaceId; text: string }) => {
    const body = await readBody(c, GetToKnowRequest);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const message = { text: start.text, model: body.value.model };
    return startIn(c, { workspaceId: start.workspaceId, message, starter: true });
  };

  routes.post("/workspaces/:id/get-to-know", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    const { summary } = workspace.value;
    if (summary.mode === "code") {
      return apiError(c, {
        status: 409,
        error:
          "A code workspace's models don't save to its context file, so it can't get to know it.",
      });
    }
    return getToKnow(c, { workspaceId: summary.id, text: GET_TO_KNOW.workspace });
  });

  routes.post("/owner-context/get-to-know", async (c) => {
    const workspaces = await listWorkspaces(contextDir);
    if (!workspaces.ok) return contextError(c, workspaces.error);
    // A session needs a workspace, and only a planning workspace's models save to About me.
    const home = workspaces.value.find((workspace) => workspace.mode === "planning");
    if (home === undefined) {
      return apiError(c, {
        status: 409,
        error: "Add a planning workspace first: getting to know you happens in a session in one.",
      });
    }
    return getToKnow(c, { workspaceId: home.id, text: GET_TO_KNOW.owner });
  });

  routes.get("/sessions/:id", async (c) => {
    const session = await sessions.get(c.req.param("id"));
    if (!session.ok) return sessionError(c, session.error);
    const workspaceArchived = await isArchived(contextDir, session.value.workspaceId);
    return c.json({ ...session.value, workspaceArchived } satisfies SessionDetail);
  });

  routes.patch("/sessions/:id", async (c) => {
    const body = await readBody(c, SessionChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const session = await sessions.rename(c.req.param("id"), body.value.title);
    if (!session.ok) return sessionError(c, session.error);
    return c.json(session.value satisfies SessionSummary);
  });

  routes.delete("/sessions/:id", async (c) => {
    const removed = await sessions.remove(c.req.param("id"));
    if (!removed.ok) return sessionError(c, removed.error);
    return c.body(null, 204);
  });

  routes.post("/sessions/:id/messages", async (c) => {
    const message = await readBody(c, NewMessage);
    if (!message.ok) return apiError(c, { status: 400, error: message.error });
    const sent = await sessions.send(c.req.param("id"), message.value);
    if (!sent.ok) return sessionError(c, sent.error);
    return c.body(null, 202);
  });

  routes.post("/sessions/:id/carry-on", async (c) => {
    const request = await readBody(c, CarryOnRequest);
    if (!request.ok) return apiError(c, { status: 400, error: "Say which turn to carry on" });
    const carried = await sessions.carryOn(c.req.param("id"), request.value);
    if (!carried.ok) return sessionError(c, carried.error);
    return c.body(null, 202);
  });

  routes.post("/sessions/:id/stop", async (c) => {
    const request = await readBody(c, StopRequest);
    if (!request.ok) return apiError(c, { status: 400, error: "Say which turn to stop" });
    const stopped = await sessions.stop(c.req.param("id"), request.value);
    if (!stopped.ok) return sessionError(c, stopped.error);
    return c.body(null, 202);
  });

  routes.post("/sessions/:id/saves/:save/undo", async (c) => {
    const undone = await sessions.undoSave({
      rawId: c.req.param("id"),
      save: SaveNumber.parse(c.req.param("save")),
    });
    if (!undone.ok) return sessionError(c, undone.error);
    return c.body(null, 204);
  });

  routes.post("/sessions/:id/saves/:save/edit", async (c) => {
    const body = await readBody(c, SaveEdit);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const save = SaveNumber.parse(c.req.param("save"));
    const edited = await sessions.editSave({ rawId: c.req.param("id"), save, now: body.value });
    if (!edited.ok) return sessionError(c, edited.error);
    return c.body(null, 204);
  });

  // Replays everything after a position, then follows live (ADR 0006). A browser that reconnects
  // sends the last event id it saw, so it carries on with nothing missing or repeated.
  routes.get("/sessions/:id/events", async (c) => {
    const after = Position.parse(c.req.header("last-event-id") ?? c.req.query("after"));
    const session = await sessions.get(c.req.param("id"));
    if (!session.ok) return sessionError(c, session.error);

    return streamSSE(c, async (stream) => {
      // Listen for the browser leaving before anything else, so it can't leave unnoticed while
      // the subscription is still being set up.
      const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
      let sending: Promise<unknown> = Promise.resolve();
      const send = (write: () => Promise<unknown>) => {
        sending = sending.then(write).catch(() => undefined);
      };

      const subscribed = await sessions.subscribe({
        sessionId: session.value.id,
        after,
        onEvent: (event) =>
          send(() => stream.writeSSE({ id: String(event.seq), data: JSON.stringify(event) })),
      });
      if (!subscribed.ok) {
        // A named event the page shows, instead of an empty stream it would retry forever.
        const message =
          subscribed.error.kind === "storage" ? subscribed.error.message : "No such session";
        await stream.writeSSE({ event: "problem", data: JSON.stringify({ error: message }) });
        return;
      }
      if (stream.aborted) {
        subscribed.value();
        return;
      }

      const keepAlive = setInterval(
        () => send(() => stream.write(": keep-alive\n\n")),
        KEEP_ALIVE_MS,
      );
      await closed;
      clearInterval(keepAlive);
      subscribed.value();
    });
  });

  return routes;
};
