import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type FailureReason,
  type ModelRef,
  type NewMessage,
  SessionEvent,
  SessionId,
  type SessionSummary,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { hasCode, readJsonFile, writeJsonFile } from "../files.ts";
import type { ConversationLine, Provider } from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";

export type SessionError =
  | { readonly kind: "not-found" }
  | { readonly kind: "busy" }
  | { readonly kind: "model-unavailable" }
  | { readonly kind: "storage"; readonly message: string };

/** A session's own file, beside its event log. */
const SessionFile = z.object({
  id: SessionId,
  workspaceId: WorkspaceId,
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
type SessionFile = z.infer<typeof SessionFile>;

/** An event before it's numbered and timed. */
type WithoutNumbering<E> = E extends unknown ? Omit<E, "seq" | "at"> : never;
type NewEvent = WithoutNumbering<SessionEvent>;

const TITLE_LENGTH = 60;
const titleFrom = (text: string) => {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > TITLE_LENGTH ? `${firstLine.slice(0, TITLE_LENGTH - 1)}…` : firstLine;
};

/** The conversation so far, as providers see it: owner messages and the answers between them. */
const conversationOf = (events: readonly SessionEvent[]): ConversationLine[] => {
  const lines: ConversationLine[] = [];
  for (const event of events) {
    if (event.type === "user-message") lines.push({ role: "owner", text: event.text });
    if (event.type === "text-delta") {
      const last = lines.at(-1);
      if (last?.role === "model")
        lines[lines.length - 1] = { role: "model", text: last.text + event.text };
      else lines.push({ role: "model", text: event.text });
    }
  }
  return lines;
};

/** What the worker keeps in memory about a session while it runs. */
type Live = {
  busy: boolean;
  /** The next event's number, once known. */
  nextSeq: number | undefined;
  listeners: Set<(event: SessionEvent) => void>;
  /** Appends and subscriptions run one at a time, so events are gapless and none is missed. */
  queue: Promise<unknown>;
};

/**
 * Sessions as jobs with an append-only event log in plain files (ADR 0006): one folder per session
 * in the data folder, holding `session.json` and `events.jsonl`. A turn runs on the worker to the
 * end whether or not anyone is watching; anyone can subscribe from a position and follow live.
 */
export const createSessions = (options: {
  dataDir: string;
  providers: readonly Provider[];
  now: () => number;
}) => {
  const sessionsDir = join(options.dataDir, "sessions");
  const live = new Map<SessionId, Live>();
  const storage = (): SessionError => ({
    kind: "storage",
    message: "A session's files in Courtyard's data folder can't be read or written.",
  });

  const liveOf = (id: SessionId): Live => {
    const existing = live.get(id);
    if (existing) return existing;
    const created: Live = {
      busy: false,
      nextSeq: undefined,
      listeners: new Set(),
      queue: Promise.resolve(),
    };
    live.set(id, created);
    return created;
  };

  const inOrder = <T>(state: Live, step: () => Promise<T>): Promise<T> => {
    const run = state.queue.then(step, step);
    state.queue = run.catch(() => undefined);
    return run;
  };

  const folderOf = (id: SessionId) => join(sessionsDir, id);
  const readSessionFile = (id: SessionId) =>
    readJsonFile(join(folderOf(id), "session.json"), SessionFile);

  const readEvents = async (id: SessionId): Promise<Result<SessionEvent[], SessionError>> => {
    let text: string;
    try {
      text = await readFile(join(folderOf(id), "events.jsonl"), "utf8");
    } catch (error) {
      return hasCode(error, "ENOENT") ? ok([]) : err(storage());
    }
    const events: SessionEvent[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        return err(storage());
      }
      const parsed = SessionEvent.safeParse(json);
      if (!parsed.success) return err(storage());
      events.push(parsed.data);
    }
    return ok(events);
  };

  /** Numbers an event, puts it on disk, and only then tells subscribers. */
  const append = (id: SessionId, event: NewEvent) => {
    const state = liveOf(id);
    return inOrder(state, async (): Promise<Result<SessionEvent, SessionError>> => {
      if (state.nextSeq === undefined) {
        const existing = await readEvents(id);
        if (!existing.ok) return existing;
        state.nextSeq = existing.value.length + 1;
      }
      const numbered = SessionEvent.parse({
        ...event,
        seq: state.nextSeq,
        at: new Date(options.now()).toISOString(),
      });
      try {
        await appendFile(join(folderOf(id), "events.jsonl"), `${JSON.stringify(numbered)}\n`);
      } catch {
        return err(storage());
      }
      state.nextSeq += 1;
      for (const listener of state.listeners) listener(numbered);
      return ok(numbered);
    });
  };

  const touch = async (id: SessionId) => {
    const file = await readSessionFile(id);
    if (!file.ok || !file.value) return;
    await writeJsonFile(join(folderOf(id), "session.json"), {
      ...file.value,
      updatedAt: new Date(options.now()).toISOString(),
    });
  };

  const providerFor = async (ref: ModelRef) => {
    const provider = options.providers.find((p) => p.id === ref.provider);
    if (!provider) return undefined;
    const status = await provider.status();
    return status.available && status.models.some((m) => m.id === ref.model) ? provider : undefined;
  };

  /** Runs one turn to the end, recording everything; nobody waits on it. */
  const runTurn = async (id: SessionId, provider: Provider, model: string) => {
    const state = liveOf(id);
    let failure: FailureReason | undefined;
    try {
      const events = await readEvents(id);
      if (!events.ok) {
        failure = { kind: "unknown", message: "The session's history can't be read." };
      } else {
        const result = await provider.runTurn({
          model,
          conversation: conversationOf(events.value),
          emit: async (text) => {
            await append(id, { type: "text-delta", text });
          },
        });
        if (!result.ok) failure = result.error;
      }
    } catch (error) {
      // A provider throwing is a bug in its adapter; the session still records why it stopped.
      failure = {
        kind: "unknown",
        message: `The model connection broke: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    // The session is idle and up to date before anyone hears the turn ended. Freeing it and
    // queueing the last event happen together, so a new message can't land between them.
    await touch(id);
    state.busy = false;
    await append(
      id,
      failure ? { type: "turn-failed", reason: failure } : { type: "turn-completed" },
    );
  };

  const startTurn = async (
    id: SessionId,
    message: NewMessage,
  ): Promise<Result<null, SessionError>> => {
    const provider = await providerFor(message.model);
    if (!provider) return err({ kind: "model-unavailable" });
    const state = liveOf(id);
    if (state.busy) return err({ kind: "busy" });
    state.busy = true;

    const recorded = await append(id, {
      type: "user-message",
      text: message.text,
      model: message.model,
    });
    if (!recorded.ok) {
      state.busy = false;
      return recorded;
    }
    await touch(id);
    void runTurn(id, provider, message.model.model);
    return ok(null);
  };

  const summaryOf = (file: SessionFile): SessionSummary => ({
    ...file,
    busy: live.get(file.id)?.busy ?? false,
  });

  const findSession = async (rawId: string): Promise<Result<SessionFile, SessionError>> => {
    const id = SessionId.safeParse(rawId);
    if (!id.success) return err({ kind: "not-found" });
    const file = await readSessionFile(id.data);
    if (!file.ok) return err(storage());
    return file.value ? ok(file.value) : err({ kind: "not-found" });
  };

  return {
    /** Starts a session with the owner's first message, so there are never empty ones. */
    create: async (
      workspaceId: WorkspaceId,
      message: NewMessage,
    ): Promise<Result<SessionSummary, SessionError>> => {
      if (!(await providerFor(message.model))) return err({ kind: "model-unavailable" });
      const id = SessionId.parse(randomUUID());
      const at = new Date(options.now()).toISOString();
      const file: SessionFile = {
        id,
        workspaceId,
        title: titleFrom(message.text),
        createdAt: at,
        updatedAt: at,
      };
      try {
        await mkdir(folderOf(id), { recursive: true });
      } catch {
        return err(storage());
      }
      const written = await writeJsonFile(join(folderOf(id), "session.json"), file);
      if (!written.ok) return err(storage());
      const started = await startTurn(id, message);
      if (!started.ok) return started;
      return ok(summaryOf(file));
    },

    /** Starts a turn; returns as soon as the owner's message is recorded. */
    send: async (rawId: string, message: NewMessage): Promise<Result<null, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      return startTurn(session.value.id, message);
    },

    get: async (rawId: string): Promise<Result<SessionSummary, SessionError>> => {
      const session = await findSession(rawId);
      return session.ok ? ok(summaryOf(session.value)) : session;
    },

    /** A workspace's sessions, newest first. */
    list: async (workspaceId: WorkspaceId): Promise<Result<SessionSummary[], SessionError>> => {
      let folders: string[];
      try {
        folders = await readdir(sessionsDir);
      } catch (error) {
        return hasCode(error, "ENOENT") ? ok([]) : err(storage());
      }
      const summaries: SessionSummary[] = [];
      for (const folder of folders) {
        const id = SessionId.safeParse(folder);
        if (!id.success) continue;
        const file = await readSessionFile(id.data);
        if (!file.ok) return err(storage());
        if (file.value?.workspaceId === workspaceId) summaries.push(summaryOf(file.value));
      }
      return ok(summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },

    /**
     * Replays a session's events after `after`, then follows it live. Runs in the session's queue,
     * so no event can slip between the replay and the live ones. Returns a way to stop.
     */
    subscribe: async (
      rawId: string,
      after: number,
      onEvent: (event: SessionEvent) => void,
    ): Promise<Result<() => void, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      const state = liveOf(session.value.id);
      return inOrder(state, async () => {
        const events = await readEvents(session.value.id);
        if (!events.ok) return events;
        for (const event of events.value) if (event.seq > after) onEvent(event);
        state.listeners.add(onEvent);
        return ok(() => {
          state.listeners.delete(onEvent);
        });
      });
    },
  };
};

export type Sessions = ReturnType<typeof createSessions>;
