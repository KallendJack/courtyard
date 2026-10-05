import {
  type ApiError,
  NewMessage,
  type ProviderList,
  type SessionList,
  type SessionSummary,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Provider } from "../providers/index.ts";
import { err, ok } from "../result.ts";
import { getWorkspace } from "../workspaces/index.ts";
import type { SessionError, Sessions } from "./index.ts";

/** How often an idle event stream sends a comment, so proxies don't close it. */
const KEEP_ALIVE_MS = 25_000;

const apiError = (c: Context, error: string, status: 400 | 404 | 409 | 500) =>
  c.json({ error } satisfies ApiError, status);

const sessionError = (c: Context, error: SessionError) => {
  switch (error.kind) {
    case "not-found":
      return apiError(c, "No such session", 404);
    case "busy":
      return apiError(c, "A turn is already running in this session. Wait for it to finish.", 409);
    case "model-unavailable":
      return apiError(c, "That model isn't available right now.", 400);
    case "storage":
      return apiError(c, error.message, 500);
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
    if (!workspace.ok) return apiError(c, "No such workspace", 404);
    const list = await sessions.list(workspace.value.summary.id);
    if (!list.ok) return sessionError(c, list.error);
    return c.json({ sessions: list.value } satisfies SessionList);
  });

  routes.post("/workspaces/:id/sessions", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return apiError(c, "No such workspace", 404);
    const message = await readMessage(c);
    if (!message.ok) return apiError(c, message.error, 400);
    const session = await sessions.create(workspace.value.summary.id, message.value);
    if (!session.ok) return sessionError(c, session.error);
    return c.json(session.value satisfies SessionSummary, 201);
  });

  routes.get("/sessions/:id", async (c) => {
    const session = await sessions.get(c.req.param("id"));
    if (!session.ok) return sessionError(c, session.error);
    return c.json(session.value satisfies SessionSummary);
  });

  routes.post("/sessions/:id/messages", async (c) => {
    const message = await readMessage(c);
    if (!message.ok) return apiError(c, message.error, 400);
    const sent = await sessions.send(c.req.param("id"), message.value);
    if (!sent.ok) return sessionError(c, sent.error);
    return c.body(null, 202);
  });

  // Replays everything after a position, then follows live (ADR 0006). A browser that reconnects
  // sends the last event id it saw, so it carries on with nothing missing or repeated.
  routes.get("/sessions/:id/events", async (c) => {
    const position = Number(c.req.header("last-event-id") ?? c.req.query("after") ?? 0);
    const after = Number.isInteger(position) && position >= 0 ? position : 0;
    const session = await sessions.get(c.req.param("id"));
    if (!session.ok) return sessionError(c, session.error);

    return streamSSE(c, async (stream) => {
      let sending: Promise<unknown> = Promise.resolve();
      const subscribed = await sessions.subscribe(session.value.id, after, (event) => {
        sending = sending.then(() =>
          stream.writeSSE({ id: String(event.seq), data: JSON.stringify(event) }),
        );
      });
      if (!subscribed.ok) return;
      const keepAlive = setInterval(() => {
        sending = sending.then(() => stream.write(": keep-alive\n\n"));
      }, KEEP_ALIVE_MS);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(keepAlive);
      subscribed.value();
    });
  });

  return routes;
};
