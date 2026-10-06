import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, truncate } from "node:fs/promises";
import { join } from "node:path";
import {
  endsTurn,
  type FailureReason,
  type ModelRef,
  type NewMessage,
  type PlacedLine,
  SessionEvent,
  SessionId,
  type SessionSummary,
  type StopRequest,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import type { ContextFolder } from "../context-folder/index.ts";
import { listFolder, readJsonFile, readTextFile, writeJsonFile } from "../files.ts";
import { readOwnerContext } from "../owner-context/index.ts";
import { type FramingWorkspace, framingFor, saveReply } from "../prompts/index.ts";
import type { Provider, SaveReply } from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";
import {
  createTurnSaves,
  editSave,
  type NoteRefusal,
  type SaveState,
  type SaveTarget,
  undoSave,
} from "../saves/index.ts";
import { getWorkspace, isArchived } from "../workspaces/index.ts";

export type SessionError =
  | { readonly kind: "not-found" }
  | { readonly kind: "busy" }
  | { readonly kind: "nothing-running" }
  /** A turn is running, so the session can't be deleted until it's stopped. */
  | { readonly kind: "delete-while-running" }
  | { readonly kind: "workspace-archived" }
  | { readonly kind: "model-unavailable" }
  /** No save in the session has that event number. */
  | { readonly kind: "save-not-found" }
  /** The owner's Undo or Edit of a save couldn't be done. */
  | { readonly kind: "note-refused"; readonly refusal: NoteRefusal }
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

const STORAGE_ERROR: SessionError = {
  kind: "storage",
  message: "A session's files in Courtyard's data folder can't be read or written.",
};

/**
 * A save as it stands now, from the session's events: what it did, its line after the owner's
 * edits, and whether they undid it. `undefined` when no save has that event number.
 */
const saveStateOf = (events: readonly SessionEvent[], seq: number): SaveState | undefined => {
  const saved = events.find((event) => event.seq === seq);
  if (saved?.type !== "context-saved") return undefined;
  let current = saved.save.action === "remove" ? undefined : saved.save.saved;
  let undone = false;
  for (const event of events) {
    if (event.type === "context-edited" && event.save === seq) current = event.now;
    if (event.type === "context-undone" && event.save === seq) undone = true;
  }
  return { save: saved.save, current, undone };
};

/**
 * Where a session's current turn stands in this worker. A stop handle exists from the moment the
 * turn starts, and only while it can still be stopped: once the provider has finished, the turn
 * is ending and how it ended is already decided.
 */
type TurnState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "running";
      readonly stopper: AbortController;
      /** The owner message's event number, once recorded: what a stop request must name. */
      turn: number | undefined;
    }
  | { readonly kind: "ending" }
  /** Its folder is being deleted, so nothing new can start in it. */
  | { readonly kind: "deleting" };

type RunningSession = {
  turn: TurnState;
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
  /** The context folder, where each turn finds its workspace. */
  contextDir: string;
  /** Where saves are written, one change at a time. */
  contextFolder: ContextFolder;
  now: () => number;
}) => {
  const sessionsDir = join(options.dataDir, "sessions");
  const running = new Map<SessionId, RunningSession>();
  const stamp = () => new Date(options.now()).toISOString();

  const runningSession = (id: SessionId): RunningSession => {
    const existing = running.get(id);
    if (existing) return existing;
    const created: RunningSession = {
      turn: { kind: "idle" },
      nextSeq: undefined,
      listeners: new Set(),
      queue: Promise.resolve(),
    };
    running.set(id, created);
    // The first step in the queue of every session this worker touches, before anything else.
    void inOrder(created, () => recover(id, created));
    return created;
  };

  const inOrder = <T>(session: RunningSession, step: () => Promise<T>): Promise<T> => {
    const run = session.queue.then(step, step);
    session.queue = run.catch(() => undefined);
    return run;
  };

  /** Resolves once anything already queued for the session, such as its recovery, has run. */
  const settled = (id: SessionId) => inOrder(runningSession(id), async () => undefined);

  const folderOf = (id: SessionId) => join(sessionsDir, id);
  const sessionFilePath = (id: SessionId) => join(folderOf(id), "session.json");
  const eventsPath = (id: SessionId) => join(folderOf(id), "events.jsonl");

  const readEvents = async (id: SessionId): Promise<Result<SessionEvent[], SessionError>> => {
    const text = await readTextFile(eventsPath(id));
    if (!text.ok) return err(STORAGE_ERROR);
    const events: SessionEvent[] = [];
    for (const line of (text.value ?? "").split("\n")) {
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
  const writeEvent = async (write: {
    id: SessionId;
    session: RunningSession;
    event: NewEvent;
  }): Promise<Result<SessionEvent, SessionError>> => {
    const { id, session, event } = write;
    if (session.nextSeq === undefined) {
      const existing = await readEvents(id);
      if (!existing.ok) return existing;
      session.nextSeq = existing.value.length + 1;
    }
    const numbered = SessionEvent.safeParse({ ...event, seq: session.nextSeq, at: stamp() });
    if (!numbered.success) return err(STORAGE_ERROR);
    try {
      await appendFile(eventsPath(id), `${JSON.stringify(numbered.data)}\n`);
    } catch {
      return err(STORAGE_ERROR);
    }
    session.nextSeq += 1;
    for (const listener of session.listeners) listener(numbered.data);
    return ok(numbered.data);
  };

  const append = (id: SessionId, event: NewEvent) => {
    const session = runningSession(id);
    return inOrder(session, () => writeEvent({ id, session, event }));
  };

  /**
   * Puts right what a stopped worker left behind, the first time this worker touches a session.
   * A crash mid-write leaves a last line with no newline: it's cut off. A turn the log shows as
   * still open belonged to the stopped worker (this one hasn't started any), so it's recorded as
   * interrupted and the session is usable again.
   */
  const recover = async (id: SessionId, session: RunningSession) => {
    const read = await readTextFile(eventsPath(id));
    if (!read.ok) console.error(`Session ${id}: its event log can't be read`);
    if (!read.ok || read.value === undefined) return;
    const text = read.value;
    if (text !== "" && !text.endsWith("\n")) {
      const whole = text.slice(0, text.lastIndexOf("\n") + 1);
      try {
        await truncate(eventsPath(id), Buffer.byteLength(whole));
      } catch {
        console.error(`Session ${id}: a half-written event couldn't be removed`);
        return;
      }
    }

    const events = await readEvents(id);
    if (!events.ok) {
      console.error(`Session ${id}: its event log can't be read`);
      return;
    }
    session.nextSeq = events.value.length + 1;
    // The owner's Undo and Edit can come after a turn ends, so it's the last turn's own events
    // that say whether it was left open.
    const last = events.value.findLast(
      (event) => event.type === "owner-message" || endsTurn(event),
    );
    if (last === undefined || endsTurn(last)) return;
    const ended = await writeEvent({
      id,
      session,
      event: { type: "turn-failed", reason: { kind: "interrupted" } },
    });
    if (!ended.ok) console.error(`Session ${id}: an interrupted turn couldn't be recorded`);
  };

  /**
   * Changes a session's own file. Runs in the session's queue, so two changes (a turn ending and
   * the owner renaming it, say) can't each read the file before the other writes it.
   */
  const updateFile = (id: SessionId, change: Partial<Pick<SessionFile, "title" | "updatedAt">>) =>
    inOrder(runningSession(id), async (): Promise<Result<SessionFile, SessionError>> => {
      const file = await readJsonFile(sessionFilePath(id), SessionFile);
      if (!file.ok) return err(STORAGE_ERROR);
      if (!file.value) return err({ kind: "not-found" });
      const changed = { ...file.value, ...change };
      const written = await writeJsonFile(sessionFilePath(id), changed);
      return written.ok ? ok(changed) : err(STORAGE_ERROR);
    });

  const markUpdated = (id: SessionId) => updateFile(id, { updatedAt: stamp() });

  const providerFor = async (ref: ModelRef) => {
    const provider = options.providers.find((p) => p.id === ref.provider);
    if (!provider) return undefined;
    const status = await provider.status();
    return status.available && status.models.some((m) => m.id === ref.model) ? provider : undefined;
  };

  /**
   * What a turn needs from its workspace: its name, mode and folder, its context file as written,
   * and the owner context.
   */
  const turnWorkspaceOf = async (
    workspaceId: WorkspaceId,
  ): Promise<Result<FramingWorkspace & { folder: string }, string>> => {
    const [workspace, ownerContext] = await Promise.all([
      getWorkspace(options.contextDir, workspaceId),
      readOwnerContext(options.contextDir),
    ]);
    if (!workspace.ok) return err("This session's workspace can't be read.");
    if (!ownerContext.ok) return err(ownerContext.error.message);
    const { summary, folder, contextMarkdown } = workspace.value;
    return ok({
      name: summary.name,
      mode: summary.mode,
      folder,
      contextFile: contextMarkdown,
      ownerContext: ownerContext.value,
    });
  };

  /** Where a session's saves go: its workspace's context file, as changes naming the session. */
  const targetOf = (session: { id: SessionId; workspaceId: WorkspaceId }): SaveTarget => ({
    contextFolder: options.contextFolder,
    contextDir: options.contextDir,
    workspaceId: session.workspaceId,
    sessionId: session.id,
  });

  /** Runs one turn to the end, recording everything; nobody waits on it. */
  const runTurn = async (turn: {
    id: SessionId;
    stopper: AbortController;
    workspaceId: WorkspaceId;
    provider: Provider;
    model: ModelRef["model"];
  }) => {
    const session = runningSession(turn.id);
    const stopper = turn.stopper;
    const stoppedByOwner = new Promise<"stopped">((resolve) => {
      stopper.signal.addEventListener("abort", () => resolve("stopped"), { once: true });
    });
    let failure: FailureReason | undefined;
    /** Set when part of the turn couldn't be recorded, so it can't count as complete. */
    let recordingLost = false;
    /** Saves still being written, which finish (and are recorded) before the turn ends. */
    const savesUnderway = new Set<Promise<unknown>>();
    try {
      const [events, workspace] = await Promise.all([
        readEvents(turn.id),
        turnWorkspaceOf(turn.workspaceId),
      ]);
      if (!events.ok) {
        failure = { kind: "unknown", message: "The session's event log can't be read." };
      } else if (!workspace.ok) {
        failure = { kind: "unknown", message: workspace.error };
      } else {
        const framing = framingFor({
          workspace: workspace.value,
          capabilities: turn.provider.capabilities,
          events: events.value,
          now: options.now(),
        });
        const turnSaves = createTurnSaves({
          ...targetOf(turn),
          shown: workspace.value.contextFile,
        });
        /** Whether the last save was refused, so this one is its retry. */
        let retrying = false;
        const save = async (input: unknown): Promise<SaveReply> => {
          // A provider winding down after a stop saves nothing more; one already saving finishes.
          if (stopper.signal.aborted || recordingLost) {
            return saveReply(err({ kind: "stopped" }), true);
          }
          if (framing.saveTool === null) return saveReply(err({ kind: "not-offered" }), true);
          const saved = await turnSaves(input);
          if (saved.ok) {
            const recorded = await append(turn.id, { type: "context-saved", save: saved.value });
            if (!recorded.ok) recordingLost = true;
          }
          const reply = saveReply(saved, retrying);
          retrying = !saved.ok && !retrying;
          return reply;
        };
        // Raced against the stop, so a provider that ignores it can't keep the session busy.
        const outcome = await Promise.race([
          turn.provider.runTurn({
            model: turn.model,
            folder: workspace.value.folder,
            framing,
            save: (input) => {
              const saving = save(input);
              savesUnderway.add(saving);
              void saving.finally(() => savesUnderway.delete(saving));
              return saving;
            },
            emit: async (text) => {
              // Anything a provider writes after the owner stopped the turn is dropped.
              if (recordingLost || stopper.signal.aborted) return;
              const recorded = await append(turn.id, { type: "text-delta", text });
              if (!recorded.ok) recordingLost = true;
            },
            report: async (activity) => {
              if (recordingLost || stopper.signal.aborted) return;
              const recorded = await append(turn.id, { type: "activity", activity });
              if (!recorded.ok) recordingLost = true;
            },
            signal: stopper.signal,
          }),
          stoppedByOwner,
        ]);
        if (outcome !== "stopped" && !outcome.ok) failure = outcome.error;
      }
    } catch (error) {
      // A provider throwing is a bug in its adapter: the details go to the worker's log, and the
      // session records the turn's end in plain words.
      console.error(`Session ${turn.id}: the provider threw`, error);
      failure = { kind: "unknown", message: "The model connection stopped unexpectedly." };
    }
    // A save already being written stays, whatever happens to the turn (ADR 0013).
    await Promise.allSettled(savesUnderway);
    if (!failure && recordingLost) {
      failure = {
        kind: "unknown",
        message: "Part of the answer couldn't be saved, so it stopped.",
      };
    }

    // How the turn ended is decided now: a stop arriving from here on finds nothing to stop, so
    // it can't turn a completed or failed turn into a stopped one.
    const stopped = stopper.signal.aborted;
    session.turn = { kind: "ending" };

    // The session is idle and up to date before anyone hears the turn ended. Freeing it and
    // queueing the last event happen together, so a new message can't land between them.
    await markUpdated(turn.id);
    session.turn = { kind: "idle" };
    const ending: NewEvent = stopped
      ? { type: "turn-stopped" }
      : failure
        ? { type: "turn-failed", reason: failure }
        : { type: "turn-completed" };
    const ended = await append(turn.id, ending);
    if (!ended.ok) console.error(`Session ${turn.id}: the end of a turn couldn't be recorded.`);
  };

  const startTurn = async (start: {
    id: SessionId;
    workspaceId: WorkspaceId;
    provider: Provider;
    message: NewMessage;
  }): Promise<Result<null, SessionError>> => {
    const session = runningSession(start.id);
    if (session.turn.kind === "deleting") return err({ kind: "not-found" });
    if (session.turn.kind !== "idle") return err({ kind: "busy" });
    // Stoppable from the very start, so a Stop pressed the moment it appears is never lost.
    const starting: TurnState = {
      kind: "running",
      stopper: new AbortController(),
      turn: undefined,
    };
    session.turn = starting;

    const recorded = await append(start.id, {
      type: "owner-message",
      text: start.message.text,
      model: start.message.model,
    });
    if (!recorded.ok) {
      session.turn = { kind: "idle" };
      return recorded;
    }
    starting.turn = recorded.value.seq;
    await markUpdated(start.id);
    runTurn({
      id: start.id,
      stopper: starting.stopper,
      workspaceId: start.workspaceId,
      provider: start.provider,
      model: start.message.model.model,
    }).catch((error: unknown) => console.error(`Session ${start.id}: a turn crashed`, error));
    return ok(null);
  };

  const summaryOf = (file: SessionFile): SessionSummary => ({
    ...file,
    busy: (running.get(file.id)?.turn.kind ?? "idle") !== "idle",
  });

  const findSession = async (rawId: string): Promise<Result<SessionFile, SessionError>> => {
    const id = SessionId.safeParse(rawId);
    if (!id.success) return err({ kind: "not-found" });
    const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
    if (!file.ok) return err(STORAGE_ERROR);
    return file.value ? ok(file.value) : err({ kind: "not-found" });
  };

  /** A workspace's sessions, most recently active first. */
  const sessionsOf = async (
    workspaceId: WorkspaceId,
  ): Promise<Result<SessionSummary[], SessionError>> => {
    const folders = await listFolder(sessionsDir);
    if (!folders.ok) return err(STORAGE_ERROR);
    const summaries: SessionSummary[] = [];
    for (const folder of folders.value) {
      const id = SessionId.safeParse(folder);
      if (!id.success) continue;
      const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
      if (!file.ok) return err(STORAGE_ERROR);
      if (file.value?.workspaceId !== workspaceId) continue;
      await settled(file.value.id);
      summaries.push(summaryOf(file.value));
    }
    return ok(summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  };

  /**
   * Acts on one of a session's saves, by its event number, and records what was done. In the
   * session's queue, so two acts on the same save happen one after the other, each seeing the
   * other's result.
   */
  const actOnSave = async (act: {
    rawId: string;
    save: number;
    change: (target: SaveTarget, state: SaveState) => Promise<Result<null, NoteRefusal>>;
    recorded: NewEvent;
  }): Promise<Result<null, SessionError>> => {
    const found = await findSession(act.rawId);
    if (!found.ok) return found;
    const file = found.value;
    if (await isArchived(options.contextDir, file.workspaceId)) {
      return err({ kind: "workspace-archived" });
    }
    const session = runningSession(file.id);
    return inOrder(session, async (): Promise<Result<null, SessionError>> => {
      const events = await readEvents(file.id);
      if (!events.ok) return events;
      const state = saveStateOf(events.value, act.save);
      if (state === undefined) return err({ kind: "save-not-found" });
      const changed = await act.change(targetOf(file), state);
      if (!changed.ok) return err({ kind: "note-refused", refusal: changed.error });
      const recorded = await writeEvent({ id: file.id, session, event: act.recorded });
      return recorded.ok ? ok(null) : recorded;
    });
  };

  return {
    /** Undoes one of the session's saves, from wherever the owner is (ADR 0013). */
    undoSave: (rawId: string, save: number) =>
      actOnSave({ rawId, save, change: undoSave, recorded: { type: "context-undone", save } }),

    /** Edits one of the session's saved lines: its wording, its section, or both. */
    editSave: (rawId: string, save: number, now: PlacedLine) =>
      actOnSave({
        rawId,
        save,
        change: (target, state) => editSave(target, state, now),
        recorded: { type: "context-edited", save, now },
      }),

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
        ? await startTurn({ id, workspaceId: start.workspaceId, provider, message: start.message })
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
      if (await isArchived(options.contextDir, session.value.workspaceId)) {
        return err({ kind: "workspace-archived" });
      }
      const provider = await providerFor(message.model);
      if (!provider) return err({ kind: "model-unavailable" });
      return startTurn({
        id: session.value.id,
        workspaceId: session.value.workspaceId,
        provider,
        message,
      });
    },

    /** Stops the session's running turn. Whatever it wrote so far stays. */
    stop: async (rawId: string, request: StopRequest): Promise<Result<null, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      const current = running.get(session.value.id)?.turn;
      // Only the turn the owner meant: a late stop for a turn that already ended stops nothing.
      if (current?.kind !== "running" || current.turn !== request.turn) {
        return err({ kind: "nothing-running" });
      }
      current.stopper.abort();
      return ok(null);
    },

    get: async (rawId: string): Promise<Result<SessionSummary, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      // Loading a session puts right anything a stopped worker left behind first.
      await settled(session.value.id);
      return ok(summaryOf(session.value));
    },

    /** Gives a session a new title, kept in its `session.json`. */
    rename: async (rawId: string, title: string): Promise<Result<SessionSummary, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      const renamed = await updateFile(session.value.id, { title });
      return renamed.ok ? ok(summaryOf(renamed.value)) : renamed;
    },

    /** Deletes a session's folder, event log and all. Refused while a turn is running. */
    remove: async (rawId: string): Promise<Result<null, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { id } = found.value;
      const session = runningSession(id);
      // In the session's queue, so nothing is being written to it as its folder goes.
      return inOrder(session, async (): Promise<Result<null, SessionError>> => {
        if (session.turn.kind !== "idle") return err({ kind: "delete-while-running" });
        // A message from another device can't start a turn while the folder goes.
        session.turn = { kind: "deleting" };
        try {
          await rm(folderOf(id), { recursive: true, force: true, maxRetries: 5 });
        } catch {
          session.turn = { kind: "idle" };
          return err(STORAGE_ERROR);
        }
        running.delete(id);
        return ok(null);
      });
    },

    /** Whether a turn is running in any of a workspace's sessions. */
    anyRunning: async (workspaceId: WorkspaceId): Promise<Result<boolean, SessionError>> => {
      const list = await sessionsOf(workspaceId);
      return list.ok ? ok(list.value.some((session) => session.busy)) : list;
    },

    /** A workspace's sessions, most recently active first. */
    list: sessionsOf,

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
