import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
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
import type { Provider, SessionLine } from "../providers/index.ts";
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

/** What has been said so far, as providers see it: owner messages and the answers between them. */
const linesOf = (events: readonly SessionEvent[]): SessionLine[] => {
  const lines: SessionLine[] = [];
  for (const event of events) {
    if (event.type === "owner-message") lines.push({ speaker: "owner", text: event.text });
    if (event.type === "text-delta") {
      const last = lines.at(-1);
      if (last?.speaker === "model") {
        lines[lines.length - 1] = { speaker: "model", text: last.text + event.text };
      } else {
        lines.push({ speaker: "model", text: event.text });
      }
    }
  }
  return lines;
};

const STORAGE_ERROR: SessionError = {
  kind: "storage",
  message: "A session's files in Courtyard's data folder can't be read or written.",
};

/** What the worker keeps in memory about a session it has touched since it started. */
type RunningSession = {
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
  const running = new Map<SessionId, RunningSession>();
  const stamp = () => new Date(options.now()).toISOString();

  const runningSession = (id: SessionId): RunningSession => {
    const existing = running.get(id);
    if (existing) return existing;
    const created: RunningSession = {
      busy: false,
      nextSeq: undefined,
      listeners: new Set(),
      queue: Promise.resolve(),
    };
    running.set(id, created);
    // The first time this worker touches a session, before anything else can: a turn the log
    // shows as still running belongs to a worker that stopped, because this one hasn't started any.
    created.queue = recordInterruptedTurn(id, created).catch(() => undefined);
    return created;
  };

  const inOrder = <T>(session: RunningSession, step: () => Promise<T>): Promise<T> => {
    const run = session.queue.then(step, step);
    session.queue = run.catch(() => undefined);
    return run;
  };

  const folderOf = (id: SessionId) => join(sessionsDir, id);
  const sessionFilePath = (id: SessionId) => join(folderOf(id), "session.json");

  const readEvents = async (id: SessionId): Promise<Result<SessionEvent[], SessionError>> => {
    let text: string;
    try {
      text = await readFile(join(folderOf(id), "events.jsonl"), "utf8");
    } catch (error) {
      return hasCode(error, "ENOENT") ? ok([]) : err(STORAGE_ERROR);
    }
    const events: SessionEvent[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        return err(STORAGE_ERROR);
      }
      const parsed = SessionEvent.safeParse(json);
      if (!parsed.success) return err(STORAGE_ERROR);
      events.push(parsed.data);
    }
    return ok(events);
  };

  /**
   * Numbers an event, puts it on disk, and only then tells subscribers. Only ever called from
   * inside the session's queue.
   */
  const writeEvent = async (
    id: SessionId,
    session: RunningSession,
    event: NewEvent,
  ): Promise<Result<SessionEvent, SessionError>> => {
    if (session.nextSeq === undefined) {
      const existing = await readEvents(id);
      if (!existing.ok) return existing;
      session.nextSeq = existing.value.length + 1;
    }
    const numbered = SessionEvent.safeParse({ ...event, seq: session.nextSeq, at: stamp() });
    if (!numbered.success) return err(STORAGE_ERROR);
    try {
      await appendFile(join(folderOf(id), "events.jsonl"), `${JSON.stringify(numbered.data)}\n`);
    } catch {
      return err(STORAGE_ERROR);
    }
    session.nextSeq += 1;
    for (const listener of session.listeners) listener(numbered.data);
    return ok(numbered.data);
  };

  const append = (id: SessionId, event: NewEvent) => {
    const session = runningSession(id);
    return inOrder(session, () => writeEvent(id, session, event));
  };

  /** Ends a turn that a stopped worker left running, so the session is usable again. */
  async function recordInterruptedTurn(id: SessionId, session: RunningSession) {
    const events = await readEvents(id);
    if (!events.ok) return;
    const last = events.value.at(-1);
    if (last?.type === "owner-message" || last?.type === "text-delta") {
      await writeEvent(id, session, { type: "turn-failed", reason: { kind: "interrupted" } });
    }
  }

  const markUpdated = async (id: SessionId) => {
    const file = await readJsonFile(sessionFilePath(id), SessionFile);
    if (!file.ok || !file.value) return;
    await writeJsonFile(sessionFilePath(id), { ...file.value, updatedAt: stamp() });
  };

  const providerFor = async (ref: ModelRef) => {
    const provider = options.providers.find((p) => p.id === ref.provider);
    if (!provider) return undefined;
    const status = await provider.status();
    return status.available && status.models.some((m) => m.id === ref.model) ? provider : undefined;
  };

  /** Runs one turn to the end, recording everything; nobody waits on it. */
  const runTurn = async (turn: { id: SessionId; provider: Provider; model: ModelRef["model"] }) => {
    const session = runningSession(turn.id);
    let failure: FailureReason | undefined;
    /** Set when an answer's text couldn't be recorded, so the turn can't count as complete. */
    let textLost = false;
    try {
      const events = await readEvents(turn.id);
      if (!events.ok) {
        failure = { kind: "unknown", message: "The session's event log can't be read." };
      } else {
        const result = await turn.provider.runTurn({
          model: turn.model,
          lines: linesOf(events.value),
          emit: async (text) => {
            if (textLost) return;
            const recorded = await append(turn.id, { type: "text-delta", text });
            if (!recorded.ok) textLost = true;
          },
        });
        if (!result.ok) failure = result.error;
      }
    } catch (error) {
      // A provider throwing is a bug in its adapter: the details go to the worker's log, and the
      // session records the turn's end in plain words.
      console.error(`Session ${turn.id}: the provider threw`, error);
      failure = { kind: "unknown", message: "The model connection stopped unexpectedly." };
    }
    if (!failure && textLost) {
      failure = {
        kind: "unknown",
        message: "Part of the answer couldn't be saved, so it stopped.",
      };
    }

    // The session is idle and up to date before anyone hears the turn ended. Freeing it and
    // queueing the last event happen together, so a new message can't land between them.
    await markUpdated(turn.id);
    session.busy = false;
    const ended = await append(
      turn.id,
      failure ? { type: "turn-failed", reason: failure } : { type: "turn-completed" },
    );
    if (!ended.ok) console.error(`Session ${turn.id}: the end of a turn couldn't be recorded.`);
  };

  const startTurn = async (start: {
    id: SessionId;
    provider: Provider;
    message: NewMessage;
  }): Promise<Result<null, SessionError>> => {
    const session = runningSession(start.id);
    if (session.busy) return err({ kind: "busy" });
    session.busy = true;

    const recorded = await append(start.id, {
      type: "owner-message",
      text: start.message.text,
      model: start.message.model,
    });
    if (!recorded.ok) {
      session.busy = false;
      return recorded;
    }
    await markUpdated(start.id);
    runTurn({ id: start.id, provider: start.provider, model: start.message.model.model }).catch(
      (error: unknown) => console.error(`Session ${start.id}: a turn crashed`, error),
    );
    return ok(null);
  };

  const summaryOf = (file: SessionFile): SessionSummary => ({
    ...file,
    busy: running.get(file.id)?.busy ?? false,
  });

  const findSession = async (rawId: string): Promise<Result<SessionFile, SessionError>> => {
    const id = SessionId.safeParse(rawId);
    if (!id.success) return err({ kind: "not-found" });
    const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
    if (!file.ok) return err(STORAGE_ERROR);
    return file.value ? ok(file.value) : err({ kind: "not-found" });
  };

  return {
    /** Starts a session with the owner's first message, so there are never empty ones. */
    create: async (start: {
      workspaceId: WorkspaceId;
      message: NewMessage;
    }): Promise<Result<SessionSummary, SessionError>> => {
      const provider = await providerFor(start.message.model);
      if (!provider) return err({ kind: "model-unavailable" });
      const id = SessionId.parse(randomUUID());
      const at = stamp();
      const file: SessionFile = {
        id,
        workspaceId: start.workspaceId,
        title: titleFrom(start.message.text),
        createdAt: at,
        updatedAt: at,
      };
      try {
        await mkdir(folderOf(id), { recursive: true });
      } catch {
        return err(STORAGE_ERROR);
      }
      const written = await writeJsonFile(sessionFilePath(id), file);
      const started = written.ok
        ? await startTurn({ id, provider, message: start.message })
        : err(STORAGE_ERROR);
      if (!started.ok) {
        // Never leave a session behind without its first message.
        await rm(folderOf(id), { recursive: true, force: true });
        running.delete(id);
        return started;
      }
      return ok(summaryOf(file));
    },

    /** Starts a turn; returns as soon as the owner's message is recorded. */
    send: async (rawId: string, message: NewMessage): Promise<Result<null, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      const provider = await providerFor(message.model);
      if (!provider) return err({ kind: "model-unavailable" });
      return startTurn({ id: session.value.id, provider, message });
    },

    get: async (rawId: string): Promise<Result<SessionSummary, SessionError>> => {
      const session = await findSession(rawId);
      return session.ok ? ok(summaryOf(session.value)) : session;
    },

    /** A workspace's sessions, most recently active first. */
    list: async (workspaceId: WorkspaceId): Promise<Result<SessionSummary[], SessionError>> => {
      let folders: string[];
      try {
        folders = await readdir(sessionsDir);
      } catch (error) {
        return hasCode(error, "ENOENT") ? ok([]) : err(STORAGE_ERROR);
      }
      const summaries: SessionSummary[] = [];
      for (const folder of folders) {
        const id = SessionId.safeParse(folder);
        if (!id.success) continue;
        const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
        if (!file.ok) return err(STORAGE_ERROR);
        if (file.value?.workspaceId === workspaceId) summaries.push(summaryOf(file.value));
      }
      return ok(summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },

    /**
     * Replays a session's events after `after`, then follows it live. Runs in the session's queue,
     * so no event can slip between the replay and the live ones. Returns a way to stop.
     */
    subscribe: (subscription: {
      sessionId: SessionId;
      after: number;
      onEvent: (event: SessionEvent) => void;
    }): Promise<Result<() => void, SessionError>> => {
      const session = runningSession(subscription.sessionId);
      return inOrder(session, async () => {
        const events = await readEvents(subscription.sessionId);
        if (!events.ok) return events;
        for (const event of events.value) {
          if (event.seq > subscription.after) subscription.onEvent(event);
        }
        session.listeners.add(subscription.onEvent);
        return ok(() => {
          session.listeners.delete(subscription.onEvent);
        });
      });
    },
  };
};

export type Sessions = ReturnType<typeof createSessions>;
