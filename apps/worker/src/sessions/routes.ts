import {
  NewMessage,
  type ProviderList,
  SessionChange,
  type SessionDetail,
  type SessionList,
  type SessionSummary,
  StopRequest,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { apiError, readBody } from "../http.ts";
import type { Provider } from "../providers/index.ts";
import { err, ok } from "../result.ts";
import { getWorkspace } from "../workspaces/index.ts";
import type { SessionError, Sessions } from "./index.ts";

/** How often an idle event stream sends a comment, so proxies don't close it. */
const KEEP_ALIVE_MS = 25_000;

/** Where a subscriber wants to start: after this event number. Anything odd means the start. */
const Position = z.coerce.number().int().min(0).catch(0);

const sessionError = (c: Context, error: SessionError) => {
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
    case "running":
      return apiError(c, {
        status: 409,
        error: "A turn is running in this session. Stop it first, then delete the session.",
      });
    case "workspace-archived":
      return apiError(c, {
        status: 409,
        error: "This session's workspace is archived, so the session can't carry on.",
      });
    case "model-unavailable":
      return apiError(c, { status: 400, error: "That model isn't available right now." });
    case "storage":
      return apiError(c, { status: 500, error: error.message });
  }
};

/** The message a request sent, or the reason it isn't one. */
const readMessage = async (c: Context) => {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = NewMessage.safeParse(body);
  return parsed.success
    ? ok(parsed.data)
    : err(parsed.error.issues[0]?.message ?? "Send a message");
};

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
    if (!workspace.ok) return apiError(c, { status: 404, error: "No such workspace" });
    const list = await sessions.list(workspace.value.summary.id);
    if (!list.ok) return sessionError(c, list.error);
    return c.json({ sessions: list.value } satisfies SessionList);
  });

  routes.post("/workspaces/:id/sessions", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return apiError(c, { status: 404, error: "No such workspace" });
    const message = await readMessage(c);
    if (!message.ok) return apiError(c, { status: 400, error: message.error });
    const session = await sessions.create({
      workspaceId: workspace.value.summary.id,
      message: message.value,
    });
    if (!session.ok) return sessionError(c, session.error);
    return c.json(session.value satisfies SessionSummary, 201);
  });

  routes.get("/sessions/:id", async (c) => {
    const session = await sessions.get(c.req.param("id"));
    if (!session.ok) return sessionError(c, session.error);
    const workspace = await getWorkspace(contextDir, session.value.workspaceId);
    const workspaceArchived = !workspace.ok && workspace.error.kind === "archived";
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
    const message = await readMessage(c);
    if (!message.ok) return apiError(c, { status: 400, error: message.error });
    const sent = await sessions.send(c.req.param("id"), message.value);
    if (!sent.ok) return sessionError(c, sent.error);
    return c.body(null, 202);
  });

  routes.post("/sessions/:id/stop", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const request = StopRequest.safeParse(body);
    if (!request.success) return apiError(c, { status: 400, error: "Say which turn to stop" });
    const stopped = await sessions.stop(c.req.param("id"), request.data);
    if (!stopped.ok) return sessionError(c, stopped.error);
    return c.body(null, 202);
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
