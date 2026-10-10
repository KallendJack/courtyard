import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, truncate } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type Activity,
  type Attachment,
  type CarryOnRequest,
  type ChangeId,
  type Effort,
  endsTurn,
  type FailureReason,
  type FirstMessage,
  type ModelRef,
  type NewMessage,
  type Overflow,
  overflowFrom,
  type PlacedLine,
  SESSION_TITLE_MAX_LENGTH,
  SessionEvent,
  SessionId,
  type SessionSummary,
  type SkillName,
  SOURCES_MAX,
  type Source,
  type StopRequest,
  takesEffort,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import {
  attachmentPath,
  attachmentsOf,
  carriedAttachments,
  keepAttachments,
  type PreparedAttachment,
} from "../attachments/index.ts";
import {
  type BranchRefusal,
  type Code,
  type CodeRefusal,
  commandAllowed,
  editableIn,
  slotEnv,
} from "../code/index.ts";
import type { ContextFolder } from "../context-folder/index.ts";
import {
  answerAsDocument,
  createTurnDocuments,
  type DocumentRefusal,
  type DocumentSaved,
  type DocumentUndoRefusal,
  listDocuments,
  saveNewDocument,
  undoDocumentChange,
} from "../documents/index.ts";
import {
  exists,
  listFolder,
  move,
  readBytes,
  readJsonFile,
  readTextFile,
  writeJsonFile,
} from "../files.ts";
import { readOwnerContext } from "../owner-context/index.ts";
import {
  codeRefusalReason,
  DOCUMENT_TOOL_NAME,
  documentReply,
  type FramingWorkspace,
  framingFor,
  notOfferedReply,
  SAVE_TOOL_NAME,
  SUGGEST_REPLIES_TOOL_NAME,
  saveReply,
  skillsInUse,
  suggestRepliesReply,
  THING_TOOL_NAME,
  TITLING,
  TitleAnswer,
  thingReply,
  titleMessage,
  USE_SKILL_TOOL_NAME,
  useSkillReply,
} from "../prompts/index.ts";
import {
  type CodeTurn,
  firstWithRoom,
  modelsOnOffer,
  offerFor,
  type Provider,
  photosOf,
  type ToolReply,
  type TurnToolName,
} from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";
import {
  createTurnSaves,
  editSave,
  type NoteRefusal,
  type SaveState,
  type SaveTarget,
  undoSave,
} from "../saves/index.ts";
import {
  inUseTexts,
  type SkillsWorkspace,
  skillTool,
  type WorkspaceSkills,
  workspaceSkills,
} from "../skills/index.ts";
import { createTurnReplies } from "../suggested-replies/index.ts";
import {
  createTurnThings,
  readThings,
  type ThingRefusal,
  type ThingUndoRefusal,
  undoThingChange,
} from "../things/index.ts";
import { getWorkspace, isArchived } from "../workspaces/index.ts";

/** What the owner did to a save from its note. */
export type NoteAct = "undo" | "edit";

export type SessionError =
  | { readonly kind: "not-found" }
  | { readonly kind: "busy" }
  | { readonly kind: "nothing-running" }
  /** A turn is running, so the session can't be deleted until it's stopped. */
  | { readonly kind: "delete-while-running" }
  | { readonly kind: "workspace-archived" }
  /** A fresh start is setting every session aside, or did after the turn was asked for. */
  | { readonly kind: "starting-fresh" }
  | { readonly kind: "model-unavailable" }
  /** The message names a level of effort its model doesn't take. */
  | { readonly kind: "effort-unavailable" }
  /** The message starts a skill its workspace can't use, or hasn't got. */
  | { readonly kind: "skill-unavailable" }
  /** Carry on named a turn that isn't the last one, or didn't fail on a usage limit. */
  | { readonly kind: "nothing-to-carry-on" }
  /** There's no other provider to carry on with right now, and why. */
  | {
      readonly kind: "no-overflow";
      readonly overflow: Exclude<Overflow, { kind: "carry-on" }>;
    }
  /** No save in the session has that event number. */
  | { readonly kind: "save-not-found" }
  /** No message in the session carried an attachment with that id, or its file is gone. */
  | { readonly kind: "attachment-not-found" }
  /** The owner's Undo or Edit of a save couldn't be done. */
  | { readonly kind: "note-refused"; readonly act: NoteAct; readonly refusal: NoteRefusal }
  /** No finished answer to save as a document has that message's number. */
  | { readonly kind: "answer-not-found" }
  /** Saving an answer as a document, or undoing a document save, couldn't be done. */
  | { readonly kind: "document-refused"; readonly refusal: DocumentRefusal | DocumentUndoRefusal }
  /** Undoing a Thing save couldn't be done. */
  | { readonly kind: "thing-refused"; readonly refusal: ThingRefusal | ThingUndoRefusal }
  /** The model's provider can't code, so it can't work in a code workspace (ADR 0007). */
  | { readonly kind: "cannot-code"; readonly provider: string }
  /** A code session couldn't start its session branch (ADR 0007), and why. */
  | { readonly kind: "branch-refused"; readonly refusal: BranchRefusal }
  | { readonly kind: "storage"; readonly message: string };

/**
 * Why a fresh start couldn't set the sessions aside: a turn running in one, another fresh start
 * under way, or the sessions unreadable (all before anything changed); or the sessions not moved
 * after the rest was cleared.
 */
export type SetAsideRefusal =
  | { readonly kind: "running"; readonly session: SessionSummary }
  | { readonly kind: "starting-fresh" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "not-moved" };

/** A session's own file, beside its event log. */
const SessionFile = z.object({
  id: SessionId,
  workspaceId: WorkspaceId,
  title: z.string(),
  /**
   * Who set the title, when a model mustn't change it: the owner by renaming it, or a starter
   * message whose first line is the title (Get to know). Left out otherwise, and in older files.
   */
  titledBy: z.enum(["owner", "starter"]).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** A code session's session branch (ADR 0007); left out in a planning workspace. */
  branch: z.string().optional(),
});
type SessionFile = z.infer<typeof SessionFile>;

/** An event before it's numbered and timed. */
type WithoutNumbering<E> = E extends unknown ? Omit<E, "seq" | "at"> : never;
type NewEvent = WithoutNumbering<SessionEvent>;

/** Text as a title: its first line, cut short with an ellipsis when it's too long for one. */
const titleFrom = (text: string) => {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > SESSION_TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, SESSION_TITLE_MAX_LENGTH - 1)}…`
    : firstLine;
};

/**
 * A model's title as the session gets it: on one line, without the quotes or full stop it was
 * told to leave off, and no longer than a title can be. `undefined` when nothing is left.
 */
const modelTitle = (answer: unknown) => {
  const parsed = TitleAnswer.safeParse(answer);
  if (!parsed.success) return undefined;
  const tidied = parsed.data.title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  return tidied === "" ? undefined : titleFrom(tidied);
};

/** How long titling a session can take before it's given up on: a few words shouldn't take long. */
const TITLING_TIMEOUT_MS = 2 * 60 * 1000;

/** A session's file that no one has given a title the model mustn't change. */
const titledByNobody = (
  file: Result<SessionFile | undefined, unknown>,
): file is { ok: true; value: SessionFile } =>
  file.ok && file.value !== undefined && file.value.titledBy === undefined;

/**
 * The session's first message and its first answer: the text of the first turn that completed,
 * which can be a carried-on one. `undefined` when no turn has completed.
 */
const firstAnswer = (events: readonly SessionEvent[]) => {
  const message = events.find((event) => event.type === "owner-message");
  let answer = "";
  for (const event of events) {
    if (event.type === "owner-message") answer = "";
    if (event.type === "text-delta") answer += event.text;
    if (event.type === "turn-completed") {
      return message?.type === "owner-message" ? { message: message.text, answer } : undefined;
    }
  }
  return undefined;
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
 * The answer to the owner's message numbered `turn`, once its turn has ended: `undefined` when no
 * message has that number, or its turn is still running.
 */
const answerTo = (events: readonly SessionEvent[], turn: number) => {
  const start = events.findIndex((event) => event.seq === turn && event.type === "owner-message");
  if (start === -1) return undefined;
  let answer = "";
  for (const event of events.slice(start + 1)) {
    if (event.type === "owner-message") break;
    if (event.type === "text-delta") answer += event.text;
    if (endsTurn(event)) return answer;
  }
  return undefined;
};

/**
 * The owner's message numbered `turn`, when it's the session's last and its turn ended on a usage
 * limit: the only turn Carry on can take on. `undefined` otherwise.
 */
const limitedTurn = (events: readonly SessionEvent[], turn: number) => {
  const message = events.findLast((event) => event.type === "owner-message");
  const ending = events.findLast(endsTurn);
  return message?.type === "owner-message" &&
    message.seq === turn &&
    ending?.type === "turn-failed" &&
    ending.seq > message.seq &&
    ending.reason.kind === "rate-limited"
    ? message
    : undefined;
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
  /** Resolves once the turn last started here has ended, its end recorded. */
  ended: Promise<void>;
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
  /** The house skills' folder (ADR 0016). */
  houseSkills: string;
  /** Code sessions' branches and worktrees (ADR 0007). */
  code: Code;
  now: () => number;
}) => {
  const sessionsDir = join(options.dataDir, "sessions");
  const running = new Map<SessionId, RunningSession>();
  /** Set while a fresh start sets every session aside: no turn starts meanwhile. */
  let settingAside = false;
  /**
   * How many fresh starts this worker has made. A turn set up before one (its session found, its
   * provider asked) doesn't start after it.
   */
  let freshStarts = 0;
  const stamp = () => new Date(options.now()).toISOString();

  const runningSession = (id: SessionId): RunningSession => {
    const existing = running.get(id);
    if (existing) return existing;
    const created: RunningSession = {
      turn: { kind: "idle" },
      nextSeq: undefined,
      listeners: new Set(),
      queue: Promise.resolve(),
      ended: Promise.resolve(),
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
  const updateFile = (
    id: SessionId,
    change: Partial<Pick<SessionFile, "title" | "titledBy" | "updatedAt">>,
  ) =>
    inOrder(runningSession(id), async (): Promise<Result<SessionFile, SessionError>> => {
      const file = await readJsonFile(sessionFilePath(id), SessionFile);
      if (!file.ok) return err(STORAGE_ERROR);
      if (!file.value) return err({ kind: "not-found" });
      const changed = { ...file.value, ...change };
      const written = await writeJsonFile(sessionFilePath(id), changed);
      return written.ok ? ok(changed) : err(STORAGE_ERROR);
    });

  const markUpdated = (id: SessionId) => updateFile(id, { updatedAt: stamp() });

  /** A workspace's skills (ADR 0016), as its folder, mode and repo give them. */
  const skillsOf = (workspace: SkillsWorkspace) =>
    workspaceSkills({
      contextDir: options.contextDir,
      houseFolder: options.houseSkills,
      workspace,
    });

  /**
   * What a turn needs from its workspace: its name, mode and folder, its context file as written,
   * the owner context, and its skills.
   */
  const turnWorkspaceOf = async (
    workspaceId: WorkspaceId,
  ): Promise<Result<FramingWorkspace & { folder: string; skills: WorkspaceSkills }, string>> => {
    const [workspace, ownerContext] = await Promise.all([
      getWorkspace(options.contextDir, workspaceId),
      readOwnerContext(options.contextDir),
    ]);
    if (!workspace.ok) return err("This session's workspace can't be read.");
    if (!ownerContext.ok) return err(ownerContext.error.message);
    const { summary, folder, contextMarkdown } = workspace.value;
    const documents =
      summary.mode === "planning"
        ? await listDocuments({ contextDir: options.contextDir, workspaceId })
        : ok([]);
    if (!documents.ok) return err("This session's workspace's documents can't be read.");
    const things =
      summary.mode === "planning"
        ? await readThings({ contextDir: options.contextDir, workspaceId })
        : ok({ things: [], problems: [] });
    if (!things.ok) return err("This session's workspace's Things can't be read.");
    return ok({
      name: summary.name,
      mode: summary.mode,
      folder,
      contextFile: contextMarkdown,
      ownerContext: ownerContext.value,
      documents: documents.value,
      things: things.value,
      skills: await skillsOf(workspace.value),
    });
  };

  /** Where a session's saves go: its workspace's context file and the owner context, as changes naming the session. */
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
    effort: Effort | undefined;
    /** Whether it's in a code session, so it runs only once it has a slot among them. */
    coding: boolean;
    /** Whether it answers the session's first message, so the session is titled once it completes. */
    firstTurn: boolean;
  }) => {
    const session = runningSession(turn.id);
    const stopper = turn.stopper;
    const stoppedByOwner = new Promise<"stopped">((resolve) => {
      stopper.signal.addEventListener("abort", () => resolve("stopped"), { once: true });
    });
    let failure: FailureReason | undefined;
    /** Set when part of the turn couldn't be recorded, so it can't count as complete. */
    let recordingLost = false;
    /** Tool calls still under way (a save being written, say), which finish before the turn ends. */
    const callsUnderway = new Set<Promise<unknown>>();
    const taken = turn.coding ? options.code.slots.take(turn.id, stopper.signal) : undefined;
    // Every device sees the turn wait, and start (ADR 0006).
    if (taken?.queued && !(await append(turn.id, { type: "turn-queued" })).ok) recordingLost = true;
    const slot = await taken?.slot;
    if (taken?.queued && slot !== undefined) {
      if (!(await append(turn.id, { type: "turn-dequeued" })).ok) recordingLost = true;
    }
    try {
      const [events, workspace, file] = await Promise.all([
        readEvents(turn.id),
        turnWorkspaceOf(turn.workspaceId),
        readJsonFile(sessionFilePath(turn.id), SessionFile),
      ]);
      if (taken !== undefined && slot === undefined) {
        // Stopped while it waited for a slot, so it never ran.
      } else if (!events.ok || !file.ok) {
        failure = { kind: "unknown", message: "The session's event log can't be read." };
      } else if (!workspace.ok) {
        failure = { kind: "unknown", message: workspace.error };
      } else {
        const { skills } = workspace.value;
        const inUse = skillsInUse(events.value);
        const framing = framingFor({
          workspace: workspace.value,
          capabilities: turn.provider.capabilities,
          events: events.value,
          skills: {
            offered: skills.usable.filter((skill) => !skill.ownerOnly),
            inUse: await inUseTexts(skills.usable, inUse),
          },
          attachments: await carriedAttachments(folderOf(turn.id), events.value),
          now: options.now(),
        });
        const turnDocuments = createTurnDocuments(targetOf(turn));
        const report = async (activity: Activity) => {
          if (recordingLost || stopper.signal.aborted) return;
          // A document read is what the model has seen of it, before anyone hears of the read.
          if (activity.kind === "read-file") await turnDocuments.read(activity.path);
          const recorded = await append(turn.id, { type: "activity", activity });
          if (!recorded.ok) recordingLost = true;
        };
        /** Records the answer's sources (ADR 0019), once, unless the turn was stopped. */
        let cited = false;
        const cite = async (sources: readonly Source[]) => {
          if (cited || sources.length === 0 || recordingLost || stopper.signal.aborted) return;
          cited = true;
          const recorded = await append(turn.id, {
            type: "sources",
            sources: sources.slice(0, SOURCES_MAX),
          });
          if (!recorded.ok) recordingLost = true;
        };
        const useSkill = skillTool({ skills: skills.usable, inUse, report });
        const turnSaves = createTurnSaves({
          ...targetOf(turn),
          shown: {
            workspace: workspace.value.contextFile,
            owner: workspace.value.ownerContext?.markdown ?? null,
          },
          mode: workspace.value.mode,
        });
        /** Whether the last save was refused, so this one is its retry. */
        let retrying = false;
        const save = async (input: unknown): Promise<ToolReply> => {
          // A provider winding down after a stop saves nothing more; one already saving finishes.
          if (stopper.signal.aborted || recordingLost) {
            return saveReply(err({ kind: "stopped" }), true);
          }
          const saved = await turnSaves(input);
          if (saved.ok) {
            const { value: save, change } = saved.value;
            const recorded = await append(turn.id, {
              type: "context-saved",
              save,
              ...(change === undefined ? {} : { change }),
            });
            if (!recorded.ok) recordingLost = true;
          }
          const reply = saveReply(saved, retrying);
          retrying = !saved.ok && !retrying;
          return reply;
        };
        /** Whether the last document save was refused, so this one is its retry. */
        let retryingDocument = false;
        const saveDocument = async (input: unknown): Promise<ToolReply> => {
          if (stopper.signal.aborted || recordingLost) {
            return documentReply(err({ kind: "stopped" }), true);
          }
          const saved = await turnDocuments.save(input);
          if (saved.ok) {
            const { save, change } = saved.value;
            const recorded = await append(turn.id, {
              type: "document-saved",
              save,
              ...(change === undefined ? {} : { change }),
            });
            if (!recorded.ok) recordingLost = true;
          }
          const reply = documentReply(saved, retryingDocument);
          retryingDocument = !saved.ok && !retryingDocument;
          return reply;
        };
        const turnThings = createTurnThings({
          ...targetOf(turn),
          shown: workspace.value.things.things,
          photos: photosOf(framing.attachments),
          now: options.now(),
        });
        /** Whether the last Thing save was refused, so this one is its retry. */
        let retryingThing = false;
        const saveThingTool = async (input: unknown): Promise<ToolReply> => {
          if (stopper.signal.aborted || recordingLost) {
            return thingReply(err({ kind: "stopped" }), true);
          }
          const saved = await turnThings(input);
          if (saved.ok) {
            const { save, change } = saved.value;
            const recorded = await append(turn.id, {
              type: "thing-saved",
              save,
              ...(change === undefined ? {} : { change }),
            });
            if (!recorded.ok) recordingLost = true;
          }
          const reply = thingReply(saved, retryingThing);
          retryingThing = !saved.ok && !retryingThing;
          return reply;
        };
        /** Records a piece of the answer. Anything after the owner stopped the turn is dropped. */
        const write = async (text: string) => {
          if (text === "" || recordingLost || stopper.signal.aborted) return;
          const recorded = await append(turn.id, { type: "text-delta", text });
          if (!recorded.ok) recordingLost = true;
        };
        const replies = createTurnReplies({
          stopped: () => stopper.signal.aborted || recordingLost,
          record: async (replies) => {
            const recorded = await append(turn.id, {
              type: "suggested-replies",
              replies: [...replies],
            });
            if (!recorded.ok) recordingLost = true;
          },
        });
        /** What answers each of Courtyard's tools, by name: every one a turn can offer. */
        const answers: Readonly<Record<TurnToolName, (input: unknown) => Promise<ToolReply>>> = {
          [SAVE_TOOL_NAME]: save,
          [DOCUMENT_TOOL_NAME]: saveDocument,
          [THING_TOOL_NAME]: saveThingTool,
          [USE_SKILL_TOOL_NAME]: async (input) => useSkillReply(await useSkill(input)),
          [SUGGEST_REPLIES_TOOL_NAME]: async (input) =>
            suggestRepliesReply(await replies.suggest(input)),
        };
        /** A model's call to one of Courtyard's tools, answered only when the framing offers it. */
        const callTool = (call: { name: string; input: unknown }): Promise<ToolReply> => {
          const offered = framing.tools.find((tool) => tool.name === call.name);
          return offered === undefined
            ? Promise.resolve(notOfferedReply(call.name))
            : answers[offered.name](call.input);
        };
        const branch = file.value?.branch;
        const worktree = branch === undefined ? undefined : options.code.worktreeOf(turn.id);
        /** Says whether something may happen in a code session, telling the owner when it does. */
        const decide = async (
          decided: Result<Activity, CodeRefusal>,
        ): Promise<Result<null, string>> => {
          if (stopper.signal.aborted || recordingLost) {
            return err(codeRefusalReason({ kind: "stopped" }));
          }
          if (!decided.ok) return err(codeRefusalReason(decided.error));
          await report(decided.value);
          return ok(null);
        };
        /** A code session's turn: each edit and command the model asks for, decided (ADR 0007). */
        const codeTurn = (worktree: string, branch: string): CodeTurn => ({
          worktree,
          env: slot === undefined ? {} : slotEnv(slot),
          edit: async (path) => {
            const shown = await editableIn(worktree, path);
            return decide(
              shown === undefined
                ? err({ kind: "outside" })
                : ok({ kind: "edited-file", path: shown }),
            );
          },
          run: async (command) => {
            const allowed = await commandAllowed({ worktree, branch }, command);
            return decide(allowed.ok ? ok({ kind: "ran-command", command }) : allowed);
          },
        });
        // Raced against the stop, so a provider that ignores it can't keep the session busy.
        const outcome = await Promise.race([
          turn.provider.runTurn({
            model: turn.model,
            effort: turn.effort,
            folder: worktree ?? workspace.value.folder,
            code:
              worktree === undefined || branch === undefined ? null : codeTurn(worktree, branch),
            framing,
            callTool: (call) => {
              const calling = callTool(call);
              callsUnderway.add(calling);
              void calling.finally(() => callsUnderway.delete(calling));
              return calling;
            },
            emit: (text) => write(replies.kept(text)),
            report,
            cite,
            signal: stopper.signal,
          }),
          stoppedByOwner,
        ]);
        if (outcome !== "stopped" && !outcome.ok) failure = outcome.error;
        // The last line, held back in case it repeated the answer, when it didn't.
        else if (outcome !== "stopped") await write(replies.end());
      }
    } catch (error) {
      // A provider throwing is a bug in its adapter: the details go to the worker's log, and the
      // session records the turn's end in plain words.
      console.error(`Session ${turn.id}: the provider threw`, error);
      failure = { kind: "unknown", message: "The model connection stopped unexpectedly." };
    }
    // A save already being written stays, whatever happens to the turn (ADR 0013), and a tool
    // call under way finishes, recording what it did.
    await Promise.allSettled(callsUnderway);
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
    // Only once it's ended, so the next code session waiting starts after it.
    options.code.slots.release(turn.id);
    if (!ended.ok) console.error(`Session ${turn.id}: the end of a turn couldn't be recorded.`);
    else if (turn.firstTurn && ending.type === "turn-completed") {
      titleSession(turn.id).catch((error: unknown) =>
        console.error(`Session ${turn.id}: titling it crashed`, error),
      );
    }
  };

  /**
   * Titles a session after its first answer (docs/ai-conduct.md, Titling a session): the first
   * model not at its usage limit, at its lowest effort, is given the first message and the start
   * of the answer. Its title is written unless the owner or a starter set one, checked in the
   * session's queue so a rename made meanwhile wins. Nobody waits on it, and when it fails the
   * first line stays, with nothing shown and nothing retried.
   */
  const titleSession = async (id: SessionId) => {
    const session = running.get(id);
    const [file, events, offered] = await Promise.all([
      readJsonFile(sessionFilePath(id), SessionFile),
      readEvents(id),
      modelsOnOffer(options.providers),
    ]);
    const chosen = firstWithRoom(offered);
    const first = events.ok ? firstAnswer(events.value) : undefined;
    if (!titledByNobody(file) || session === undefined || !chosen || !first) return;
    // Least first, so the first is the lowest; a model that takes none answers at its default.
    const lowest = chosen.model.efforts[0]?.id;
    const answered = await chosen.provider.answerOnce({
      purpose: "title",
      model: chosen.model.id,
      ...(lowest === undefined ? {} : { effort: lowest }),
      instructions: TITLING,
      message: titleMessage(first),
      schema: TitleAnswer,
      signal: AbortSignal.timeout(TITLING_TIMEOUT_MS),
    });
    const title = answered.ok ? modelTitle(answered.value) : undefined;
    if (title === undefined) return;
    await inOrder(session, async () => {
      // Deleted, or set aside by a fresh start, meanwhile.
      if (settingAside || running.get(id) !== session) return;
      const now = await readJsonFile(sessionFilePath(id), SessionFile);
      if (!titledByNobody(now)) return;
      const written = await writeJsonFile(sessionFilePath(id), { ...now.value, title });
      if (!written.ok) return;
      const recorded = await writeEvent({ id, session, event: { type: "session-titled", title } });
      if (!recorded.ok) console.error(`Session ${id}: its new title couldn't be recorded.`);
    });
  };

  const startTurn = async (start: {
    id: SessionId;
    workspaceId: WorkspaceId;
    provider: Provider;
    message: NewMessage;
    /**
     * Carry on from the turn with this number: checked again once the session is this turn's, in
     * case a newer one ran meanwhile, and the move to the message's model recorded first.
     */
    carryingOn?: { turn: number };
    /** How many fresh starts there had been when the turn was asked for. */
    since: number;
    /** It's in a code session, so it runs only once it has a slot among them. */
    coding: boolean;
    /** It answers the session's first message, so the session is titled once it completes. */
    firstTurn?: boolean;
    /** The files the owner attached, checked, to keep in the session's folder (#78). */
    attachments?: readonly PreparedAttachment[];
    /** Attachments already kept that the message carries again (Carry on). */
    keptAttachments?: readonly Attachment[];
  }): Promise<Result<null, SessionError>> => {
    if (settingAside || start.since !== freshStarts) return err({ kind: "starting-fresh" });
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

    if (start.carryingOn) {
      const events = await readEvents(start.id);
      const stillLimited = events.ok && limitedTurn(events.value, start.carryingOn.turn);
      const changed = stillLimited
        ? await append(start.id, { type: "model-changed", model: start.message.model })
        : err<SessionError>(events.ok ? { kind: "nothing-to-carry-on" } : events.error);
      if (!changed.ok) {
        session.turn = { kind: "idle" };
        return changed;
      }
    }
    const kept = await keepAttachments(folderOf(start.id), start.attachments ?? []);
    if (!kept.ok) {
      session.turn = { kind: "idle" };
      return err(STORAGE_ERROR);
    }
    const attachments = [
      ...(start.keptAttachments ?? []),
      ...(start.attachments ?? []).map((prepared) => prepared.attachment),
    ];
    const recorded = await append(start.id, {
      type: "owner-message",
      text: start.message.text,
      model: start.message.model,
      ...(start.message.effort === undefined ? {} : { effort: start.message.effort }),
      ...(start.message.skill === undefined ? {} : { skill: start.message.skill }),
      ...(attachments.length === 0 ? {} : { attachments }),
    });
    if (!recorded.ok) {
      session.turn = { kind: "idle" };
      return recorded;
    }
    starting.turn = recorded.value.seq;
    await markUpdated(start.id);
    session.ended = runTurn({
      id: start.id,
      stopper: starting.stopper,
      workspaceId: start.workspaceId,
      provider: start.provider,
      model: start.message.model.model,
      effort: start.message.effort,
      coding: start.coding,
      firstTurn: start.firstTurn ?? false,
    }).catch((error: unknown) => console.error(`Session ${start.id}: a turn crashed`, error));
    return ok(null);
  };

  /**
   * Whether the skill a message starts, if any, is one its workspace can use: one of its skills,
   * not broken, and without scripts in a planning workspace.
   */
  const skillUsable = async (
    workspaceId: WorkspaceId,
    message: { skill?: SkillName | undefined },
  ): Promise<Result<null, SessionError>> => {
    if (message.skill === undefined) return ok(null);
    const workspace = await getWorkspace(options.contextDir, workspaceId);
    if (!workspace.ok) return err(STORAGE_ERROR);
    const skills = await skillsOf(workspace.value);
    return skills.usable.some((skill) => skill.name === message.skill)
      ? ok(null)
      : err({ kind: "skill-unavailable" });
  };

  /** The provider to answer a message: its model must be on offer, and take its effort. */
  const providerFor = async (message: NewMessage): Promise<Result<Provider, SessionError>> => {
    const offer = await offerFor(options.providers, message.model);
    if (!offer) return err({ kind: "model-unavailable" });
    if (!takesEffort(offer.model, message.effort)) return err({ kind: "effort-unavailable" });
    return ok(offer.provider);
  };

  /**
   * The provider to answer a message in a workspace, as `providerFor`; and in a code workspace,
   * its repository.
   */
  const providerIn = async (
    workspaceId: WorkspaceId,
    message: NewMessage,
  ): Promise<Result<{ provider: Provider; repoPath: string | undefined }, SessionError>> => {
    const provider = await providerFor(message);
    if (!provider.ok) return provider;
    const workspace = await getWorkspace(options.contextDir, workspaceId);
    if (!workspace.ok) {
      return err(
        workspace.error.kind === "archived" ? { kind: "workspace-archived" } : STORAGE_ERROR,
      );
    }
    const { summary, repoPath } = workspace.value;
    if (summary.mode === "planning") return ok({ provider: provider.value, repoPath: undefined });
    const coding = await codes(provider.value);
    return coding.ok ? ok({ provider: provider.value, repoPath: repoPath ?? "" }) : coding;
  };

  /** Whether a provider can work in a code workspace: only one that codes can (ADR 0007). */
  const codes = async (provider: Provider): Promise<Result<null, SessionError>> =>
    provider.capabilities.codes
      ? ok(null)
      : err({ kind: "cannot-code", provider: (await provider.status()).label });

  /** Every provider's status, with the usage limits its models are at. */
  const statuses = () => Promise.all(options.providers.map((provider) => provider.status()));

  /**
   * A first message with its model: the one it names, or else the first model on offer that isn't
   * at its usage limit (the first of all when every one is).
   */
  const withModel = async (message: FirstMessage): Promise<Result<NewMessage, SessionError>> => {
    const { model } = message;
    if (model !== undefined) return ok({ ...message, model });
    const offered = await modelsOnOffer(options.providers);
    const chosen = firstWithRoom(offered) ?? offered[0];
    return chosen
      ? ok({ text: message.text, model: { provider: chosen.provider.id, model: chosen.model.id } })
      : err({ kind: "model-unavailable" });
  };

  const summaryOf = ({ titledBy: _, ...file }: SessionFile): SessionSummary => ({
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

  /** A session whose turn is running, in any workspace, or `undefined` when none is. */
  const busySession = async (): Promise<Result<SessionSummary | undefined, "unreadable">> => {
    for (const [id, session] of running) {
      if (session.turn.kind === "idle" || session.turn.kind === "deleting") continue;
      const file = await readJsonFile(sessionFilePath(id), SessionFile);
      if (!file.ok) return file;
      if (file.value) return ok(summaryOf(file.value));
    }
    return ok(undefined);
  };

  /**
   * A workspace's sessions, most recently active first, each with whether it's waiting for a code
   * session to end.
   */
  const sessionsOf = async (
    workspaceId: WorkspaceId,
  ): Promise<Result<(SessionSummary & { queued: boolean })[], SessionError>> => {
    const folders = await listFolder(sessionsDir);
    if (!folders.ok) return err(STORAGE_ERROR);
    const summaries: (SessionSummary & { queued: boolean })[] = [];
    for (const folder of folders.value) {
      const id = SessionId.safeParse(folder);
      if (!id.success) continue;
      const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
      if (!file.ok) return err(STORAGE_ERROR);
      if (file.value?.workspaceId !== workspaceId) continue;
      await settled(file.value.id);
      summaries.push({ ...summaryOf(file.value), queued: options.code.slots.waits(file.value.id) });
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
    kind: NoteAct;
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
      if (!changed.ok) return err({ kind: "note-refused", act: act.kind, refusal: changed.error });
      const recorded = await writeEvent({ id: file.id, session, event: act.recorded });
      return recorded.ok ? ok(null) : recorded;
    });
  };

  /**
   * Undoes one of the session's document or Thing saves, by its event number or the change it was
   * committed as, and records that in the session.
   */
  const undoFileSave = async (
    undo: { rawId: string; save: number | ChangeId },
    of: "document" | "thing",
  ): Promise<Result<null, SessionError>> => {
    const found = await findSession(undo.rawId);
    if (!found.ok) return found;
    const file = found.value;
    if (await isArchived(options.contextDir, file.workspaceId)) {
      return err({ kind: "workspace-archived" });
    }
    const refused = (refusal: DocumentUndoRefusal): SessionError =>
      of === "document"
        ? { kind: "document-refused", refusal }
        : { kind: "thing-refused", refusal };
    const session = runningSession(file.id);
    return inOrder(session, async (): Promise<Result<null, SessionError>> => {
      const events = await readEvents(file.id);
      if (!events.ok) return events;
      const saved = events.value.find(
        (event) =>
          event.type === `${of}-saved` &&
          "change" in event &&
          (typeof undo.save === "number" ? event.seq === undo.save : event.change === undo.save),
      );
      if (saved === undefined || !("change" in saved)) return err({ kind: "save-not-found" });
      const undone = events.value.some(
        (event) => event.type === `${of}-undone` && "save" in event && event.save === saved.seq,
      );
      if (undone) return err(refused({ kind: "already-undone" }));
      if (saved.change === undefined) return err(refused({ kind: "not-undoable" }));
      const reversed =
        of === "document"
          ? await undoDocumentChange(targetOf(file), saved.change)
          : await undoThingChange(targetOf(file), saved.change);
      if (!reversed.ok) return err(refused(reversed.error));
      const recorded = await writeEvent({
        id: file.id,
        session,
        event: { type: of === "document" ? "document-undone" : "thing-undone", save: saved.seq },
      });
      return recorded.ok ? ok(null) : recorded;
    });
  };

  return {
    /**
     * Save as document (ADR 0020): the whole answer to the owner's message numbered `answer`, as a
     * new document called `name` in the session's workspace, with no model turn. Recorded in the
     * session, so its note shows under that answer with Undo.
     */
    saveAsDocument: async (save: {
      rawId: string;
      answer: number;
      name: string;
    }): Promise<Result<DocumentSaved, SessionError>> => {
      const found = await findSession(save.rawId);
      if (!found.ok) return found;
      const file = found.value;
      if (await isArchived(options.contextDir, file.workspaceId)) {
        return err({ kind: "workspace-archived" });
      }
      const session = runningSession(file.id);
      return inOrder(session, async (): Promise<Result<DocumentSaved, SessionError>> => {
        const events = await readEvents(file.id);
        if (!events.ok) return events;
        const answer = answerTo(events.value, save.answer);
        if (answer === undefined || answer.trim() === "") return err({ kind: "answer-not-found" });
        const saved = await saveNewDocument(
          { ...targetOf(file), sessionId: file.id },
          answerAsDocument(answer, save.name),
        );
        if (!saved.ok) return err({ kind: "document-refused", refusal: saved.error });
        const { change } = saved.value;
        const recorded = await writeEvent({
          id: file.id,
          session,
          event: {
            type: "document-saved",
            save: saved.value.save,
            answer: save.answer,
            ...(change === undefined ? {} : { change }),
          },
        });
        return recorded.ok ? ok(saved.value) : recorded;
      });
    },

    /**
     * Undoes one of the session's document saves, by its event number, or by the change it was
     * committed as (from Recent changes): the document goes back as it was, unless it's changed
     * since. Recorded in the session, so its note shows it from any device.
     */
    undoDocument: (undo: { rawId: string; save: number | ChangeId }) =>
      undoFileSave(undo, "document"),

    /**
     * Undoes one of the session's Thing saves (ADR 0020), by its event number, or by the change it
     * was committed as (from Recent changes): the Thing, and its photo, go back as they were, unless
     * they've changed since. Recorded in the session, so its note shows it from any device.
     */
    undoThing: (undo: { rawId: string; save: number | ChangeId }) => undoFileSave(undo, "thing"),

    /** Undoes one of the session's saves, from wherever the owner is (ADR 0013). */
    undoSave: ({ rawId, save }: { rawId: string; save: number }) =>
      actOnSave({
        rawId,
        save,
        kind: "undo",
        change: undoSave,
        recorded: { type: "context-undone", save },
      }),

    /** A session's saves as they stand now, oldest first, each by its event number. */
    savesOf: async (
      rawId: string,
    ): Promise<
      Result<{ seq: number; state: SaveState; change: ChangeId | undefined }[], SessionError>
    > => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const events = await readEvents(found.value.id);
      if (!events.ok) return events;
      return ok(
        events.value.flatMap((event) => {
          if (event.type !== "context-saved") return [];
          const state = saveStateOf(events.value, event.seq);
          return state ? [{ seq: event.seq, state, change: event.change }] : [];
        }),
      );
    },

    /** Edits one of the session's saved lines: its wording, its section, or both. */
    editSave: ({ rawId, save, now }: { rawId: string; save: number; now: PlacedLine }) =>
      actOnSave({
        rawId,
        save,
        kind: "edit",
        change: (target, state) => editSave(target, { state, now }),
        recorded: { type: "context-edited", save, now },
      }),

    /** Starts a session with the owner's first message, so there are never empty ones. */
    create: async (start: {
      workspaceId: WorkspaceId;
      message: FirstMessage;
      /** Started with a starter message, whose first line stays the title (Get to know). */
      starter?: boolean;
      /** The files attached to the first message, checked (#78). */
      attachments?: readonly PreparedAttachment[];
    }): Promise<Result<SessionSummary, SessionError>> => {
      const since = freshStarts;
      if (settingAside) return err({ kind: "starting-fresh" });
      const message = await withModel(start.message);
      if (!message.ok) return message;
      const usable = await skillUsable(start.workspaceId, message.value);
      if (!usable.ok) return usable;
      const provider = await providerIn(start.workspaceId, message.value);
      // A fresh start meanwhile may have taken its workspace away.
      if (settingAside || since !== freshStarts) return err({ kind: "starting-fresh" });
      if (!provider.ok) return provider;
      const { repoPath } = provider.value;
      const id = SessionId.parse(randomUUID());
      const at = stamp();
      // A code session works on its own session branch from the start (ADR 0007).
      const branched =
        repoPath === undefined
          ? undefined
          : await options.code.startBranch({ repoPath, sessionId: id });
      if (branched !== undefined && !branched.ok) {
        return err({ kind: "branch-refused", refusal: branched.error });
      }
      const sessionBranch = branched?.value;
      const file: SessionFile = {
        id,
        workspaceId: start.workspaceId,
        title: titleFrom(start.message.text),
        ...(start.starter ? { titledBy: "starter" } : {}),
        createdAt: at,
        updatedAt: at,
        ...(sessionBranch === undefined ? {} : { branch: sessionBranch.branch }),
      };
      const unstarted = async () => {
        if (repoPath !== undefined && sessionBranch !== undefined) {
          await options.code.clearBranch({ repoPath, sessionBranch });
        }
      };
      try {
        await mkdir(folderOf(id), { recursive: true });
      } catch {
        await unstarted();
        return err(STORAGE_ERROR);
      }
      const written = await writeJsonFile(sessionFilePath(id), file);
      const started = written.ok
        ? await startTurn({
            id,
            workspaceId: start.workspaceId,
            provider: provider.value.provider,
            message: message.value,
            since,
            coding: sessionBranch !== undefined,
            firstTurn: true,
            ...(start.attachments === undefined ? {} : { attachments: start.attachments }),
          })
        : err(STORAGE_ERROR);
      if (!started.ok) {
        // Never leave a session behind without its first message.
        await rm(folderOf(id), { recursive: true, force: true });
        await unstarted();
        running.delete(id);
        return started;
      }
      return ok(summaryOf(file));
    },

    /** Starts a turn; returns as soon as the owner's message is recorded. */
    send: async (send: {
      rawId: string;
      message: NewMessage;
      /** The files attached to it, checked (#78). */
      attachments: readonly PreparedAttachment[];
    }): Promise<Result<null, SessionError>> => {
      const { rawId, message, attachments } = send;
      const since = freshStarts;
      const session = await findSession(rawId);
      if (!session.ok) return session;
      if (await isArchived(options.contextDir, session.value.workspaceId)) {
        return err({ kind: "workspace-archived" });
      }
      const provider = await providerIn(session.value.workspaceId, message);
      if (!provider.ok) return provider;
      const usable = await skillUsable(session.value.workspaceId, message);
      if (!usable.ok) return usable;
      return startTurn({
        id: session.value.id,
        workspaceId: session.value.workspaceId,
        provider: provider.value.provider,
        message,
        since,
        coding: session.value.branch !== undefined,
        attachments,
      });
    },

    /**
     * Carry on (spec, Overflow): after the session's last turn hit a usage limit, records the move
     * to another provider's default model and sends the turn's message to it again, at its default
     * effort. Only ever because the owner asked.
     */
    carryOn: async (
      rawId: string,
      request: CarryOnRequest,
    ): Promise<Result<null, SessionError>> => {
      const since = freshStarts;
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { id, workspaceId } = found.value;
      if (await isArchived(options.contextDir, workspaceId)) {
        return err({ kind: "workspace-archived" });
      }
      await settled(id);
      const events = await readEvents(id);
      if (!events.ok) return events;
      const message = limitedTurn(events.value, request.turn);
      if (message === undefined) return err({ kind: "nothing-to-carry-on" });
      const overflow = overflowFrom(await statuses(), message.model.provider);
      if (overflow.kind !== "carry-on") return err({ kind: "no-overflow", overflow });
      const provider = options.providers.find((p) => p.id === overflow.model.provider);
      if (!provider) return err({ kind: "model-unavailable" });
      if (found.value.branch !== undefined) {
        const coding = await codes(provider);
        if (!coding.ok) return coding;
      }
      return startTurn({
        id,
        workspaceId,
        provider,
        // The owner's skill goes with it, so the new model follows it too.
        message: {
          text: message.text,
          model: overflow.model,
          ...(message.skill === undefined ? {} : { skill: message.skill }),
        },
        carryingOn: { turn: request.turn },
        coding: found.value.branch !== undefined,
        // Its attachments go again too, already in the session's folder.
        ...(message.attachments === undefined ? {} : { keptAttachments: message.attachments }),
        // Carrying on the first message is still the session's first turn.
        firstTurn: events.value.find((event) => event.type === "owner-message") === message,
        since,
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

    /** One of the session's attachments (#78) and its bytes, by its id. */
    attachment: async (
      rawId: string,
      rawAttachmentId: string,
    ): Promise<Result<{ attachment: Attachment; bytes: Buffer }, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const events = await readEvents(found.value.id);
      if (!events.ok) return events;
      const attachment = attachmentsOf(events.value).find(({ id }) => id === rawAttachmentId);
      if (attachment === undefined) return err({ kind: "attachment-not-found" });
      const bytes = await readBytes(attachmentPath(folderOf(found.value.id), attachment));
      if (!bytes.ok) return err(STORAGE_ERROR);
      return bytes.value === undefined
        ? err({ kind: "attachment-not-found" })
        : ok({ attachment, bytes: bytes.value });
    },

    get: async (rawId: string): Promise<Result<SessionSummary, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      // Loading a session puts right anything a stopped worker left behind first.
      await settled(session.value.id);
      return ok(summaryOf(session.value));
    },

    /**
     * Gives a session a new title, kept in its `session.json`, marked as the owner's so no model
     * titles it after that.
     */
    rename: async (rawId: string, title: string): Promise<Result<SessionSummary, SessionError>> => {
      const session = await findSession(rawId);
      if (!session.ok) return session;
      const renamed = await updateFile(session.value.id, { title, titledBy: "owner" });
      return renamed.ok ? ok(summaryOf(renamed.value)) : renamed;
    },

    /** Deletes a session's folder, event log and all. Refused while a turn is running. */
    remove: async (rawId: string): Promise<Result<null, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { id, workspaceId, branch } = found.value;
      const session = runningSession(id);
      // A turn waiting for a code session to end hasn't started: it's stopped, and the session goes.
      if (options.code.slots.waits(id) && session.turn.kind === "running") {
        session.turn.stopper.abort();
        await session.ended;
      }
      const events = await readEvents(id);
      // Nothing ever ran on its session branch, so that goes too (ADR 0007).
      const neverRan =
        events.ok &&
        events.value.filter((event) => event.type === "owner-message").length === 1 &&
        events.value.some((event) => event.type === "turn-queued") &&
        !events.value.some((event) => event.type === "turn-dequeued");
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
        const workspace = await getWorkspace(options.contextDir, workspaceId);
        const repoPath = workspace.ok ? workspace.value.repoPath : null;
        if (neverRan && branch !== undefined && typeof repoPath === "string") {
          await options.code.clearBranch({
            repoPath,
            sessionBranch: { branch, worktree: options.code.worktreeOf(id) },
          });
        }
        return ok(null);
      });
    },

    /** Whether a turn is running in any of a workspace's sessions. */
    anyRunning: async (workspaceId: WorkspaceId): Promise<Result<boolean, SessionError>> => {
      const list = await sessionsOf(workspaceId);
      return list.ok ? ok(list.value.some((session) => session.busy)) : list;
    },

    /** A workspace's sessions, most recently active first, each with whether it's waiting. */
    list: sessionsOf,

    /** How many code sessions are running, across the worker. */
    codeRunning: () => options.code.slots.running(),

    /** How many sessions there are, in every workspace. */
    count: async (): Promise<Result<number, SessionError>> => {
      const folders = await listFolder(sessionsDir);
      if (!folders.ok) return err(STORAGE_ERROR);
      return ok(folders.value.filter((folder) => SessionId.safeParse(folder).success).length);
    },

    /** A session whose turn is running, in any workspace, or `undefined` when none is. */
    busy: busySession,

    /**
     * Fresh start: with no turn running and none able to start, runs `clear` (which says where the
     * sessions go), then moves the folder of every session there. Refused, naming the session,
     * while a turn is running; nothing moves when `clear` fails.
     */
    setAside: async <E>(aside: {
      clear: () => Promise<Result<{ moveTo: string }, E>>;
    }): Promise<Result<null, E | SetAsideRefusal>> => {
      if (settingAside) return err({ kind: "starting-fresh" });
      settingAside = true;
      try {
        // Anything already queued, such as the last event of a turn that just ended, is written.
        await Promise.all([...running.values()].map((session) => inOrder(session, async () => {})));
        const busy = await busySession();
        if (!busy.ok) return err({ kind: "unreadable" });
        if (busy.value !== undefined) return err({ kind: "running", session: busy.value });
        const cleared = await aside.clear();
        if (!cleared.ok) return cleared;
        // Anything asked for before now belonged to what's just been cleared.
        freshStarts += 1;
        running.clear();
        try {
          if (await exists(sessionsDir).then((there) => !there.ok || there.value)) {
            await mkdir(dirname(cleared.value.moveTo), { recursive: true });
            await move(sessionsDir, cleared.value.moveTo);
          }
        } catch {
          return err({ kind: "not-moved" });
        }
        return ok(null);
      } finally {
        settingAside = false;
      }
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
