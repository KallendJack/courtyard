import { join } from "node:path";
import { type SessionEvent, SessionId, type WorkspaceId } from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import {
  type FramedNote,
  type NoteLines,
  type ReadSessionRefusal,
  SESSION_NOTE_WRITING,
  SessionNoteAnswer,
  sessionNoteMessage,
} from "../../prompts/index.ts";
import { errandModel, type Provider } from "../../providers/index.ts";
import { getWorkspace } from "../workspaces/index.ts";

/**
 * The note each planning session leaves for the next sessions in its workspace (#601, ADR 0032;
 * docs/ai-conduct.md, Session notes): done · decided · next, a line each, written on the errand
 * model once the session has been quiet for 30 minutes or another session starts in its
 * workspace, and again when it carries on later. Kept beside its `session.json`, in the data
 * folder, never in the context folder.
 */

/** How long a session is quiet before its note is written. */
export const QUIET_MS = 30 * 60 * 1000;

/** How many notes each turn is given: its workspace's latest, besides its own session's. */
export const NOTES_GIVEN = 5;

/** The longest a line of a note is kept. */
const NOTE_LINE_MAX_CHARACTERS = 200;

/** How long the errand model may take over a note: a few lines shouldn't take long. */
const NOTE_TIMEOUT_MS = 60 * 1000;

const NOTE_FILE = "note.json";

/** A session's note as kept. */
const SessionNote = z.object({
  done: z.string(),
  decided: z.string(),
  next: z.string(),
  /** When the session's events it covers were read: anything the session does later is newer. */
  at: z.iso.datetime(),
  /** The last of its events it covers, so it's written again once a turn completes after it. */
  upTo: z.number().int().nonnegative(),
});
type SessionNote = z.infer<typeof SessionNote>;

/** A session as its note needs it: a code session (one with a branch) leaves none. */
export type NotedSession = {
  readonly id: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly title: string;
  readonly updatedAt: string;
  readonly branch?: string | undefined;
};

/** A line of a note as it's kept: on one line, cut to fit. */
const lineOf = (said: string) => {
  const line = said.replace(/\s+/g, " ").trim();
  return line.length > NOTE_LINE_MAX_CHARACTERS
    ? `${line.slice(0, NOTE_LINE_MAX_CHARACTERS - 1)}…`
    : line;
};

const said = (note: NoteLines) => [note.done, note.decided, note.next].some((line) => line !== "");

export const createSessionNotes = (options: {
  providers: readonly Provider[];
  contextDir: string;
  now: () => number;
  /** A session's folder in the data folder. */
  folderOf: (id: SessionId) => string;
  /** Every session's own file, in every workspace. */
  sessions: () => Promise<Result<readonly NotedSession[], unknown>>;
  events: (id: SessionId) => Promise<Result<SessionEvent[], unknown>>;
  /** Whether a turn is running in the session now, so it isn't quiet. */
  busy: (id: SessionId) => boolean;
  /** Runs work nobody waits for: the notes another session's start asks for. */
  background: (work: Promise<void>) => void;
}) => {
  const noteOf = async (id: SessionId) => {
    const kept = await readJsonFile(join(options.folderOf(id), NOTE_FILE), SessionNote);
    return kept.ok ? kept.value : undefined;
  };

  /** Each note being written now, by session, so a session's is written once at a time. */
  const writing = new Map<SessionId, Promise<void>>();
  /** The notes being written in each workspace, which its next turn waits for. */
  const inWorkspace = new Map<WorkspaceId, Set<Promise<void>>>();
  /** When writing each session's note last failed, so it isn't asked again until it's quiet again. */
  const failedAt = new Map<SessionId, number>();

  /** Its workspace's planning sessions, the latest first. */
  const planningIn = async (workspaceId: WorkspaceId) => {
    const all = await options.sessions();
    if (!all.ok) return [];
    return all.value
      .filter((session) => session.workspaceId === workspaceId && session.branch === undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  };

  /**
   * Writes the session's note, unless it has one since it was last used, or nothing completed
   * since its last: one question to the first errand model with room, given its conversation and
   * its note so far.
   */
  const write = async (session: NotedSession) => {
    const was = await noteOf(session.id);
    if (was !== undefined && Date.parse(session.updatedAt) <= Date.parse(was.at)) return;
    const failed = failedAt.get(session.id);
    if (failed !== undefined && options.now() - failed < QUIET_MS) return;
    const events = await options.events(session.id);
    if (!events.ok) return;
    const upTo = events.value.at(-1)?.seq ?? 0;
    const completed = events.value.some(
      (event) => event.type === "turn-completed" && event.seq > (was?.upTo ?? 0),
    );
    if (!completed) return;
    const at = new Date(options.now()).toISOString();
    const [errand, workspace] = await Promise.all([
      errandModel(options.providers),
      getWorkspace(options.contextDir, session.workspaceId),
    ]);
    if (errand === undefined || !workspace.ok) return;
    const answered = await errand.provider.answerOnce({
      purpose: "session-note",
      model: errand.model,
      ...(errand.effort === undefined ? {} : { effort: errand.effort }),
      instructions: SESSION_NOTE_WRITING,
      message: sessionNoteMessage({
        now: options.now(),
        workspace: workspace.value.summary.name,
        title: session.title,
        events: events.value,
        note: was,
      }),
      schema: SessionNoteAnswer,
      signal: AbortSignal.timeout(NOTE_TIMEOUT_MS),
    });
    const answer = answered.ok ? SessionNoteAnswer.safeParse(answered.value) : undefined;
    if (!answer?.success) {
      failedAt.set(session.id, options.now());
      return;
    }
    failedAt.delete(session.id);
    const note: SessionNote = {
      done: lineOf(answer.data.done),
      decided: lineOf(answer.data.decided),
      next: lineOf(answer.data.next),
      at,
      upTo,
    };
    // A session deleted meanwhile has no folder to write into, so nothing is left behind.
    await writeJsonFile(join(options.folderOf(session.id), NOTE_FILE), note);
  };

  /** Writes the session's note, after one already being written, which a turn in its workspace waits for. */
  const writeOnce = (session: NotedSession) => {
    const under = writing.get(session.id);
    if (under !== undefined) return under;
    const run = write(session)
      .catch((error: unknown) => console.error(`Session ${session.id}: its note crashed`, error))
      .finally(() => {
        writing.delete(session.id);
        inWorkspace.get(session.workspaceId)?.delete(run);
      });
    writing.set(session.id, run);
    const waiting = inWorkspace.get(session.workspaceId) ?? new Set();
    waiting.add(run);
    inWorkspace.set(session.workspaceId, waiting);
    return run;
  };

  /** The workspace's sessions that may need a note: its latest, enough for every turn's notes. */
  const latestIn = (sessions: readonly NotedSession[], except?: SessionId) =>
    sessions.filter((session) => session.id !== except).slice(0, NOTES_GIVEN + 1);

  return {
    /**
     * For the worker's repeating jobs: writes the note of each planning session quiet for 30
     * minutes since it was last used, one at a time, among each workspace's latest.
     */
    writeQuiet: async () => {
      const all = await options.sessions();
      if (!all.ok) return;
      const workspaces = new Set(all.value.map((session) => session.workspaceId));
      for (const workspaceId of workspaces) {
        for (const session of latestIn(await planningIn(workspaceId))) {
          const quiet = options.now() - Date.parse(session.updatedAt) >= QUIET_MS;
          if (quiet && !options.busy(session.id)) await writeOnce(session);
        }
      }
    },

    /**
     * Another session started in the workspace: each of its latest sessions' notes is written
     * now, quiet or not, and its first turn waits for them (`forTurn`).
     */
    started: (workspaceId: WorkspaceId, started: SessionId) => {
      const run = (async () => {
        const sessions = latestIn(await planningIn(workspaceId), started);
        await Promise.all(
          sessions
            .filter((session) => !options.busy(session.id))
            .map((session) => writeOnce(session)),
        );
      })();
      // Waited for as the notes it writes are, from the moment it's asked for.
      const waiting = inWorkspace.get(workspaceId) ?? new Set();
      const done = run.finally(() => inWorkspace.get(workspaceId)?.delete(done));
      waiting.add(done);
      inWorkspace.set(workspaceId, waiting);
      options.background(done);
    },

    /**
     * The notes a turn in the session is given: its workspace's latest besides its own, newest
     * first, once the notes being written there are.
     */
    forTurn: async (workspaceId: WorkspaceId, session: SessionId): Promise<FramedNote[]> => {
      await Promise.all([...(inWorkspace.get(workspaceId) ?? [])]);
      const notes: FramedNote[] = [];
      for (const each of await planningIn(workspaceId)) {
        if (each.id === session) continue;
        const note = await noteOf(each.id);
        if (note === undefined || !said(note)) continue;
        notes.push({
          session: each.id,
          title: each.title,
          lastUsed: each.updatedAt,
          done: note.done,
          decided: note.decided,
          next: note.next,
        });
        if (notes.length === NOTES_GIVEN) break;
      }
      return notes;
    },

    /**
     * An earlier session of the workspace, for the read session tool: never another workspace's,
     * a code session, or the session asking.
     */
    read: async (asked: {
      workspaceId: WorkspaceId;
      session: SessionId;
      input: unknown;
    }): Promise<
      Result<{ title: string; lastUsed: string; events: SessionEvent[] }, ReadSessionRefusal>
    > => {
      const input = z.object({ session: z.string() }).safeParse(asked.input);
      if (!input.success) return err({ kind: "malformed" });
      const named = input.data.session.trim();
      const id = SessionId.safeParse(named);
      const found = id.success
        ? (await planningIn(asked.workspaceId)).find(
            (each) => each.id === id.data && each.id !== asked.session,
          )
        : undefined;
      if (found === undefined) return err({ kind: "not-here", session: named });
      const events = await options.events(found.id);
      if (!events.ok) return err({ kind: "unreadable" });
      return ok({ title: found.title, lastUsed: found.updatedAt, events: events.value });
    },
  };
};

export type SessionNotes = ReturnType<typeof createSessionNotes>;
