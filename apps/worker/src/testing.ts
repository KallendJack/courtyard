import { SessionEvent, SessionSummary } from "@courtyard/contract";
import type { Hono } from "hono";
import { createFakeProvider } from "./providers/index.ts";

/** For tests: a request function, like `app.request`. */
export type Requester = (path: string, init?: RequestInit) => Response | Promise<Response>;

/** For tests: the `name=value` part of the login cookie a response set. */
export const loginCookie = (response: Response) => {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /(courtyard_login=[^;]+)/.exec(header);
  if (!match?.[1]) throw new Error(`no login cookie (status ${response.status}): ${header}`);
  return match[1];
};

/** For tests: sets up the owner on a fresh worker and returns this device's login cookie. */
export const setUpOwner = async (app: Hono) =>
  loginCookie(
    await app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "test password" }),
    }),
  );

/** For tests: makes requests to `app` as a device logged in with `cookie`. */
export const requesterFor =
  (app: Hono, cookie: string): Requester =>
  (path, init = {}) =>
    app.request(path, { ...init, headers: { ...init.headers, cookie } });

/**
 * For tests: sets up the owner on a fresh worker and returns a way to make requests as the owner.
 * Goes through the API like a browser would, so tests still only touch the worker's front door.
 */
export const asOwner = async (app: Hono) => requesterFor(app, await setUpOwner(app));

/**
 * For tests: reads a session's server-sent events until one of type `until` arrives, then hangs
 * up, like a browser tab closing. Starts after `after`, or after `lastEventId` sent the way a
 * reconnecting browser sends it.
 */
export const followSession = async (
  request: Requester,
  read: {
    sessionId: string;
    until: SessionEvent["type"];
    after?: number;
    lastEventId?: number;
    onEvent?: (event: SessionEvent) => void;
  },
) => {
  const response = await request(
    `/api/sessions/${read.sessionId}/events?after=${read.after ?? 0}`,
    read.lastEventId === undefined
      ? {}
      : { headers: { "last-event-id": String(read.lastEventId) } },
  );
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(`not an event stream (status ${response.status})`);
  }
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) throw new Error("no event stream");

  const events: SessionEvent[] = [];
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${read.until}`);
    buffer += value;
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      const data = message.split("\n").find((line) => line.startsWith("data: "));
      if (!data) continue;
      const event = SessionEvent.parse(JSON.parse(data.slice("data: ".length)));
      read.onEvent?.(event);
      events.push(event);
      if (event.type === read.until) {
        await reader.cancel();
        return events;
      }
    }
  }
};

/** For tests: the scripted fake provider's model. */
export const FAKE_MODEL = { provider: "fake", model: "echo" };

/** For tests: sends JSON, the way the web app does. */
export const postJson = (request: Requester, path: string, body: unknown) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** For tests: starts a session in the garage-gym workspace with the owner's first message. */
export const startSession = async (request: Requester, text: string, model = FAKE_MODEL) => {
  const response = await postJson(request, "/api/workspaces/garage-gym/sessions", { text, model });
  if (response.status !== 201) throw new Error(`starting a session failed with ${response.status}`);
  return SessionSummary.parse(await response.json());
};

/** For tests: a fake provider that holds each turn open until the test lets it go, if ever. */
export const gatedProvider = () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { provider: createFakeProvider({ delayMs: 0, beforeReply: () => gate }), release };
};
