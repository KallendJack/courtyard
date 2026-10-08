import { join } from "node:path";
import { ApiError, ModelId, ProviderId, SessionEvent, SessionSummary } from "@courtyard/contract";
import type { Hono } from "hono";
import { git } from "./git.ts";
import {
  createFakeProvider,
  type Framing,
  type Provider,
  type SaveReply,
} from "./providers/index.ts";
import { err, ok } from "./result.ts";
import { createWorker, type Environment } from "./worker.ts";

/**
 * For tests and the context eval: a worker on the `context` and `data` folders in `root`, with any other options and
 * settings given. Throws if it won't start, since every test that uses it needs one that does.
 */
export const testWorker = (
  options: { root: string; env?: Environment } & Omit<Parameters<typeof createWorker>[0], "env">,
) => {
  const { root, env, ...rest } = options;
  const worker = createWorker({
    // Nothing runs in the background unless a test asks for the job.
    repeat: () => {},
    ...rest,
    env: {
      COURTYARD_CONTEXT_DIR: join(root, "context"),
      COURTYARD_DATA_DIR: join(root, "data"),
      ...env,
    },
  });
  if (!worker.ok) throw new Error(worker.error);
  return worker.value.app;
};

/** For tests: git in `folder`, as a test person, for setting things up and looking at them. */
export const gitIn = (folder: string, ...args: string[]) =>
  git(folder, args, { config: ["user.name=Test", "user.email=test@example.com"] });

/** For tests: the message an error answer carries. */
export const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

/** For tests and the context eval: a request function, like `app.request`. */
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
 * For tests and the context eval: sets up the owner on a fresh worker and returns a way to make requests as the owner.
 * Goes through the API like a browser would, so tests still only touch the worker's front door.
 */
export const asOwner = async (app: Hono) => requesterFor(app, await setUpOwner(app));

/**
 * For tests and the context eval: reads a session's server-sent events until one of type `until` arrives (or one that
 * `until` picks out), then hangs up, like a browser tab closing. Starts after `after`, or after
 * `lastEventId` sent the way a reconnecting browser sends it.
 */
export const followSession = async (
  request: Requester,
  read: {
    sessionId: string;
    until: SessionEvent["type"] | ((event: SessionEvent) => boolean);
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
  const { until } = read;
  const isLast =
    typeof until === "function" ? until : (event: SessionEvent) => event.type === until;

  const events: SessionEvent[] = [];
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream ended before the event it waited for");
    buffer += value;
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      const data = message.split("\n").find((line) => line.startsWith("data: "));
      if (!data) continue;
      const event = SessionEvent.parse(JSON.parse(data.slice("data: ".length)));
      read.onEvent?.(event);
      events.push(event);
      if (isLast(event)) {
        await reader.cancel();
        return events;
      }
    }
  }
};

/** For tests: the scripted fake provider's model. */
export const FAKE_MODEL = { provider: "fake", model: "echo" };

/** For tests: the second fake's model, which "please hit Fake two's limit" sends to its usage limit. */
export const FAKE_TWO_MODEL = { provider: "fake-two", model: "echo" };

/** For tests: a provider that's there but not signed in, as Codex is before the owner signs in. */
export const signedOutProvider = (): Provider => {
  const id = ProviderId.parse("away");
  const capabilities = { readsFiles: false, codes: false, usesTools: false, savesContext: false };
  const notSignedIn = { kind: "provider-unavailable", message: "Not signed in." } as const;
  return {
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Away",
      available: false,
      reason: "Away isn't signed in.",
      signedOut: true,
    }),
    runTurn: async () => err(notSignedIn),
    answerOnce: async () => err(notSignedIn),
  };
};

/** For tests and the context eval: sends JSON, the way the web app does. */
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

/** For tests: gives a session a new title, the way the web app does. */
export const renameSession = (request: Requester, id: string, title: unknown) =>
  request(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

/** For tests: a fake provider that holds each turn open until the test lets it go, if ever. */
export const gatedProvider = () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Held until released, or until the turn is stopped.
  const heldUntilReleased = (signal: AbortSignal) =>
    Promise.race([
      gate,
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
  return { provider: createFakeProvider({ delayMs: 0, beforeReply: heldUntilReleased }), release };
};

/** For tests: one step of a scripted turn, a save the model asks for or something to do mid-turn. */
export type ScriptedStep = Readonly<Record<string, unknown>> | (() => Promise<void>);

/** For tests: the model the saving provider offers. */
export const SAVING_MODEL = { provider: "saver", model: "one" };

/**
 * For tests: a provider that, in each turn, hands the worker the saves scripted for that turn in
 * order (running any function steps between them), keeps the worker's replies, and answers
 * "Done." With `holdAfterSaves`, it then waits until the turn is stopped.
 */
export const savingProvider = (
  turns: readonly (readonly ScriptedStep[])[],
  options: { holdAfterSaves?: boolean } = {},
) => {
  const replies: SaveReply[][] = [];
  const framings: Framing[] = [];
  const id = ProviderId.parse("saver");
  const capabilities = { readsFiles: false, codes: false, usesTools: false, savesContext: true };
  const provider: Provider = {
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Saver",
      available: true,
      models: [{ id: ModelId.parse("one"), label: "One", efforts: [] }],
      capabilities,
    }),
    runTurn: async (input) => {
      const turnReplies: SaveReply[] = [];
      const steps = turns[replies.length] ?? [];
      replies.push(turnReplies);
      framings.push(input.framing);
      for (const step of steps) {
        if (typeof step === "function") await step();
        else turnReplies.push(await input.save(step));
      }
      if (options.holdAfterSaves) {
        await new Promise((resolve) =>
          input.signal.addEventListener("abort", resolve, { once: true }),
        );
        return ok(null);
      }
      await input.emit("Done.");
      return ok(null);
    },
    answerOnce: async () => err({ kind: "unknown", message: "The saver only saves." }),
  };
  return { provider, replies, framings };
};

/** For tests: the context folder's changes, newest first: each one's title and trailers. */
export const changesIn = async (contextDir: string) => {
  const log = await gitIn(contextDir, "log", "--format=%s%x1f%b%x1e");
  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [title = "", body = ""] = entry.split("\x1f");
      return { title, trailers: body.split("\n").filter((line) => line.trim() !== "") };
    });
};
