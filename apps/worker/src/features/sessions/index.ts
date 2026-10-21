import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, truncate } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type Activity,
  type AllowAllLasts,
  type AlwaysAllow,
  type AlwaysFor,
  type ApprovalAnswer,
  type ApprovalAsk,
  type Attachment,
  type BuildIssue,
  type CarryOnRequest,
  type ChangeId,
  type CodeSessionList,
  type ContinueRequest,
  type Doing,
  defaultOf,
  type Effort,
  endsTurn,
  type FailureReason,
  type FirstMessage,
  type HelperId,
  type ModelRef,
  type NewMessage,
  type Overflow,
  overflowFrom,
  type PlacedLine,
  ProjectSlug,
  type ProviderId,
  type PullRequest,
  type PullRequestReview,
  pullRequestEnded,
  pullRequestIn,
  queuedIn,
  type RunningTasks,
  SESSION_TITLE_MAX_LENGTH,
  SessionEvent,
  SessionId,
  SessionSeen,
  type SessionSummary,
  type SkillName,
  SOURCES_MAX,
  type Source,
  type StopRequest,
  TASK_OUTPUT_MAX_CHARACTERS,
  type TaskEnding,
  TaskId,
  type TaskOutput,
  type TaskTold,
  type TurnNow,
  takesEffort,
  tasksIn,
  type WorkspaceConnections,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import {
  type AllowAll,
  allowAllAfter,
  allowAllUntil,
  allowingAllAt,
  NO_ALLOW_ALL,
} from "../../auth/allow-all/index.ts";
import { paperConnection } from "../../integrations/paper/index.ts";
import {
  exists,
  listFolder,
  move,
  readBytes,
  readJsonFile,
  readTextFile,
  writeJsonFile,
} from "../../lib/files.ts";
import type { CommandEnv } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import {
  BUILDER_CARRY_ON_MESSAGE,
  BUILDER_LIMIT_RESET_MESSAGE,
  BUILDER_RETRY_MESSAGE,
  bringUpToDateMessage,
  CONTINUE_MESSAGE,
  checksFailedMessage,
  codeRefusalReason,
  DOCUMENT_TOOL_NAME,
  documentReply,
  type FramingWorkspace,
  framingFor,
  HELPER_NO_TASKS,
  helperBranchNote,
  LEAD_TOOL_NAME,
  type LeadBrief,
  notOfferedReply,
  PREVIEW_TOOL_NAME,
  PROJECT_TOOL_NAME,
  projectReply,
  READ_SESSION_TOOL_NAME,
  readSessionReply,
  SAVE_TOOL_NAME,
  SUGGEST_REPLIES_TOOL_NAME,
  saveReply,
  skillsInUse,
  suggestRepliesReply,
  TASK_STARTED,
  TASK_TAIL,
  THING_TOOL_NAME,
  TITLING,
  TitleAnswer,
  TOO_MANY_TASKS,
  taskEndedMessage,
  thingReply,
  titleMessage,
  USE_SKILL_TOOL_NAME,
  useSkillReply,
  withTaskOutput,
} from "../../prompts/index.ts";
import {
  type CodePlugin,
  type Framing,
  firstWithRoom,
  type HeardMeter,
  type HelperCode,
  type HelperTurn,
  imageOf,
  modelsOnOffer,
  offerFor,
  type Provider,
  photosOf,
  type ToolReply,
  type TurnToolName,
} from "../../providers/index.ts";
import {
  attachmentPath,
  attachmentsOf,
  carriedAttachments,
  imagesShownIn,
  keepAttachments,
  keepImage,
  type PreparedAttachment,
} from "../attachments/index.ts";
import type { Builders, TurnEnding } from "../builders/index.ts";
import {
  allowlistFor,
  alwaysRule,
  type BranchRefusal,
  BUILD_HELD_ENV,
  type Code,
  type CodeRefusal,
  type CommandRule,
  commandAllowed,
  editPlaceIn,
  type HelperBranch,
  isBuild,
  namedAs,
  type PullRequestProblem,
  type SessionBranch,
  slotEnv,
} from "../code/index.ts";
import {
  type ContextFolder,
  type WholeFilesUndoRefusal,
  workspaceChange,
} from "../context-folder/index.ts";
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
import { savePlansFrom } from "../floor-plans/index.ts";
import type { MattSkills } from "../matt-skills/index.ts";
import { readOwnerContext } from "../owner-context/index.ts";
import { type ProjectRefusal, readProjects, undoProjectChange } from "../projects/index.ts";
import { createTurnProjects } from "../projects/tool.ts";
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
import { createTasks, type TaskRefusal } from "../tasks/index.ts";
import {
  createTurnThings,
  readThings,
  type ThingRefusal,
  type ThingUndoRefusal,
  undoThingChange,
} from "../things/index.ts";
import { type Answered, answeredAfter, sessionWaiting } from "../waiting/index.ts";
import {
  allowAlways,
  getWorkspace,
  isArchived,
  type PaperSettings,
  type Workspace,
  type WorkspaceError,
  withoutStarterHint,
} from "../workspaces/index.ts";
import { type AddedInbox, createAddedInbox } from "./added.ts";
import { createSessionNotes } from "./notes.ts";

/** A skill's name typed at the start of a message, as Claude Code takes one: `/implement 157`. */
const SLASH_SKILL = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/;

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
  /** Continue named a turn that isn't the last one, or wasn't cut off by a restart (#186). */
  | { readonly kind: "nothing-to-continue" }
  /** Retry was asked of a session that isn't a Lead's builder Stuck (#592). */
  | { readonly kind: "not-stuck" }
  /** There's no other provider to carry on with right now, and why. */
  | {
      readonly kind: "no-overflow";
      readonly overflow: Exclude<Overflow, { kind: "carry-on" }>;
    }
  /** No save in the session has that event number. */
  | { readonly kind: "save-not-found" }
  /** No message in the session carried an attachment with that id, or its file is gone. */
  | { readonly kind: "attachment-not-found" }
  /** The session has no task by that id, or none running, for Stop (#182). */
  | { readonly kind: "task-not-found" }
  /** Start preview's task didn't start (#183), and why. */
  | { readonly kind: "task-refused"; readonly refusal: TaskRefusal }
  /** The owner's Undo or Edit of a save couldn't be done. */
  | { readonly kind: "note-refused"; readonly act: NoteAct; readonly refusal: NoteRefusal }
  /** No finished answer to save as a document has that message's number. */
  | { readonly kind: "answer-not-found" }
  /** Saving an answer as a document, or undoing a document save, couldn't be done. */
  | { readonly kind: "document-refused"; readonly refusal: DocumentRefusal | DocumentUndoRefusal }
  /** Undoing a Thing save couldn't be done. */
  | { readonly kind: "thing-refused"; readonly refusal: ThingRefusal | ThingUndoRefusal }
  /** Starting a session from a project, or undoing a project save, couldn't be done (#603). */
  | {
      readonly kind: "project-refused";
      readonly refusal: ProjectRefusal | WholeFilesUndoRefusal;
    }
  /** The model's provider can't code, so it can't work in a code workspace (ADR 0007). */
  | { readonly kind: "cannot-code"; readonly provider: string }
  /** A code session couldn't start its session branch (ADR 0007), and why. */
  | { readonly kind: "branch-refused"; readonly refusal: BranchRefusal }
  /** No approval in the session has that event number (#171). */
  | { readonly kind: "approval-not-found" }
  /** The approval's turn has ended (stopped, or the worker restarted), so nothing waits on it. */
  | { readonly kind: "approval-closed" }
  /** Allow always was asked for an approval that didn't offer it (#185). */
  | { readonly kind: "always-not-offered" }
  /** The workspace couldn't keep a command allowed always (#185). */
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** Allow all for this task was asked for a session that doesn't code (#428). */
  | { readonly kind: "not-code-session" }
  /** Allow all for this task was asked for while it's on: it isn't extended (#428). */
  | { readonly kind: "allowing-all" }
  /** No message waiting in the session's queue has that event number (#177). */
  | { readonly kind: "queued-not-found" }
  /** The queued message has gone already, as a turn of its own. */
  | { readonly kind: "queued-sent" }
  /** The session's pull request was merged or closed, so it takes no more messages (#172). */
  | { readonly kind: "pull-request-ended"; readonly state: "merged" | "closed" }
  /** The session has no pull request to review yet, or isn't a code session (#160). */
  | { readonly kind: "no-pull-request" }
  /** Merge or Close can't act on the pull request now, in the owner's words (#160). */
  | { readonly kind: "pull-request-refused"; readonly reason: string }
  /** GitHub couldn't be asked, or wouldn't do it (#160). */
  | { readonly kind: "github"; readonly problem: PullRequestProblem }
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
  /** Its branch was in the repository before it (#326), so clearing it away leaves the branch. */
  keepsBranch: z.literal(true).optional(),
  /**
   * A code session that takes no place among those running, nor a port slot: a grill from Next up
   * (#363), which builds nothing.
   */
  placeless: z.literal(true).optional(),
  /** Its code workspace's Lead (#347), which runs the build order; placeless too. */
  lead: z.literal(true).optional(),
  /** Started by its workspace's Lead to build an issue (#347). */
  byLead: z.literal(true).optional(),
  /**
   * The issue a code session was started on, claimed for it on GitHub (#324), and whether the
   * claim stands: it's released when the session stops before a pull request.
   */
  claim: z.object({ issue: z.number().int().positive(), standing: z.boolean() }).optional(),
  /**
   * The planning workspace's project it belongs to (#603): started from it, or attached by its
   * model as clearly about it.
   */
  project: ProjectSlug.optional(),
});
type SessionFile = z.infer<typeof SessionFile>;

/**
 * The claim a code session releases if it stops now (#324): one that stands, while it has no pull
 * request.
 */
const claimToRelease = (file: SessionFile, events: readonly SessionEvent[]) =>
  file.branch !== undefined && file.claim?.standing === true && pullRequestIn(events) === undefined
    ? { issue: file.claim.issue, branch: file.branch }
    : undefined;

/** An event before it's numbered and timed. */
type WithoutNumbering<E> = E extends unknown ? Omit<E, "seq" | "at"> : never;
type NewEvent = WithoutNumbering<SessionEvent>;

/** Whether a pull request is as it was last recorded, so nothing about it changed. */
const samePullRequest = (now: PullRequest, was: PullRequest | undefined) =>
  was !== undefined &&
  now.number === was.number &&
  now.title === was.title &&
  now.url === was.url &&
  now.state === was.state &&
  now.head === was.head &&
  // One recorded before conflicts were (#278) didn't conflict.
  (now.conflicts ?? false) === (was.conflicts ?? false) &&
  JSON.stringify(now.changes) === JSON.stringify(was.changes) &&
  JSON.stringify(now.checks) === JSON.stringify(was.checks);

/**
 * Whether an open pull request's checks failed again on a commit its session already had a fixing
 * turn for, having run again since (a re-run, #356): no second fixing turn starts for it.
 */
const failedAgain = (seen: {
  events: readonly SessionEvent[];
  was: PullRequest | undefined;
  now: PullRequest;
}) => {
  const { was, now } = seen;
  return (
    now.state === "open" &&
    now.checks.kind === "failed" &&
    was?.head === now.head &&
    was.checks.kind !== "failed" &&
    seen.events.some(
      (event) => event.type === "owner-message" && event.checksFailed?.head === now.head,
    )
  );
};

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
 * The owner's message numbered `turn`, when it's the session's last and a restart cut its turn off
 * (#186): the only turn Continue can take on. `undefined` otherwise.
 */
const cutOffTurn = (events: readonly SessionEvent[], turn: number) => {
  const message = events.findLast((event) => event.type === "owner-message");
  const ending = events.findLast(endsTurn);
  return message?.type === "owner-message" &&
    message.seq === turn &&
    ending?.type === "turn-failed" &&
    ending.seq > message.seq &&
    ending.reason.kind === "interrupted"
    ? message
    : undefined;
};

/**
 * Whose turn it is in a session whose turn is running (#179), from its events: the owner's while
 * the turn waits on an approval they haven't answered; otherwise the model's, since the turn's
 * message, doing what its latest activity or text says, or waiting for a place among the code
 * sessions running (#362).
 */
const turnNowIn = (events: readonly SessionEvent[]): TurnNow => {
  const start = events.findLastIndex((event) => event.type === "owner-message");
  const turn = events.slice(Math.max(start, 0));
  const answered = new Set(
    turn.flatMap((event) => (event.type === "approval-answered" ? [event.approval] : [])),
  );
  const waiting = turn.findLast(
    (event) => event.type === "approval-requested" && !answered.has(event.seq),
  );
  if (waiting?.type === "approval-requested") {
    return { kind: "needs-you", since: waiting.at, ask: waiting.ask, approval: waiting.seq };
  }
  const latest = turn.findLast(
    (event) =>
      event.type === "activity" ||
      event.type === "text-delta" ||
      event.type === "turn-queued" ||
      event.type === "turn-dequeued",
  );
  const doing = (): Doing => {
    switch (latest?.type) {
      case "activity":
        return { kind: "activity", activity: latest.activity };
      case "text-delta":
        return { kind: "writing" };
      case "turn-queued":
        return latest.ahead === undefined
          ? { kind: "waiting-for-place" }
          : { kind: "waiting-for-place", ahead: latest.ahead };
      default:
        return { kind: "thinking" };
    }
  };
  return { kind: "working", since: turn[0]?.at ?? new Date(0).toISOString(), doing: doing() };
};

/**
 * The most helpers a code turn runs at once (#117): one more waits for a place, and starts once
 * one of them finishes.
 */
const HELPERS_AT_ONCE = 3;

/**
 * The allowlisted commands a helper on a branch of its own runs only with the owner's OK (#395):
 * pushing and its pull request, since its work reaches the session branch by being merged back.
 */
const OWN_BRANCH_ASKS = ["git push", "gh pr create", "gh pr edit"];

/**
 * Where a session's current turn stands in this worker. A stop handle exists from the moment the
 * turn starts, and only while it can still be stopped: once the provider has finished, the turn
 * is ending and how it ended is already decided.
 */
/** What an approval the owner denied was, as its model is told. */
const deniedWhat = (ask: ApprovalAsk) => {
  if (ask.kind === "command" || ask.kind === "tool") return ask.kind;
  return "edit";
};

type TurnState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "running";
      readonly stopper: AbortController;
      /** The owner message's event number, once recorded: what a stop request must name. */
      turn: number | undefined;
      /** The model it answers with, which a message added to it must name (#252). */
      readonly model: ModelRef;
      /** What the owner adds while it runs, when its provider steers (#252). */
      readonly added: AddedInbox | undefined;
    }
  | { readonly kind: "ending" }
  /** Its folder is being deleted, so nothing new can start in it. */
  | { readonly kind: "deleting" };

/**
 * The owner's answer to an approval (#171), and whether they allowed it always (#185), or allowed
 * it by turning on Allow all for this task while it waited (#428).
 */
type GivenAnswer = {
  readonly answer: ApprovalAnswer;
  readonly always?: AlwaysFor;
  readonly allowedAll?: true;
};

/**
 * What a session's owner allowed always for the session (#185), from its events: each approval's
 * offer they answered Allow always, This session, to. It ends with the session.
 */
const allowedForSession = (events: readonly SessionEvent[]): AlwaysAllow[] => {
  const offered = new Map<number, AlwaysAllow>();
  const allowed: AlwaysAllow[] = [];
  for (const event of events) {
    if (event.type === "approval-requested" && event.always !== undefined) {
      offered.set(event.seq, event.always);
    }
    if (event.type === "approval-answered" && event.always === "session") {
      const always = offered.get(event.approval);
      if (always !== undefined) allowed.push(always);
    }
  }
  return allowed;
};

type RunningSession = {
  turn: TurnState;
  /** The next event's number, once known. */
  nextSeq: number | undefined;
  listeners: Set<(event: SessionEvent) => void>;
  /** Appends and subscriptions run one at a time, so events are gapless and none is missed. */
  queue: Promise<unknown>;
  /** The approvals its turn is waiting on (#171), by event number: each takes the owner's answer. */
  approvals: Map<number, (given: GivenAnswer) => void>;
  /**
   * Whether its log has had a message queued (#177), so the end of a turn looks for one to send;
   * a session that never has costs a turn's end nothing.
   */
  queues: boolean;
  /** Resolves once the turn last started here has ended, its end recorded. */
  ended: Promise<void>;
  /**
   * The Paper nodes its turns made (ADR 0023), which they may delete without asking. Kept while
   * the worker runs: after a restart, deleting any of them asks.
   */
  paperMade: Set<string>;
  /** Its latest answer (#334), from its event log once recovered, then as each is written. */
  answered: Answered;
  /** The event number the owner has seen it up to, on any device (#334), once read from its folder. */
  seen: number | undefined;
  /** Its recovery found a turn a restart cut off, and recorded it (#186). */
  cutOffByRestart: boolean;
  /** Its Allow all for this task (#428), from its event log once recovered, then as each is written. */
  allowAll: AllowAll;
  /**
   * It's one of a Lead's builders (#590), whose status `builders/` keeps: read from its file the
   * first time an event is written once the file is there.
   */
  builder: boolean | undefined;
};

/**
 * Given work nobody waits for once it has started (a turn, titling a session, notifying the
 * owner), which settles without throwing. The worker lets it run; tests keep hold of it, to wait
 * for it before removing the folders it writes into.
 */
export type Background = (work: Promise<void>) => void;

/**
 * What a code workspace's Lead's turns need from the Lead (#347): the build order as the worker
 * has it, for its framing, and the answer to a call of its build order tool.
 */
export type LeadHooks = {
  readonly brief: (session: SessionId) => Promise<LeadBrief | undefined>;
  readonly tool: (session: SessionId, input: unknown) => Promise<ToolReply>;
};

/**
 * A code session's claim on the issue it was started on (#324), posted on GitHub by Next up, which
 * knows the repository's issues. A refusal is only logged: the session builds it anyway.
 */
export type ClaimHooks = {
  /** The issue a first message names, when it names one alone, ready and claimed by nobody. */
  readonly named: (workspaceId: WorkspaceId, text: string) => Promise<number | undefined>;
  /** Claims the issue, naming the session's branch and why (AGENTS.md, claim rule). */
  readonly claim: (
    workspaceId: WorkspaceId,
    issue: number,
    claim: { branch: string; why: string },
  ) => Promise<void>;
  /** Releases the claim: "Stopped: <why>". */
  readonly release: (workspaceId: WorkspaceId, issue: number, why: string) => Promise<void>;
};

/**
 * What code sessions' turns and tasks need from their previews (#183): word that a task has
 * ended, so its preview closes, and the answer to a call of the screenshot tool.
 */
export type PreviewHooks = {
  readonly ended: (session: SessionId, task: TaskId) => void;
  readonly tool: (session: SessionId, input: unknown) => Promise<ToolReply>;
};

/** What a preview screenshot shows (#183): its page and size, by which the chat keeps the newest of each. */
const PreviewShot = z.object({ path: z.string(), size: z.string() });

/** How much of the start of a task's output is read for where it serves (#183). */
const TASK_OPENING_BYTES = 64 * 1024;

/** A code session's tasks still running, for its preview (#183), and where Start preview runs. */
export type PreviewTasks = {
  readonly id: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly worktree: string;
  readonly tasks: readonly {
    readonly task: TaskId;
    /** The owner started it with Start preview. */
    readonly preview: boolean;
    /** The start of its output. */
    readonly opening: string;
  }[];
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
  /** Matt Pocock's skills, which code workspaces get (ADR 0024); none when they're off. */
  matt: MattSkills | undefined;
  /** Code sessions' branches and worktrees (ADR 0007). */
  code: Code;
  /** A code workspace's connections (#308), which each of its turns is told. */
  connectionsOf: (workspace: Workspace) => Promise<WorkspaceConnections>;
  now: () => number;
  /** Resolves once `ms` have passed: how long a turn waits for its workspace's notes is timed by it (#601). */
  wait: (ms: number) => Promise<void>;
  /**
   * Told of an approval asked for, of each turn's end, and of a pull request's checks failing again
   * after a re-run (#356), once recorded, with a code session's pull request as it is then, for the
   * owner's notifications (#173).
   */
  notify?: (session: SessionId, event: SessionEvent, pullRequest: PullRequest | undefined) => void;
  /** Given the titling of a session, which nobody waits for. */
  background: Background;
  /** A code workspace's Lead (#347): the build order its turns are told, and its tool's answers. */
  lead?: LeadHooks;
  /** The claim on the issue a code session was started on (#324). */
  claims?: ClaimHooks;
  /** Code sessions' previews (#183): each closes as its task ends, and takes the model's screenshots. */
  previews?: PreviewHooks;
  /** Each Lead builder's status (#590), told what happens in its session as it happens. */
  builders?: Builders;
  /**
   * Usage at a glance (#66): told what a turn's provider heard of its plan windows as the turn
   * ran, and when each turn has ended, so its provider's usage is read again.
   */
  usage?: {
    readonly heard: (session: SessionId, provider: ProviderId, meter: HeardMeter) => void;
    readonly turnEnded: (provider: ProviderId) => void;
  };
}) => {
  const sessionsDir = join(options.dataDir, "sessions");
  const running = new Map<SessionId, RunningSession>();
  /** Code sessions' tasks (#182), which outlive the turns that start them. */
  const tasks = createTasks();
  /** The tasks the owner started with Start preview (#183), while they run. */
  const previewsStarted = new Set<TaskId>();
  /**
   * Each code session's pull request as last recorded (`null` for none yet), once read from its
   * events or written there, so listing a workspace's sessions doesn't read every event log.
   */
  const pullRequests = new Map<SessionId, PullRequest | null>();
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
      approvals: new Map(),
      queues: false,
      ended: Promise.resolve(),
      paperMade: new Set(),
      answered: { answer: undefined, reporting: false, cutOff: false },
      seen: undefined,
      cutOffByRestart: false,
      allowAll: NO_ALLOW_ALL,
      builder: undefined,
    };
    running.set(id, created);
    // The first step in the queue of every session this worker touches, before anything else.
    void inOrder(created, () => recover(id, created)).then(
      // A queued message a stopped worker left waiting goes now (#177).
      () => sendNextQueued(id),
    );
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
  const seenPath = (id: SessionId) => join(folderOf(id), "seen.json");

  /** Every session's own file, in every workspace. */
  const allSessionFiles = async (): Promise<Result<SessionFile[], SessionError>> => {
    const folders = await listFolder(sessionsDir);
    if (!folders.ok) return err(STORAGE_ERROR);
    const files: SessionFile[] = [];
    for (const folder of folders.value) {
      const id = SessionId.safeParse(folder);
      if (!id.success) continue;
      const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
      if (!file.ok) return err(STORAGE_ERROR);
      if (file.value !== undefined) files.push(file.value);
    }
    return ok(files);
  };

  /** The note each planning session leaves for the next ones in its workspace (#601). */
  const notes = createSessionNotes({
    providers: options.providers,
    contextDir: options.contextDir,
    now: options.now,
    folderOf,
    sessions: allSessionFiles,
    events: (id) => readEvents(id),
    busy: (id) => (running.get(id)?.turn.kind ?? "idle") !== "idle",
    background: options.background,
    wait: options.wait,
  });

  /** The event number the owner has seen a session up to (#334), read from its folder once. */
  const seenOf = async (
    id: SessionId,
    session: RunningSession,
  ): Promise<Result<number, SessionError>> => {
    if (session.seen !== undefined) return ok(session.seen);
    const kept = await readJsonFile(seenPath(id), SessionSeen);
    if (!kept.ok) return err(STORAGE_ERROR);
    session.seen = kept.value?.upTo ?? 0;
    return ok(session.seen);
  };

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
    if (numbered.data.type === "pull-request") pullRequests.set(id, numbered.data.pullRequest);
    session.answered = answeredAfter(session.answered, numbered.data);
    session.allowAll = allowAllAfter(session.allowAll, numbered.data);
    if (session.builder === undefined) {
      const file = await readJsonFile(sessionFilePath(id), SessionFile);
      if (file.ok && file.value !== undefined) session.builder = file.value.byLead === true;
    }
    if (session.builder === true) await builderHeardOf(id, numbered.data);
    for (const listener of session.listeners) listener(numbered.data);
    return ok(numbered.data);
  };

  /**
   * Tells `builders/` what a Lead builder's event says has happened (#590): a turn starting, an
   * approval asked or answered, its pull request heard of, a turn a restart cut off. A turn's own
   * end is told once its pull request has been looked at (`builderTurnEnded`), and its checks as
   * they wait, start and end.
   */
  const builderHeardOf = async (id: SessionId, event: SessionEvent) => {
    const { builders } = options;
    if (builders === undefined) return;
    if (event.type === "owner-message") await builders.heard(id, { kind: "turn-started" });
    if (event.type === "approval-requested") {
      await builders.heard(id, { kind: "approval-asked", approval: event.seq });
    }
    if (event.type === "approval-answered") {
      await builders.heard(id, { kind: "approval-answered", approval: event.approval });
    }
    if (event.type === "pull-request") {
      await builders.heard(id, { kind: "pull-request", pullRequest: event.pullRequest });
    }
    if (event.type === "turn-failed" && event.reason.kind === "interrupted") {
      await builders.heard(id, {
        kind: "turn-ended",
        ending: { kind: "failed", reason: event.reason },
        asked: false,
      });
    }
  };

  const append = (id: SessionId, event: NewEvent) => {
    const session = runningSession(id);
    return inOrder(session, () => writeEvent({ id, session, event }));
  };

  /**
   * Puts right what a stopped worker left behind, the first time this worker touches a session.
   * A crash mid-write leaves a last line with no newline: it's cut off. A turn the log shows as
   * still open belonged to the stopped worker (this one hasn't started any), so it's recorded as
   * interrupted (cut off, #186) and the session is usable again.
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
    session.queues = events.value.some((event) => event.type === "message-queued");
    // The tasks a stopped worker left running stopped with it (#182): the model reads so next turn.
    for (const left of tasksIn(events.value)) {
      if (left.ended !== undefined) continue;
      const ended = await writeEvent({
        id,
        session,
        event: { type: "task-ended", task: left.task, ending: { kind: "stopped", by: "restart" } },
      });
      if (!ended.ok) console.error(`Session ${id}: a task a restart stopped couldn't be recorded`);
    }
    for (const event of events.value) {
      session.answered = answeredAfter(session.answered, event);
      session.allowAll = allowAllAfter(session.allowAll, event);
    }
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
    if (!ended.ok) {
      console.error(`Session ${id}: an interrupted turn couldn't be recorded`);
      return;
    }
    session.cutOffByRestart = true;
    // It waits on the owner now (#186), so it's listed as just active. Written here, in the
    // session's queue already, rather than through `updateFile`, which queues behind it.
    const file = await readJsonFile(sessionFilePath(id), SessionFile);
    if (file.ok && file.value !== undefined) {
      await writeJsonFile(sessionFilePath(id), { ...file.value, updatedAt: ended.value.at });
    }
  };

  /**
   * Changes a session's own file. Runs in the session's queue, so two changes (a turn ending and
   * the owner renaming it, say) can't each read the file before the other writes it.
   */
  const updateFile = (
    id: SessionId,
    change: Partial<Pick<SessionFile, "title" | "titledBy" | "updatedAt" | "claim" | "project">>,
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

  /**
   * Releases a code session's claim on its issue (#324), saying why on GitHub, unless it has a
   * pull request, which links the issue itself, or the claim was released already.
   */
  const releaseClaim = async (id: SessionId, why: (branch: string) => string) => {
    const [file, events] = await Promise.all([
      readJsonFile(sessionFilePath(id), SessionFile),
      readEvents(id),
    ]);
    if (!file.ok || !file.value || !events.ok) return;
    const claim = claimToRelease(file.value, events.value);
    if (claim === undefined) return;
    await updateFile(id, { claim: { issue: claim.issue, standing: false } });
    await options.claims?.release(file.value.workspaceId, claim.issue, why(claim.branch));
  };

  /** Claims a code session's issue again as it carries on, once its claim was released (#324). */
  const claimAgain = async (id: SessionId) => {
    const file = await readJsonFile(sessionFilePath(id), SessionFile);
    const session = file.ok ? file.value : undefined;
    const claim = session?.claim;
    if (session?.branch === undefined || claim === undefined || claim.standing) return;
    await updateFile(id, { claim: { ...claim, standing: true } });
    await options.claims?.claim(session.workspaceId, claim.issue, {
      branch: session.branch,
      why: "the owner asked",
    });
  };

  /** A workspace's skills (ADR 0016), as its folder, mode and repo give them. */
  const skillsOf = (workspace: SkillsWorkspace) =>
    workspaceSkills({
      contextDir: options.contextDir,
      houseFolder: options.houseSkills,
      workspace,
      matt: options.matt,
    });

  /**
   * Matt's skills for a code turn (ADR 0024): the pinned copy, with the skills of it the workspace
   * can use; `null` when they aren't loaded.
   */
  const mattPlugin = async (skills: WorkspaceSkills): Promise<CodePlugin | null> => {
    const copy = await options.matt?.copy();
    if (copy === undefined || !copy.ok) return null;
    return {
      folder: copy.value.folder,
      name: copy.value.plugin,
      skills: skills.usable.flatMap((skill) => (skill.source === "matt" ? [skill.name] : [])),
    };
  };

  /**
   * What a turn in the session needs from its workspace: its name, mode and folder, its context
   * file as written, the owner context, its skills, and in a planning workspace its documents,
   * Things and the notes its other sessions left (#601).
   */
  const turnWorkspaceOf = async (
    workspaceId: WorkspaceId,
    session: SessionId,
  ): Promise<
    Result<
      FramingWorkspace & {
        folder: string;
        skills: WorkspaceSkills;
        /** Its command allowlist, for a code session's commands. */
        allowlist: readonly CommandRule[];
        /** A code workspace's Paper connection (ADR 0023), or null when it has none. */
        paper: PaperSettings | null;
      },
      string
    >
  > => {
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
    const projects =
      summary.mode === "planning"
        ? await readProjects({ contextDir: options.contextDir, workspaceId })
        : ok({ projects: [], problems: [] });
    if (!projects.ok) return err("This session's workspace's projects can't be read.");
    const sessionNotes =
      summary.mode === "planning" ? await notes.forTurn(workspaceId, session) : [];
    return ok({
      name: summary.name,
      mode: summary.mode,
      folder,
      contextFile: contextMarkdown === null ? null : withoutStarterHint(contextMarkdown),
      ownerContext: ownerContext.value,
      documents: documents.value,
      things: things.value,
      projects: projects.value,
      notes: sessionNotes,
      skills: await skillsOf(workspace.value),
      allowlist: allowlistFor(workspace.value.allowlist),
      paper: workspace.value.paper,
      ...(workspace.value.paper === null ? {} : { paperFile: workspace.value.paper.fileId }),
      ...(summary.mode === "code"
        ? { connections: await options.connectionsOf(workspace.value) }
        : {}),
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
    /** What the owner adds while it runs, when its provider steers (#252). */
    added: AddedInbox | undefined;
    workspaceId: WorkspaceId;
    provider: Provider;
    model: ModelRef["model"];
    effort: Effort | undefined;
    /** Whether it's in a code session, so it runs only once it has a slot among them. */
    coding: boolean;
    /** It's in a code session that takes no slot (a grill, #363), so it runs at once. */
    placeless: boolean;
    /** Whether it answers the session's first message, so the session is titled once it completes. */
    firstTurn: boolean;
  }) => {
    const session = runningSession(turn.id);
    const stopper = turn.stopper;
    const stoppedByOwner = new Promise<"stopped">((resolve) => {
      stopper.signal.addEventListener("abort", () => resolve("stopped"), { once: true });
    });
    let failure: FailureReason | undefined;
    /** It's in a code workspace's Lead (#347). */
    let lead = false;
    /**
     * It's in the Lead or one of its builders (#347), whose finished turns send no notification:
     * the owner hears only of what's ready to merge and what needs their decision.
     */
    let quiet = false;
    /** It's one of the Lead's builders, which checks only what it changed (#589). */
    let builder = false;
    /** Set when part of the turn couldn't be recorded, so it can't count as complete. */
    let recordingLost = false;
    /** Tool calls still under way (a save being written, say), which finish before the turn ends. */
    const callsUnderway = new Set<Promise<unknown>>();
    /** Records that the turn waits for a slot, with how many turns wait ahead of it (#362). */
    const waits = async (ahead: number) => {
      if (!(await append(turn.id, { type: "turn-queued", ahead })).ok) recordingLost = true;
    };
    const taken =
      turn.coding && !turn.placeless
        ? options.code.slots.take({
            id: turn.id,
            signal: stopper.signal,
            moved: (ahead) => void waits(ahead),
          })
        : undefined;
    // Every device sees the turn wait, move up, and start (ADR 0006).
    if (taken?.queued) await waits(taken.ahead);
    const slot = await taken?.slot;
    if (taken?.queued && slot !== undefined) {
      if (!(await append(turn.id, { type: "turn-dequeued" })).ok) recordingLost = true;
    }
    try {
      const [events, workspace, file] = await Promise.all([
        readEvents(turn.id),
        turnWorkspaceOf(turn.workspaceId, turn.id),
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
        lead = file.value?.lead === true;
        builder = file.value?.byLead === true;
        quiet = lead || builder;
        const brief = lead ? await options.lead?.brief(turn.id) : undefined;
        const framing = await withTasksOutput(
          turn.id,
          events.value,
          framingFor({
            ...(brief === undefined ? {} : { lead: brief }),
            builder,
            // The project it belongs to (#603), whose file the turn is given whole.
            workspace: { ...workspace.value, project: file.value?.project },
            capabilities: turn.provider.capabilities,
            events: events.value,
            skills: {
              // Matt's skills load through the provider's own skill loading (ADR 0024).
              offered: skills.usable.filter((skill) => !skill.ownerOnly && skill.source !== "matt"),
              inUse: await inUseTexts(skills.usable, inUse),
            },
            attachments: await carriedAttachments(folderOf(turn.id), events.value),
            now: options.now(),
          }),
        );
        const turnDocuments = createTurnDocuments(targetOf(turn));
        /** Records what the model is doing, or one of its helpers (#117), tagged with it. */
        const reportAs =
          (helper: HelperId | undefined) => async (activity: Activity, allowedAll?: boolean) => {
            if (recordingLost || stopper.signal.aborted) return;
            // A document read is what the model has seen of it, before anyone hears of the read.
            if (activity.kind === "read-file") await turnDocuments.read(activity.path);
            const recorded = await append(turn.id, {
              type: "activity",
              activity,
              ...(helper === undefined ? {} : { helper }),
              ...(allowedAll === true ? { allowedAll } : {}),
            });
            if (!recorded.ok) recordingLost = true;
          };
        const report = reportAs(undefined);
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
        const turnProjects = createTurnProjects({
          ...targetOf(turn),
          shown: workspace.value.projects.projects,
          now: options.now(),
          // The session belongs to it from now on (#603).
          attach: async (project) => (await updateFile(turn.id, { project })).ok,
        });
        /** Whether the last project save was refused, so this one is its retry. */
        let retryingProject = false;
        const saveProjectTool = async (input: unknown): Promise<ToolReply> => {
          if (stopper.signal.aborted || recordingLost) {
            return projectReply(err({ kind: "stopped" }), true);
          }
          const done = await turnProjects(input);
          if (done.ok && done.value.kind === "saved") {
            const { save, change } = done.value.saved;
            const recorded = await append(turn.id, {
              type: "project-saved",
              save,
              ...(change === undefined ? {} : { change }),
            });
            if (!recorded.ok) recordingLost = true;
          }
          const reply = projectReply(done, retryingProject);
          retryingProject = !done.ok && !retryingProject;
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
          [PROJECT_TOOL_NAME]: saveProjectTool,
          [READ_SESSION_TOOL_NAME]: async (input) =>
            readSessionReply(
              await notes.read({ workspaceId: turn.workspaceId, session: turn.id, input }),
            ),
          [USE_SKILL_TOOL_NAME]: async (input) => useSkillReply(await useSkill(input)),
          [SUGGEST_REPLIES_TOOL_NAME]: async (input) =>
            suggestRepliesReply(await replies.suggest(input)),
          [LEAD_TOOL_NAME]: async (input) =>
            (await options.lead?.tool(turn.id, input)) ?? notOfferedReply(LEAD_TOOL_NAME),
          // Each screenshot shows in the chat too (#183), as Paper's do.
          [PREVIEW_TOOL_NAME]: async (input) => {
            const reply =
              (await options.previews?.tool(turn.id, input)) ?? notOfferedReply(PREVIEW_TOOL_NAME);
            const asked = PreviewShot.safeParse(input);
            for (const part of reply.content) {
              const image = part.kind === "image" ? imageOf(part.dataUrl) : undefined;
              if (image === undefined || !asked.success) continue;
              await show({
                connection: "Preview",
                of: `${asked.data.path} · ${asked.data.size}`,
                ...image,
              });
            }
            return reply;
          },
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
        /**
         * Says whether something may happen in a code session, telling the owner when it does, as
         * the model's or as `helper`'s (#117). A heavy check waits its turn in the builds queue
         * first (#281), saying how many builds are ahead of it, and a stop ends the wait.
         */
        const decide = async (
          decided: Result<Activity, CodeRefusal>,
          by: {
            readonly helper: HelperId | undefined;
            /** It's allowed because the session is allowing all (#428), so it's marked so. */
            readonly allowedAll?: boolean | undefined;
            /**
             * It's a command to run as a task (#182): its start is recorded as the task's, not as
             * an activity, and a heavy check takes its place in the builds queue as any does,
             * keeping it until the task ends (#589).
             */
            readonly asTask?: boolean | undefined;
          },
        ): Promise<Result<null, string>> => {
          const { helper, allowedAll } = by;
          if (stopper.signal.aborted || recordingLost) {
            return err(codeRefusalReason({ kind: "stopped" }));
          }
          if (!decided.ok) return err(codeRefusalReason(decided.error));
          const activity = decided.value;
          const told = reportAs(helper);
          if (activity.kind === "ran-command" && isBuild(activity.command)) {
            const { command } = activity;
            const started = await options.code.builds.start({
              id: turn.id,
              command,
              signal: stopper.signal,
              ahead: (ahead) => {
                void told({ kind: "waiting-for-build", ahead });
                if (builder)
                  void options.builders?.heard(turn.id, { kind: "check-waiting", command, ahead });
              },
              task: by.asTask === true,
            });
            if (!started) return err(codeRefusalReason({ kind: "stopped" }));
            if (builder) await options.builders?.heard(turn.id, { kind: "check-started", command });
          }
          if (by.asTask === true) return ok(null);
          await told(activity, allowedAll);
          return ok(null);
        };
        /** Whether the session is allowing all now (#428): read at each step, so it can change mid-turn. */
        const allowingAll = () => allowingAllAt(session.allowAll, options.now()) !== undefined;
        /**
         * The commands allowed always (#185) beyond the workspace's allowlist as the turn read it:
         * those allowed for the session in its earlier turns, then each allowed always while the
         * turn runs, for the session or the workspace, which its next turn reads.
         */
        const allowedAlways: CommandRule[] = allowedForSession(events.value).map(alwaysRule);
        /**
         * Asks the owner's approval (#171) and waits for it, with no time limit: Allow decides it
         * as `allowed`, Deny refuses it, and a stop ends the wait. A helper's names it (#117).
         */
        const approval = async (asking: {
          ask: ApprovalAsk;
          why: string | undefined;
          allowed: Activity;
          helper: HelperId | undefined;
          /** What Allow always would allow (#185), when it's offered. */
          always?: AlwaysAllow | undefined;
          /** Allow all for this task would cover it (#428), so the card offers turning it on. */
          all?: true | undefined;
          /** It's a command to run as a task (#182). */
          asTask?: boolean | undefined;
        }): Promise<Result<null, string>> => {
          if (stopper.signal.aborted || recordingLost) {
            return err(codeRefusalReason({ kind: "stopped" }));
          }
          let answered: (given: GivenAnswer | "stopped") => void = () => {};
          const answer = new Promise<GivenAnswer | "stopped">((resolve) => {
            answered = resolve;
          });
          const onStop = () => answered("stopped");
          stopper.signal.addEventListener("abort", onStop, { once: true });
          // Waited on from the moment it's recorded, so an answer can't arrive before the wait.
          const asked = await inOrder(session, async () => {
            const recorded = await writeEvent({
              id: turn.id,
              session,
              event: {
                type: "approval-requested",
                ask: asking.ask,
                ...(asking.why === undefined ? {} : { why: asking.why }),
                ...(asking.helper === undefined ? {} : { helper: asking.helper }),
                ...(asking.always === undefined ? {} : { always: asking.always }),
                ...(asking.all === undefined ? {} : { all: asking.all }),
              },
            });
            if (recorded.ok) {
              session.approvals.set(recorded.value.seq, answered);
              options.notify?.(turn.id, recorded.value, undefined);
            }
            return recorded;
          });
          if (!asked.ok) {
            recordingLost = true;
            answered("stopped");
          }
          const given = await answer;
          stopper.signal.removeEventListener("abort", onStop);
          if (asked.ok) session.approvals.delete(asked.value.seq);
          if (given === "stopped") return err(codeRefusalReason({ kind: "stopped" }));
          // Allowed always, it runs without asking for the rest of the turn too, whichever it's for.
          if (given.always !== undefined && asking.always !== undefined) {
            allowedAlways.push(alwaysRule(asking.always));
          }
          return decide(
            given.answer === "allow"
              ? ok(asking.allowed)
              : err({ kind: "denied", what: deniedWhat(asking.ask) }),
            { helper: asking.helper, allowedAll: given.allowedAll, asTask: asking.asTask },
          );
        };
        /**
         * Shows the owner an image a tool connection gave the model (ADR 0023): kept in the
         * session's folder, then recorded. One that isn't an image Courtyard shows is left out.
         */
        const show = async (shown: {
          connection: string;
          of: string;
          mediaType: string;
          bytes: Uint8Array;
        }) => {
          if (stopper.signal.aborted || recordingLost) return;
          const kept = await keepImage(folderOf(turn.id), {
            name: `${shown.connection} screenshot`,
            mediaType: shown.mediaType,
            bytes: shown.bytes,
          });
          if (!kept.ok) return;
          const recorded = await append(turn.id, {
            type: "image-shown",
            connection: shown.connection,
            of: shown.of,
            image: kept.value,
          });
          if (!recorded.ok) recordingLost = true;
        };
        /**
         * The tool connections the turn offers, a code workspace's Paper (ADR 0023): the model's,
         * or a helper's (#117), whose approvals and reports name it.
         */
        const connectionsFor = (helper: HelperId | undefined) =>
          turn.provider.capabilities.usesTools && worktree !== undefined && workspace.value.paper
            ? [
                paperConnection({
                  settings: workspace.value.paper,
                  made: session.paperMade,
                  approve: (ask, allowed) => approval({ ask, why: undefined, allowed, helper }),
                  report: reportAs(helper),
                  show: (image) => show({ connection: "Paper", ...image }),
                }),
              ]
            : [];
        const connections = connectionsFor(undefined);
        /**
         * A code session's say on each edit and command the model asks for, or one of its helpers
         * (#117), decided the same way (ADR 0007). A helper on a branch of its own (#395, `own`)
         * works in its own worktree, outside the session's slot so its folder picks its test
         * ports, and pushes and opens a pull request only with the owner's OK: its work reaches
         * the session branch by being merged back.
         */
        const codeTurn = (code: {
          worktree: string;
          branch: string;
          env: CommandEnv;
          plugin: CodePlugin | null;
          helper: HelperId | undefined;
          own?: true;
        }): HelperCode => {
          const { worktree, branch, helper, own } = code;
          /** Its slot and Courtyard's GitHub sign-in for its git and gh (#99). */
          const env = {
            ...code.env,
            ...(slot === undefined || own ? {} : slotEnv({ slot, worktree })),
          };
          /**
           * Whether a command may run, as `run` and `task` ask (#182), the owner asked when it
           * needs their approval; once allowed, a command not run as a task is recorded as run.
           */
          const command = async (
            asked: string,
            why: string | undefined,
            asTask: boolean,
          ): Promise<Result<null, string>> => {
            const allowed = await commandAllowed(
              {
                worktree,
                branch,
                pullRequest: pullRequestIn(events.value)?.number,
                // The Lead files an issue only with the owner's OK (#347), and a helper on its
                // own branch pushes and opens a pull request only with it (#395).
                allowlist: [...workspace.value.allowlist, ...allowedAlways].filter((rule) => {
                  const words = rule.words.join(" ");
                  if (lead && words === "gh issue create") return false;
                  return own !== true || !OWN_BRANCH_ASKS.includes(words);
                }),
                asTask,
                builder,
              },
              asked,
            );
            const ran: Activity = { kind: "ran-command", command: asked };
            if (allowed.ok) return decide(ok(ran), { helper, asTask });
            const refused = allowed.error;
            if (refused.kind !== "needs-approval") return decide(err(refused), { helper });
            // Allowing all, what it covers runs without asking (#428).
            if (refused.all === true && allowingAll()) {
              return decide(ok(ran), { helper, allowedAll: true, asTask });
            }
            return approval({
              ask: { kind: "command", command: asked, reason: refused.reason },
              why,
              allowed: ran,
              helper,
              always: refused.always,
              all: refused.all,
              asTask,
            });
          };
          return {
            worktree,
            plugin: code.plugin,
            // Word that its builds hold a place in the machine's builds lock (#306): each runs
            // only once the builds queue has given it one, so the repo's scripts don't wait for
            // another.
            env: { ...env, ...BUILD_HELD_ENV },
            edit: async (path) => {
              const place = await editPlaceIn(worktree, path);
              if (place.kind === "inside") {
                return decide(ok({ kind: "edited-file", path: place.shown }), { helper });
              }
              if (place.kind === "setup") {
                const allowed: Activity = { kind: "edited-file", path: place.shown };
                // Allowing all, a setup file's edit it covers runs without asking (#428).
                if (place.all && allowingAll())
                  return decide(ok(allowed), { helper, allowedAll: true });
                return approval({
                  ask: { kind: "setup", path: place.shown },
                  why: undefined,
                  allowed,
                  helper,
                  ...(place.all ? { all: true } : {}),
                });
              }
              const outside = resolve(worktree, path);
              return approval({
                ask: { kind: "edit", path: outside },
                why: undefined,
                allowed: { kind: "edited-file", path: outside },
                helper,
              });
            },
            run: (asked, why) => command(asked, why, false),
            ran: (asked) => {
              options.code.builds.ended(turn.id, asked);
              if (builder && isBuild(asked)) {
                void options.builders?.heard(turn.id, { kind: "check-ended", command: asked });
              }
            },
            // Only the model's own (#182): a helper works inside the turn.
            task: async (asked, why) => {
              if (helper !== undefined) return err(HELPER_NO_TASKS);
              const allowed = await command(asked, why, true);
              if (!allowed.ok) return allowed;
              // A heavy check has its place in the builds queue now, kept until the task ends
              // (#589); anything else run by it takes its own place in the machine's lock.
              const build = isBuild(asked);
              const freeBuild = () => {
                if (build) options.code.builds.taskEnded(turn.id, asked);
              };
              if (stopper.signal.aborted || recordingLost) {
                freeBuild();
                return err(codeRefusalReason({ kind: "stopped" }));
              }
              const started = await tasks.start({
                session: turn.id,
                sessionFolder: folderOf(turn.id),
                command: asked,
                cwd: worktree,
                env: build
                  ? { ...env, ...BUILD_HELD_ENV }
                  : {
                      ...env,
                      ...Object.fromEntries(
                        Object.keys(BUILD_HELD_ENV).map((name) => [name, undefined]),
                      ),
                    },
                ended: (task, ending) => {
                  freeBuild();
                  return taskEnded({ id: turn.id, task, ending });
                },
              });
              if (!started.ok) {
                freeBuild();
                return err(
                  started.error.kind === "too-many"
                    ? TOO_MANY_TASKS
                    : codeRefusalReason({ kind: "unreadable" }),
                );
              }
              const recorded = await append(turn.id, {
                type: "task-started",
                task: started.value,
                command: asked,
              });
              if (!recorded.ok) recordingLost = true;
              return ok(TASK_STARTED);
            },
          };
        };
        /** How many helpers are running (#117), and each one waiting for a place, first first. */
        const helpers = { running: 0, waiting: [] as (() => void)[] };
        /**
         * Starts a helper the model asked for (#117): recorded, then given a place once fewer
         * than `HELPERS_AT_ONCE` are running. One that waits for a place is recorded as waiting,
         * then again once it has one. `undefined` when the turn was stopped first.
         */
        const startHelper = async (
          started: { id: HelperId; name: string },
          code: Omit<Parameters<typeof codeTurn>[0], "helper">,
        ): Promise<HelperTurn | undefined> => {
          if (stopper.signal.aborted || recordingLost) return undefined;
          // A place there is now is taken at once, so helpers started together count right.
          const waits = helpers.running >= HELPERS_AT_ONCE;
          if (!waits) helpers.running += 1;
          const record = async (waiting: boolean) => {
            const recorded = await append(turn.id, {
              type: "helper-started",
              helper: started.id,
              name: started.name,
              ...(waiting ? { waiting } : {}),
            });
            if (!recorded.ok) recordingLost = true;
            return recorded.ok;
          };
          if (!(await record(waits))) return undefined;
          if (waits) {
            const placed = await new Promise<boolean>((resolve) => {
              const onStop = () => resolve(false);
              const take = () => {
                stopper.signal.removeEventListener("abort", onStop);
                helpers.running += 1;
                resolve(true);
              };
              // One may have finished while it was being recorded.
              if (helpers.running < HELPERS_AT_ONCE) return take();
              stopper.signal.addEventListener("abort", onStop, { once: true });
              helpers.waiting.push(take);
            });
            if (!placed || stopper.signal.aborted || !(await record(false))) return undefined;
          }
          if (stopper.signal.aborted) return undefined;
          const shared = codeTurn({ ...code, helper: started.id });
          /** Its own branch (#395), once it has one, and the say on its work there. */
          let own: { branch: HelperBranch; code: HelperCode } | undefined;
          const now = () => own?.code ?? shared;
          let finished = false;
          return {
            report: reportAs(started.id),
            code: {
              get worktree() {
                return now().worktree;
              },
              get env() {
                return now().env;
              },
              plugin: shared.plugin,
              edit: (path) => now().edit(path),
              run: (command, why) => now().run(command, why),
              ran: (command) => now().ran(command),
              task: (command, why) => now().task(command, why),
            },
            connections: connectionsFor(started.id),
            workIn: async (branch) => {
              if (own !== undefined || finished) return;
              own = {
                branch,
                code: codeTurn({
                  ...code,
                  worktree: branch.worktree,
                  branch: branch.branch,
                  helper: started.id,
                  own: true,
                }),
              };
              if (stopper.signal.aborted || recordingLost) return;
              const recorded = await append(turn.id, {
                type: "helper-branched",
                helper: started.id,
                branch: branch.branch,
              });
              if (!recorded.ok) recordingLost = true;
            },
            finished: async (said) => {
              if (finished) return undefined;
              finished = true;
              // Its branch merges back before its place goes to another, so one started next
              // branches from the session branch with its work in (#395). Stopped, it's kept.
              const merged =
                own === undefined || stopper.signal.aborted
                  ? undefined
                  : await options.code.mergeBack({
                      session: { branch: code.branch, worktree: code.worktree },
                      helper: own.branch,
                      message: started.name,
                    });
              helpers.running -= 1;
              helpers.waiting.shift()?.();
              if (stopper.signal.aborted || recordingLost) return undefined;
              const done = await append(turn.id, {
                type: "helper-finished",
                helper: started.id,
                report: said,
                ...(merged === undefined ? {} : { merged: merged === "merged" }),
              });
              if (!done.ok) recordingLost = true;
              return merged === undefined || own === undefined
                ? undefined
                : helperBranchNote({ merged: merged === "merged", branch: own.branch.branch });
            },
          };
        };
        const where =
          worktree === undefined || branch === undefined
            ? undefined
            : {
                worktree,
                branch,
                env: await options.code.commandEnv(),
                plugin: await mattPlugin(skills),
              };
        // Raced against the stop, so a provider that ignores it can't keep the session busy.
        const outcome = await Promise.race([
          turn.provider.runTurn({
            model: turn.model,
            effort: turn.effort,
            folder: worktree ?? workspace.value.folder,
            code:
              where === undefined
                ? null
                : {
                    ...codeTurn({ ...where, helper: undefined }),
                    // A Lead's builder starts no helpers (ADR 0031): the owner's sessions do.
                    helper: builder ? null : (started) => startHelper(started, where),
                    branchOff: () => options.code.branchOff(where),
                  },
            connections,
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
            added: turn.added?.messages ?? null,
            heardUsage: (meter) => options.usage?.heard(turn.id, turn.provider.id, meter),
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
    // No build outlives its turn, whether its provider said it ended or not (#281).
    options.code.builds.leave(turn.id);
    // What the turn used of its provider's plan is read again (#66).
    options.usage?.turnEnded(turn.provider.id);
    // A save already being written stays, whatever happens to the turn (ADR 0013), and a tool
    // call under way finishes, recording what it did.
    await Promise.allSettled(callsUnderway);
    if (!failure && recordingLost) {
      failure = {
        kind: "unknown",
        message: "Part of the answer couldn't be saved, so it stopped.",
      };
    }
    // Each room's plan in a finished answer is saved straight away (#257), its note under it.
    if (!failure && !stopper.signal.aborted && !turn.coding) await savePlans(turn);

    // How the turn ended is decided now: a stop arriving from here on finds nothing to stop, so
    // it can't turn a completed or failed turn into a stopped one.
    const stopped = stopper.signal.aborted;
    session.turn = { kind: "ending" };
    // What the owner added that its model never read, stopped first say, is marked so (#252),
    // before the turn's end.
    const unread = turn.added?.close() ?? [];
    for (const added of unread) {
      await append(turn.id, { type: "added-not-read", added: added.seq });
    }

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
    // One the answer ended without reading still gets answered, next, unless the owner stopped. A
    // task's ending it never read is told by a turn of its own instead (#182).
    for (const added of stopped ? [] : unread.filter((each) => each.task === undefined)) {
      await queueMessage({
        id: turn.id,
        message: {
          text: added.text,
          model: { provider: turn.provider.id, model: turn.model },
          ...(turn.effort === undefined ? {} : { effort: turn.effort }),
        },
        attachments: [],
      });
    }
    // Only once it's ended, so the next code session waiting starts after it.
    options.code.slots.release(turn.id);
    // The owner's next queued message goes at once (#177), before a fixing turn could (#172).
    const queuedGoes = ended.ok && (await sendNextQueued(turn.id));
    // Then any of its tasks that ended untold is told (#182), unless the owner stopped the turn.
    const tasksTold = ended.ok && !queuedGoes && !stopped && (await tellTasks(turn.id));
    // What the turn did to its pull request shows at once, the PR it opened, say (#172), and its
    // notification then says when the PR's checks still fail (story 31).
    if (turn.coding) await followPullRequest(turn.id);
    // A builder's status moves on once its pull request has been looked at (#590); a turn with
    // nothing to show is told to carry on, once.
    const builderEnding: TurnEnding = stopped
      ? { kind: "stopped" }
      : failure
        ? { kind: "failed", reason: failure }
        : { kind: "completed" };
    const carriesOn = builder && ended.ok && (await builderTurnEnded(turn.id, builderEnding));
    // Stopped or failed before its pull request, it lets its issue go (#324).
    if (turn.coding && ending.type !== "turn-completed") {
      await releaseClaim(turn.id, (branch) =>
        ending.type === "turn-stopped"
          ? `the owner stopped Courtyard session (${branch}) before its pull request.`
          : `Courtyard session (${branch}) failed before its pull request.`,
      );
    }
    // It isn't the owner's turn when their queued message, or a task's news, has just gone.
    if (ended.ok && !queuedGoes && !tasksTold) {
      const events = turn.coding ? await readEvents(turn.id) : undefined;
      const pullRequest = events?.ok ? pullRequestIn(events.value) : undefined;
      // The Lead's and its builders' turns end quietly, unless checks still fail (#347).
      const stillFailing = pullRequest?.state === "open" && pullRequest.checks.kind === "failed";
      if (!quiet || ending.type !== "turn-completed" || stillFailing) {
        options.notify?.(turn.id, ended.value, pullRequest);
      }
    }
    if (!ended.ok) console.error(`Session ${turn.id}: the end of a turn couldn't be recorded.`);
    else if (turn.firstTurn && ending.type === "turn-completed") {
      options.background(
        titleSession(turn.id).catch((error: unknown) =>
          console.error(`Session ${turn.id}: titling it crashed`, error),
        ),
      );
    }
    // Told to carry on (#590), unless the owner's queued message or a task's news went instead.
    if (carriesOn && !queuedGoes && !tasksTold) {
      const carried = await startTurn({
        id: turn.id,
        workspaceId: turn.workspaceId,
        provider: turn.provider,
        message: {
          text: BUILDER_CARRY_ON_MESSAGE,
          model: { provider: turn.provider.id, model: turn.model },
          ...(turn.effort === undefined ? {} : { effort: turn.effort }),
        },
        since: freshStarts,
        coding: turn.coding,
        placeless: turn.placeless,
        carriesOn: true,
      });
      if (!carried.ok) console.error(`Builder ${turn.id} couldn't carry on`, carried.error);
    }
  };

  /**
   * Tells `builders/` how a Lead builder's turn ended (#590), once its pull request has been
   * looked at, and whether its answer asked the owner something (it ends in a question mark).
   * Says whether it's to be told to carry on.
   */
  const builderTurnEnded = async (id: SessionId, ending: TurnEnding) => {
    if (options.builders === undefined) return false;
    const events = await readEvents(id);
    const turnStart = events.ok
      ? events.value.findLastIndex((event) => event.type === "owner-message")
      : -1;
    const answer = (events.ok ? events.value.slice(turnStart + 1) : [])
      .map((event) => (event.type === "text-delta" ? event.text : ""))
      .join("")
      .trim();
    const heard = await options.builders.heard(id, {
      kind: "turn-ended",
      ending,
      asked: answer.endsWith("?"),
    });
    return heard.carryOn;
  };

  /**
   * Saves each room's plan in the answer just written as that room's document (#257), recorded
   * like a document the model saved, so its note shows under the answer with Undo.
   */
  const savePlans = async (turn: { id: SessionId; workspaceId: WorkspaceId }) => {
    const events = await readEvents(turn.id);
    if (!events.ok) return;
    const asked = events.value.findLastIndex((event) => event.type === "owner-message");
    const answer = events.value
      .slice(asked + 1)
      .map((event) => (event.type === "text-delta" ? event.text : ""))
      .join("");
    for (const { save, change } of await savePlansFrom(targetOf(turn), answer)) {
      await append(turn.id, {
        type: "document-saved",
        save,
        ...(change === undefined ? {} : { change }),
      });
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
    /** It's in a code session that takes no slot (a grill, #363), so it runs at once. */
    placeless?: boolean;
    /** It answers the session's first message, so the session is titled once it completes. */
    firstTurn?: boolean;
    /** The files the owner attached, checked, to keep in the session's folder (#78). */
    attachments?: readonly PreparedAttachment[];
    /** Attachments already kept that the message carries again (Carry on). */
    keptAttachments?: readonly Attachment[];
    /** Sent by the worker because the session's pull request's checks failed (#172). */
    checksFailed?: { pullRequest: number; head: string; checks: [string, ...string[]] };
    /** Sent by the worker because the session's pull request conflicted with its base (#382). */
    conflicted?: { pullRequest: number; head: string };
    /** Sends the owner's queued message with this event number (#177), unless it's gone meanwhile. */
    fromQueue?: number;
    /** Sent by the worker to a code workspace's Lead: a builder's pull request merged (#347). */
    merged?: { pullRequest: number };
    /** The owner's tap on Run the build order, starting a code workspace's Lead (#347). */
    runsBuildOrder?: boolean;
    /**
     * Continue (#186) the turn with this number, cut off by a restart: checked again once the
     * session is this turn's, in case a newer one ran meanwhile.
     */
    continues?: { turn: number };
    /** Sent by the worker because these tasks ended while no turn ran (#182). */
    tasksEnded?: [TaskId, ...TaskId[]];
    /** Sent by the worker to a Lead's builder whose turn had nothing to show (#590). */
    carriesOn?: true;
    /** Sent by the worker to a Lead's builder once its usage limit has reset (#610). */
    afterLimit?: true;
  }): Promise<Result<null, SessionError>> => {
    if (settingAside || start.since !== freshStarts) return err({ kind: "starting-fresh" });
    const session = runningSession(start.id);
    if (session.turn.kind === "deleting") return err({ kind: "not-found" });
    if (session.turn.kind !== "idle") return err({ kind: "busy" });
    // Stoppable from the very start, so a Stop pressed the moment it appears is never lost.
    const stopper = new AbortController();
    const starting: TurnState = {
      kind: "running",
      stopper,
      turn: undefined,
      model: start.message.model,
      added: start.provider.capabilities.steers ? createAddedInbox(stopper.signal) : undefined,
    };
    session.turn = starting;

    if (start.coding) {
      const ended = await pullRequestEndedIn(start.id);
      if (ended !== undefined) {
        session.turn = { kind: "idle" };
        return err(ended);
      }
    }

    if (start.continues) {
      const events = await readEvents(start.id);
      if (!events.ok || cutOffTurn(events.value, start.continues.turn) === undefined) {
        session.turn = { kind: "idle" };
        return err(events.ok ? { kind: "nothing-to-continue" } : events.error);
      }
    }
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
    const message: NewEvent = {
      type: "owner-message",
      text: start.message.text,
      model: start.message.model,
      ...(start.message.effort === undefined ? {} : { effort: start.message.effort }),
      ...(start.message.skill === undefined ? {} : { skill: start.message.skill }),
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(start.checksFailed === undefined ? {} : { checksFailed: start.checksFailed }),
      ...(start.conflicted === undefined ? {} : { conflicted: start.conflicted }),
      ...(start.fromQueue === undefined ? {} : { queued: start.fromQueue }),
      ...(start.merged === undefined ? {} : { merged: start.merged }),
      ...(start.runsBuildOrder === true ? { runsBuildOrder: true } : {}),
      ...(start.continues === undefined ? {} : { continues: start.continues }),
      ...(start.tasksEnded === undefined ? {} : { tasksEnded: start.tasksEnded }),
      ...(start.carriesOn === true ? { carriesOn: true } : {}),
      ...(start.afterLimit === true ? { afterLimit: true } : {}),
    };
    const { fromQueue } = start;
    // A queued message goes only while it's still queued: checked in the session's queue, so the
    // owner removing it can't land between the check and its sending.
    const recorded =
      fromQueue === undefined
        ? await append(start.id, message)
        : await inOrder(session, async (): Promise<Result<SessionEvent, SessionError>> => {
            const events = await readEvents(start.id);
            if (!events.ok) return events;
            if (!queuedIn(events.value).some((queued) => queued.seq === fromQueue)) {
              return err({ kind: "queued-not-found" });
            }
            return writeEvent({ id: start.id, session, event: message });
          });
    if (!recorded.ok) {
      session.turn = { kind: "idle" };
      return recorded;
    }
    starting.turn = recorded.value.seq;
    // Carrying on after it stopped before its pull request, it claims its issue again (#324).
    if (start.coding && start.firstTurn !== true) await claimAgain(start.id);
    // The checks it fixes start its activity (#172).
    for (const name of start.checksFailed?.checks ?? []) {
      await append(start.id, { type: "activity", activity: { kind: "check-failed", name } });
    }
    await markUpdated(start.id);
    session.ended = runTurn({
      id: start.id,
      stopper: starting.stopper,
      added: starting.added,
      workspaceId: start.workspaceId,
      provider: start.provider,
      model: start.message.model.model,
      effort: start.message.effort,
      coding: start.coding,
      placeless: start.placeless ?? false,
      firstTurn: start.firstTurn ?? false,
    }).catch((error: unknown) => console.error(`Session ${start.id}: a turn crashed`, error));
    options.background(session.ended);
    return ok(null);
  };

  /**
   * Sends the session's next queued message (#177) as a turn of its own, once the session is free:
   * the first still waiting, unless the last turn ended on a usage limit, when they wait for the
   * owner's next turn (Carry on, say). One whose model can't answer now stays queued. Says whether
   * one went.
   */
  const sendNextQueued = async (id: SessionId): Promise<boolean> => {
    const since = freshStarts;
    for (;;) {
      const session = running.get(id);
      if (session === undefined || !session.queues || session.turn.kind !== "idle") return false;
      const [events, file] = await Promise.all([
        readEvents(id),
        readJsonFile(sessionFilePath(id), SessionFile),
      ]);
      if (!events.ok || !file.ok || file.value === undefined) return false;
      const last = events.value.findLast((event) => event.type === "owner-message");
      if (last !== undefined && limitedTurn(events.value, last.seq) !== undefined) return false;
      const next = queuedIn(events.value)[0];
      if (next === undefined) return false;
      const message: NewMessage = {
        text: next.text,
        model: next.model,
        ...(next.effort === undefined ? {} : { effort: next.effort }),
        ...(next.skill === undefined ? {} : { skill: next.skill }),
      };
      const provider = await providerIn(file.value.workspaceId, message);
      if (!provider.ok) return false;
      const started = await startTurn({
        id,
        workspaceId: file.value.workspaceId,
        provider: provider.value.provider,
        message,
        since,
        coding: file.value.branch !== undefined,
        placeless: file.value.placeless === true,
        fromQueue: next.seq,
        ...(next.attachments === undefined ? {} : { keptAttachments: next.attachments }),
      });
      if (started.ok) return true;
      // Removed meanwhile, so the one after it goes instead.
      if (started.error.kind !== "queued-not-found") return false;
    }
  };

  /**
   * Adds a message the owner sent while a turn runs to that answer (#252), when its provider
   * steers and the message is one it can take: words only, on the turn's own model, starting no
   * skill. Recorded where it was sent, marked when an approval waits, since it goes in once that's
   * answered. `undefined` when it can't go in, so it's queued instead (#177).
   */
  const steerInto = async (steer: {
    id: SessionId;
    message: NewMessage;
    attachments: readonly PreparedAttachment[];
  }): Promise<Result<null, SessionError> | undefined> => {
    const { id, message } = steer;
    const session = runningSession(id);
    const { turn } = session;
    // Only once the turn's own message is recorded, so it's always added after it.
    if (turn.kind !== "running" || turn.turn === undefined || turn.added === undefined) {
      return undefined;
    }
    if (steer.attachments.length > 0 || message.skill !== undefined) return undefined;
    if (
      turn.model.provider !== message.model.provider ||
      turn.model.model !== message.model.model
    ) {
      return undefined;
    }
    // Its place is kept before anything is awaited, so the answer can't finish without it.
    if (!turn.added.reserve()) return undefined;
    const recorded = await append(id, {
      type: "message-added",
      text: message.text,
      ...(session.approvals.size > 0 ? { afterApproval: true } : {}),
    });
    if (!recorded.ok) {
      turn.added.release();
      return recorded;
    }
    if (turn.added.add({ seq: recorded.value.seq, text: message.text })) return ok(null);
    // The turn ended meanwhile: it's marked not read, and queued for the next turn instead.
    await append(id, { type: "added-not-read", added: recorded.value.seq });
    return undefined;
  };

  /**
   * Queues a message the owner sent while a turn runs (#177), its attachments kept in the
   * session's folder now, and sends it at once if that turn ended meanwhile.
   */
  const queueMessage = async (queue: {
    id: SessionId;
    message: NewMessage;
    attachments: readonly PreparedAttachment[];
  }): Promise<Result<null, SessionError>> => {
    const { id, message } = queue;
    const ended = await pullRequestEndedIn(id);
    if (ended !== undefined) return err(ended);
    const kept = await keepAttachments(folderOf(id), queue.attachments);
    if (!kept.ok) return err(STORAGE_ERROR);
    const attachments = queue.attachments.map((prepared) => prepared.attachment);
    // Before it's written, so a turn ending meanwhile looks for it.
    runningSession(id).queues = true;
    const recorded = await append(id, {
      type: "message-queued",
      text: message.text,
      model: message.model,
      ...(message.effort === undefined ? {} : { effort: message.effort }),
      ...(message.skill === undefined ? {} : { skill: message.skill }),
      ...(attachments.length === 0 ? {} : { attachments }),
    });
    if (!recorded.ok) return recorded;
    void sendNextQueued(id);
    return ok(null);
  };

  /**
   * A message with the skill it starts, if any, once that's one its workspace can use: one of its
   * skills, not broken, and without scripts in a planning workspace. The owner starts one from the
   * skill picker, or by beginning the message with its name, as `/implement 157` (#181).
   */
  const withSkillStarted = async <M extends { text: string; skill?: SkillName | undefined }>(
    workspaceId: WorkspaceId,
    message: M,
  ): Promise<Result<M, SessionError>> => {
    const typed = SLASH_SKILL.exec(message.text)?.[1];
    if (message.skill === undefined && typed === undefined) return ok(message);
    const workspace = await getWorkspace(options.contextDir, workspaceId);
    if (!workspace.ok) return err(STORAGE_ERROR);
    const skills = await skillsOf(workspace.value);
    const usable = (name: string | undefined) =>
      skills.usable.find((skill) => skill.name === name)?.name;
    if (message.skill !== undefined) {
      return usable(message.skill) === undefined ? err({ kind: "skill-unavailable" }) : ok(message);
    }
    const skill = usable(typed);
    return ok(skill === undefined ? message : { ...message, skill });
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
   * A first message with its model: the one it names, or else the first provider's default (#247)
   * that isn't at its usage limit, at its effort (the first of all when every one is).
   */
  const withModel = async (message: FirstMessage): Promise<Result<NewMessage, SessionError>> => {
    const { model } = message;
    if (model !== undefined) return ok({ ...message, model });
    const defaults = (await statuses()).flatMap((status) => {
      const chosen = status.available ? defaultOf(status) : undefined;
      return chosen === undefined ? [] : [{ provider: status.id, ...chosen }];
    });
    const chosen = defaults.find((each) => each.model.limit === undefined) ?? defaults[0];
    return chosen
      ? ok({
          text: message.text,
          model: { provider: chosen.provider, model: chosen.model.id },
          ...(chosen.effort === undefined ? {} : { effort: chosen.effort }),
        })
      : err({ kind: "model-unavailable" });
  };

  /** Whether a session is allowing all now (#428), once its events have been read. */
  const allowingAllOf = (id: SessionId) => {
    const session = running.get(id);
    return session === undefined ? undefined : allowingAllAt(session.allowAll, options.now());
  };

  const summaryOf = ({ titledBy: _, ...file }: SessionFile): SessionSummary => {
    const allowingAll = allowingAllOf(file.id);
    return {
      ...file,
      busy: (running.get(file.id)?.turn.kind ?? "idle") !== "idle",
      ...(allowingAll === undefined ? {} : { allowingAll }),
    };
  };

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
   * Whose turn it is in a session (#179): the owner's while no turn runs; otherwise, from the
   * running turn's events, the approval it waits on, or what its model is doing now.
   */
  const turnNowOf = async (id: SessionId): Promise<Result<TurnNow, SessionError>> => {
    const session = running.get(id);
    if (session === undefined || session.turn.kind === "idle" || session.turn.kind === "deleting") {
      return ok({ kind: "your-turn" });
    }
    const events = await readEvents(id);
    if (!events.ok) return events;
    return ok(turnNowIn(events.value));
  };

  /** A code session's pull request as last recorded, if it has one yet (#240). */
  const lastPullRequestOf = async (file: SessionFile) => {
    if (file.branch === undefined) return undefined;
    let known = pullRequests.get(file.id);
    if (known === undefined) {
      const events = await readEvents(file.id);
      if (!events.ok) return undefined;
      known = pullRequestIn(events.value) ?? null;
      pullRequests.set(file.id, known);
    }
    return known ?? undefined;
  };

  /**
   * Turns on Allow all for this task (#428) for a code session: recorded, so it survives a
   * restart, and each approval its turn waits on that it covers is allowed at once. One already on
   * is never extended, and one whose pull request has merged or closed is refused.
   */
  const startAllowingAll = (
    file: SessionFile,
    on: { until: string; task: boolean; byLead: boolean },
  ) => {
    const { id } = file;
    const session = runningSession(id);
    return inOrder(session, async (): Promise<Result<null, SessionError>> => {
      const pullRequest = await lastPullRequestOf(file);
      if (pullRequestEnded(pullRequest)) {
        return err({ kind: "pull-request-ended", state: pullRequest.state });
      }
      if (allowingAllAt(session.allowAll, options.now()) !== undefined) {
        return err({ kind: "allowing-all" });
      }
      const recorded = await writeEvent({
        id,
        session,
        event: {
          type: "allow-all-started",
          until: on.until,
          task: on.task,
          ...(on.byLead ? { byLead: true as const } : {}),
        },
      });
      if (!recorded.ok) return recorded;
      const events = await readEvents(id);
      if (!events.ok) return events;
      const answered = new Set(
        events.value.flatMap((event) =>
          event.type === "approval-answered" ? [event.approval] : [],
        ),
      );
      for (const event of events.value) {
        if (event.type !== "approval-requested" || event.all !== true) continue;
        const waiting = session.approvals.get(event.seq);
        if (waiting === undefined || answered.has(event.seq)) continue;
        const given: GivenAnswer = { answer: "allow", allowedAll: true };
        const allowed = await writeEvent({
          id,
          session,
          event: { type: "approval-answered", approval: event.seq, ...given },
        });
        if (!allowed.ok) return allowed;
        session.approvals.delete(event.seq);
        waiting(given);
      }
      return ok(null);
    });
  };

  /**
   * Turns Allow all for this task off (#428), at once: any, or, `byLead`, only one the Lead gave
   * (#551). One that's off already stays off.
   */
  const stopAllowingAll = (id: SessionId, which: { byLead: boolean }) => {
    const session = runningSession(id);
    return inOrder(session, async (): Promise<Result<null, SessionError>> => {
      const on = allowingAllAt(session.allowAll, options.now());
      if (on === undefined || (which.byLead && session.allowAll.on?.byLead !== true)) {
        return ok(null);
      }
      const recorded = await writeEvent({ id, session, event: { type: "allow-all-ended" } });
      return recorded.ok ? ok(null) : recorded;
    });
  };

  /**
   * A workspace's sessions, most recently active first, each with whose turn it is, whether it's
   * waiting for a code session to end, and what it waits on the owner for (#334).
   */
  const sessionsOf = async (
    workspaceId: WorkspaceId,
  ): Promise<Result<CodeSessionList["sessions"], SessionError>> => {
    const folders = await listFolder(sessionsDir);
    if (!folders.ok) return err(STORAGE_ERROR);
    const summaries: CodeSessionList["sessions"] = [];
    for (const folder of folders.value) {
      const id = SessionId.safeParse(folder);
      if (!id.success) continue;
      const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
      if (!file.ok) return err(STORAGE_ERROR);
      if (file.value?.workspaceId !== workspaceId) continue;
      await settled(file.value.id);
      const now = await turnNowOf(file.value.id);
      if (!now.ok) return now;
      const pullRequest = await lastPullRequestOf(file.value);
      const queued = options.code.slots.waits(file.value.id);
      const session = runningSession(file.value.id);
      const seen = await seenOf(file.value.id, session);
      if (!seen.ok) return seen;
      // A Lead's builder that's stuck waits on the owner, saying why (#590).
      const status =
        file.value.byLead === true ? await options.builders?.statusOf(file.value.id) : undefined;
      const stuck = status?.kind === "stuck" ? status.reason : undefined;
      summaries.push({
        ...summaryOf(file.value),
        now: now.value,
        waiting: sessionWaiting({
          now: now.value,
          queued,
          pullRequest,
          answer: session.answered.answer,
          cutOff: session.answered.cutOff,
          stuck: stuck !== undefined,
          seen: seen.value,
          clock: options.now(),
        }),
        queued,
        ...(pullRequest === undefined ? {} : { pullRequest }),
        ...(stuck === undefined ? {} : { stuck }),
      });
    }
    // The Lead is pinned at the top (#347).
    return ok(
      summaries.sort(
        (a, b) =>
          Number(b.lead === true) - Number(a.lead === true) ||
          b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  };

  /**
   * The owner has seen the session up to event `upTo` (#334), on whichever device: kept in its
   * folder, never going back nor past its last event, so only an answer after it is a new reply.
   */
  const markSeen = async (rawId: string, upTo: number): Promise<Result<null, SessionError>> => {
    const found = await findSession(rawId);
    if (!found.ok) return found;
    const { id } = found.value;
    const session = runningSession(id);
    return inOrder(session, async (): Promise<Result<null, SessionError>> => {
      const was = await seenOf(id, session);
      if (!was.ok) return was;
      const seen = Math.min(upTo, (session.nextSeq ?? 1) - 1);
      if (seen <= was.value) return ok(null);
      const written = await writeJsonFile(seenPath(id), { upTo: seen } satisfies SessionSeen);
      if (!written.ok) return err(STORAGE_ERROR);
      session.seen = seen;
      return ok(null);
    });
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
   * Undoes one of the session's document, Thing or project saves, by its event number or the
   * change it was committed as, and records that in the session.
   */
  const undoFileSave = async (
    undo: { rawId: string; save: number | ChangeId },
    of: "document" | "thing" | "project",
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
        : of === "thing"
          ? { kind: "thing-refused", refusal }
          : { kind: "project-refused", refusal };
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
          : of === "thing"
            ? await undoThingChange(targetOf(file), saved.change)
            : await undoProjectChange(targetOf(file), saved.change);
      if (!reversed.ok) return err(refused(reversed.error));
      const recorded = await writeEvent({
        id: file.id,
        session,
        event: { type: `${of}-undone`, save: saved.seq },
      });
      return recorded.ok ? ok(null) : recorded;
    });
  };

  /** Why a code session takes no more messages: its pull request was merged or closed (#172). */
  const pullRequestEndedIn = async (id: SessionId): Promise<SessionError | undefined> => {
    const events = await readEvents(id);
    const pullRequest = events.ok ? pullRequestIn(events.value) : undefined;
    return pullRequest === undefined || pullRequest.state === "open"
      ? undefined
      : { kind: "pull-request-ended", state: pullRequest.state };
  };

  /** A code session's branch and its workspace's repository, or `undefined` for any other. */
  const codeBranchOf = async (file: SessionFile) => {
    if (file.branch === undefined) return undefined;
    const workspace = await getWorkspace(options.contextDir, file.workspaceId);
    if (!workspace.ok || typeof workspace.value.repoPath !== "string") return undefined;
    return { branch: file.branch, repoPath: workspace.value.repoPath };
  };

  /** A code session's branch and worktree, as clearing it away needs them. */
  const sessionBranchOf = (file: SessionFile & { branch: string }): SessionBranch => ({
    branch: file.branch,
    worktree: options.code.worktreeOf(file.id),
    ...(file.keepsBranch === true ? { kept: true } : {}),
  });

  /**
   * A code session's pull request as the owner reviews it (#160), with the session and its
   * repository, or why it can't be reviewed.
   */
  const reviewIn = async (
    rawId: string,
  ): Promise<
    Result<{ id: SessionId; repoPath: string; review: PullRequestReview }, SessionError>
  > => {
    const found = await findSession(rawId);
    if (!found.ok) return found;
    const code = await codeBranchOf(found.value);
    if (code === undefined) return err({ kind: "no-pull-request" });
    const review = await options.code.reviewOf(code);
    if (!review.ok) return err({ kind: "github", problem: review.error });
    if (review.value === undefined) return err({ kind: "no-pull-request" });
    return ok({ id: found.value.id, repoPath: code.repoPath, review: review.value });
  };

  /** Following pull requests runs one session at a time, so no change is recorded twice. */
  let following: Promise<unknown> = Promise.resolve();

  /**
   * Looks at a code session's pull request on GitHub (#172) and records what changed. A failing
   * check on a commit not yet asked about starts a turn asking the model to fix it, once the
   * session is free; a merged or closed one clears the session's worktree and branch away.
   */
  const followPullRequest = (id: SessionId) => {
    const look = following.then(async () => {
      const file = await readJsonFile(sessionFilePath(id), SessionFile);
      if (!file.ok || file.value === undefined) return;
      const { workspaceId } = file.value;
      const code = await codeBranchOf(file.value);
      if (code === undefined) return;
      const { branch, repoPath } = code;
      await settled(id);
      const events = await readEvents(id);
      if (!events.ok) return;
      let pullRequest = pullRequestIn(events.value);
      if (!pullRequestEnded(pullRequest)) {
        const found = await options.code.pullRequestOf({ repoPath, branch });
        if (found === undefined) return;
        if (!samePullRequest(found, pullRequest)) {
          const recorded = await append(id, { type: "pull-request", pullRequest: found });
          if (!recorded.ok) return;
          // Failing again on a commit that had its fixing turn, after a re-run: the owner is
          // asked, and no second fixing turn starts (#356).
          if (failedAgain({ events: events.value, was: pullRequest, now: found })) {
            options.notify?.(id, recorded.value, found);
          }
        }
        pullRequest = found;
      }
      const session = running.get(id);
      if (session !== undefined && session.turn.kind !== "idle") return;
      if (pullRequest.state !== "open") {
        // The session has ended, so its tasks do too (#182), before its worktree goes.
        await tasks.stopAll(id, "session-ended");
        const sessionBranch = sessionBranchOf({ ...file.value, branch });
        const there = await exists(sessionBranch.worktree);
        if (there.ok && there.value) {
          await options.code.clearBranch({ repoPath, sessionBranch, pushed: true });
        }
        return;
      }
      // A conflict first: its checks may not run again until it's brought up to date (#382).
      if (pullRequest.conflicts === true) {
        await bringUpToDateOnce({ id, workspaceId, repoPath, events: events.value, pullRequest });
        return;
      }
      if (pullRequest.checks.kind === "failed") {
        const { failed } = pullRequest.checks;
        await fixChecks({ id, workspaceId, events: events.value, pullRequest, failed });
      }
    });
    following = look.catch((error: unknown) =>
      console.error(`Session ${id}: its pull request couldn't be followed`, error),
    );
    return following;
  };

  /**
   * Starts a turn asking the model to bring a pull request that conflicts with its base up to
   * date (#382), the message Bring up to date sends (#278), on the model the owner last used:
   * once per commit, so a conflict the model can't resolve waits for the owner instead of looping.
   */
  const bringUpToDateOnce = async (bring: {
    id: SessionId;
    workspaceId: WorkspaceId;
    repoPath: string;
    events: readonly SessionEvent[];
    pullRequest: PullRequest;
  }) => {
    const { pullRequest } = bring;
    const asked = bring.events.some(
      (event) => event.type === "owner-message" && event.conflicted?.head === pullRequest.head,
    );
    const last = bring.events.findLast((event) => event.type === "owner-message");
    if (asked || last?.type !== "owner-message") return;
    const fresh = await options.code.freshDefault(bring.repoPath);
    if (!fresh.ok) return;
    const message: NewMessage = {
      text: bringUpToDateMessage({ number: pullRequest.number, base: fresh.value.branch }),
      model: last.model,
      ...(last.effort === undefined ? {} : { effort: last.effort }),
    };
    const provider = await providerFor(message);
    if (!provider.ok || !provider.value.capabilities.codes) return;
    await startTurn({
      id: bring.id,
      workspaceId: bring.workspaceId,
      provider: provider.value,
      message,
      since: freshStarts,
      coding: true,
      conflicted: { pullRequest: pullRequest.number, head: pullRequest.head },
    });
  };

  /**
   * Continue (#186): the cut-off turn `turn`, or the session's last turn when left out, carries
   * on, told so, on its model.
   */
  const continueTurn = async (
    rawId: string,
    asked: number | undefined,
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
    const turn = asked ?? events.value.findLast((event) => event.type === "owner-message")?.seq;
    const cut = turn === undefined ? undefined : cutOffTurn(events.value, turn);
    if (cut === undefined) return err({ kind: "nothing-to-continue" });
    const message: NewMessage = {
      text: CONTINUE_MESSAGE,
      model: cut.model,
      ...(cut.effort === undefined ? {} : { effort: cut.effort }),
      ...(cut.skill === undefined ? {} : { skill: cut.skill }),
    };
    const provider = await providerIn(workspaceId, message);
    if (!provider.ok) return provider;
    return startTurn({
      id,
      workspaceId,
      provider: provider.value.provider,
      message,
      since,
      coding: found.value.branch !== undefined,
      placeless: found.value.placeless === true,
      continues: { turn: cut.seq },
    });
  };

  /**
   * Retry (#592): a Lead's builder that's Stuck carries on, told so in the owner's words, on the
   * model and effort its last message went to, its one carry-on with it again.
   */
  const retryBuilder = async (rawId: string): Promise<Result<null, SessionError>> => {
    const since = freshStarts;
    const found = await findSession(rawId);
    if (!found.ok) return found;
    const { id, workspaceId } = found.value;
    if ((await options.builders?.statusOf(id))?.kind !== "stuck") {
      return err({ kind: "not-stuck" });
    }
    await settled(id);
    const events = await readEvents(id);
    if (!events.ok) return events;
    const last = events.value.findLast((event) => event.type === "owner-message");
    if (last?.type !== "owner-message") return err({ kind: "not-stuck" });
    const message: NewMessage = {
      text: BUILDER_RETRY_MESSAGE,
      model: last.model,
      ...(last.effort === undefined ? {} : { effort: last.effort }),
    };
    const provider = await providerIn(workspaceId, message);
    if (!provider.ok) return provider;
    await options.builders?.heard(id, { kind: "retried" });
    return startTurn({
      id,
      workspaceId,
      provider: provider.value.provider,
      message,
      since,
      coding: found.value.branch !== undefined,
      placeless: found.value.placeless === true,
    });
  };

  /**
   * Starts a turn asking the model to fix the checks that failed on a pull request's latest
   * commit, or say why it can't (#172), on the model the owner last used: once per commit.
   */
  const fixChecks = async (fix: {
    id: SessionId;
    workspaceId: WorkspaceId;
    events: readonly SessionEvent[];
    pullRequest: PullRequest;
    /** The checks that failed, by name. */
    failed: readonly string[];
  }) => {
    const { pullRequest } = fix;
    const asked = fix.events.some(
      (event) => event.type === "owner-message" && event.checksFailed?.head === pullRequest.head,
    );
    const last = fix.events.findLast((event) => event.type === "owner-message");
    if (asked || last?.type !== "owner-message") return;
    const [first, ...more] = fix.failed;
    if (first === undefined) return;
    const message: NewMessage = {
      text: checksFailedMessage({ number: pullRequest.number, checks: [first, ...more] }),
      model: last.model,
      ...(last.effort === undefined ? {} : { effort: last.effort }),
    };
    const provider = await providerFor(message);
    if (!provider.ok || !provider.value.capabilities.codes) return;
    await startTurn({
      id: fix.id,
      workspaceId: fix.workspaceId,
      provider: provider.value,
      message,
      since: freshStarts,
      coding: true,
      checksFailed: {
        pullRequest: pullRequest.number,
        head: pullRequest.head,
        checks: [first, ...more],
      },
    });
  };

  /**
   * The tasks that finished or failed since the session's last message (#182) and haven't been
   * told to its model in an answer, each as the model is told it, oldest first.
   */
  const untoldTasks = (events: readonly SessionEvent[]) => {
    const since = events.findLast((event) => event.type === "owner-message")?.seq ?? 0;
    const unread = new Set(
      events.flatMap((event) => (event.type === "added-not-read" ? [event.added] : [])),
    );
    const told = new Set(
      events.flatMap((event) =>
        event.type === "message-added" && event.task !== undefined && !unread.has(event.seq)
          ? [event.task]
          : [],
      ),
    );
    const endedAt = new Map(
      events.flatMap((event) => (event.type === "task-ended" ? [[event.task, event.seq]] : [])),
    );
    return tasksIn(events).filter(
      ({ task, ended, preview }) =>
        ended !== undefined &&
        ended.ending.kind !== "stopped" &&
        !preview &&
        (endedAt.get(task) ?? 0) > since &&
        !told.has(task),
    );
  };

  /** What a task's ending tells the model (#182): as the event log keeps it, and with its output. */
  const taskNews = async (id: SessionId, told: TaskTold) => {
    const ended = told.ended;
    const kept = taskEndedMessage({
      command: told.command,
      ending: ended?.ending ?? { kind: "failed", exitCode: null },
      ranMs: Date.parse(ended?.at ?? told.startedAt) - Date.parse(told.startedAt),
    });
    const output = await tasks.output(folderOf(id), told.task, TASK_TAIL.characters * 4);
    return { kept, full: withTaskOutput(kept, output.ok ? output.value.text : "") };
  };

  /**
   * A turn's framing with the last lines of output of the tasks its message tells of (#182), which
   * the event log never keeps.
   */
  const withTasksOutput = async (
    id: SessionId,
    events: readonly SessionEvent[],
    framing: Framing,
  ): Promise<Framing> => {
    const last = events.findLast((event) => event.type === "owner-message");
    const ended = last?.type === "owner-message" ? (last.tasksEnded ?? []) : [];
    if (ended.length === 0 || !framing.message.endsWith(framing.newMessage)) return framing;
    const told = tasksIn(events).filter(({ task }) => ended.includes(task));
    const news = await Promise.all(told.map((each) => taskNews(id, each)));
    const newMessage = news.map(({ full }) => full).join("\n\n");
    return {
      ...framing,
      message: `${framing.message.slice(0, framing.message.length - framing.newMessage.length)}${newMessage}`,
      newMessage,
    };
  };

  /**
   * Tells a session's model of its tasks that ended untold (#182), in a turn of their own on the
   * model the owner last used, once the session is free. Says whether one started.
   */
  const tellTasks = async (id: SessionId): Promise<boolean> => {
    const session = running.get(id);
    if (session === undefined || session.turn.kind !== "idle") return false;
    const [events, file] = await Promise.all([
      readEvents(id),
      readJsonFile(sessionFilePath(id), SessionFile),
    ]);
    if (!events.ok || !file.ok || file.value === undefined) return false;
    const untold = untoldTasks(events.value);
    const [first, ...more] = untold.map(({ task }) => task);
    const last = events.value.findLast((event) => event.type === "owner-message");
    if (first === undefined || last?.type !== "owner-message") return false;
    const news = await Promise.all(untold.map((each) => taskNews(id, each)));
    const message: NewMessage = {
      text: news.map(({ kept }) => kept).join("\n\n"),
      model: last.model,
      ...(last.effort === undefined ? {} : { effort: last.effort }),
    };
    const provider = await providerIn(file.value.workspaceId, message);
    if (!provider.ok || !provider.value.provider.capabilities.codes) return false;
    const started = await startTurn({
      id,
      workspaceId: file.value.workspaceId,
      provider: provider.value.provider,
      message,
      since: freshStarts,
      coding: file.value.branch !== undefined,
      placeless: file.value.placeless === true,
      tasksEnded: [first, ...more],
    });
    return started.ok;
  };

  /**
   * Records how a task ended (#182). One that finished or failed tells the model: in the answer
   * that's running, as a message the owner adds does (#252), or in a turn of its own once the
   * session is free. One that was stopped tells nobody.
   */
  const taskEnded = async (end: { id: SessionId; task: TaskId; ending: TaskEnding }) => {
    const { id, task, ending } = end;
    // Its preview goes with it (#183).
    options.previews?.ended(id, task);
    const preview = previewsStarted.delete(task);
    const session = running.get(id);
    // Deleted, or set aside by a fresh start: there's nothing to record it in.
    if (session === undefined || session.turn.kind === "deleting") return;
    const recorded = await append(id, { type: "task-ended", task, ending });
    // The owner's Start preview tells nobody how it ended (#183).
    if (!recorded.ok || ending.kind === "stopped" || preview) return;
    const { turn } = session;
    if (turn.kind === "running" && turn.turn !== undefined && turn.added?.reserve() === true) {
      const events = await readEvents(id);
      const told = events.ok ? tasksIn(events.value).find((each) => each.task === task) : undefined;
      if (told === undefined) {
        turn.added.release();
        return;
      }
      const news = await taskNews(id, told);
      const added = await append(id, {
        type: "message-added",
        text: news.kept,
        task,
        ...(session.approvals.size > 0 ? { afterApproval: true } : {}),
      });
      if (!added.ok) {
        turn.added.release();
        return;
      }
      if (turn.added.add({ seq: added.value.seq, text: news.full, task })) return;
      // The turn ended meanwhile: it's told in a turn of its own.
      await append(id, { type: "added-not-read", added: added.value.seq });
    }
    // Told once the turn running now ends, if one is.
    await tellTasks(id);
  };

  /**
   * Carries on each Lead builder waiting for the usage limit once its reset has come (#610): a turn
   * of the worker's on the model its limited turn was on, telling it so. One whose turn is running,
   * or whose last turn didn't end on the limit after all, is left.
   */
  const carryOnAtReset = async () => {
    const since = freshStarts;
    for (const id of (await options.builders?.dueAtReset()) ?? []) {
      if (running.get(id)?.turn.kind === "running") continue;
      const [events, file] = await Promise.all([
        readEvents(id),
        readJsonFile(sessionFilePath(id), SessionFile),
      ]);
      if (!events.ok || !file.ok || file.value === undefined) continue;
      const last = events.value.findLast((event) => event.type === "owner-message");
      const limited = last === undefined ? undefined : limitedTurn(events.value, last.seq);
      if (limited === undefined) continue;
      const message: NewMessage = {
        text: BUILDER_LIMIT_RESET_MESSAGE,
        model: limited.model,
        ...(limited.effort === undefined ? {} : { effort: limited.effort }),
      };
      const provider = await providerIn(file.value.workspaceId, message);
      if (!provider.ok) continue;
      const started = await startTurn({
        id,
        workspaceId: file.value.workspaceId,
        provider: provider.value.provider,
        message,
        since,
        coding: file.value.branch !== undefined,
        placeless: file.value.placeless === true,
        afterLimit: true,
      });
      if (!started.ok) console.error(`Builder ${id} couldn't carry on at the reset`, started.error);
    }
  };

  return {
    /** For the worker's repeating jobs (#610): carries on each builder whose usage limit has reset. */
    carryOnAtReset,

    /** For the worker's repeating jobs (#601): writes the note of each planning session gone quiet. */
    writeQuietNotes: notes.writeQuiet,

    /** A code session's tasks still running (#182), oldest first, each with its last line. */
    runningTasks: async (rawId: string): Promise<Result<RunningTasks, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { id } = found.value;
      const listed = await Promise.all(
        tasks.running(id).map(async (task) => ({
          task,
          lastLine: await tasks.lastLine(folderOf(id), task),
        })),
      );
      return ok({ tasks: listed });
    },

    /** One of a session's tasks' output (#182), its end, running or not. */
    taskOutput: async (
      rawId: string,
      rawTask: string,
    ): Promise<Result<TaskOutput, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const task = TaskId.safeParse(rawTask);
      const events = await readEvents(found.value.id);
      if (!events.ok) return events;
      if (!task.success || !tasksIn(events.value).some((each) => each.task === task.data)) {
        return err({ kind: "task-not-found" });
      }
      const output = await tasks.output(
        folderOf(found.value.id),
        task.data,
        TASK_OUTPUT_MAX_CHARACTERS,
      );
      return output.ok
        ? ok({ output: output.value.text, cut: output.value.cut })
        : err(STORAGE_ERROR);
    },

    /** Stops one of a session's tasks (#182), the owner's Stop: it tells nobody. */
    stopTask: async (rawId: string, rawTask: string): Promise<Result<null, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const task = TaskId.safeParse(rawTask);
      if (!task.success || !(await tasks.stop(found.value.id, task.data, "owner"))) {
        return err({ kind: "task-not-found" });
      }
      return ok(null);
    },

    /**
     * A code session's tasks still running, for its preview (#183), oldest first: each with the
     * start of its output, where a dev server says where it serves, and whether the owner started
     * it with Start preview; and the session's worktree, where Start preview runs.
     */
    previewTasks: async (rawId: string): Promise<Result<PreviewTasks, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { id, branch } = found.value;
      if (branch === undefined) return err({ kind: "not-code-session" });
      const events = await readEvents(id);
      if (!events.ok) return events;
      const told = tasksIn(events.value);
      const listed = await Promise.all(
        tasks.running(id).map(async (task) => ({
          task,
          preview: told.some((each) => each.task === task && each.preview),
          opening: await tasks.opening(folderOf(id), task, TASK_OPENING_BYTES),
        })),
      );
      return ok({
        id,
        workspaceId: found.value.workspaceId,
        worktree: options.code.worktreeOf(id),
        tasks: listed,
      });
    },

    /**
     * Start preview (#183): the owner's command runs as one of a code session's tasks, in its
     * worktree, with `env` on top of the worker's. Its end tells nobody, as a stopped task's
     * doesn't. Needs no approval: the owner tapped it.
     */
    startPreview: async (start: {
      id: string;
      command: string;
      env: CommandEnv;
    }): Promise<Result<TaskId, SessionError>> => {
      const found = await findSession(start.id);
      if (!found.ok) return found;
      const { id, branch } = found.value;
      if (branch === undefined) return err({ kind: "not-code-session" });
      const started = await tasks.start({
        session: id,
        sessionFolder: folderOf(id),
        command: start.command,
        cwd: options.code.worktreeOf(id),
        env: start.env,
        ended: (task, ending) => taskEnded({ id, task, ending }),
      });
      if (!started.ok) return err({ kind: "task-refused", refusal: started.error });
      previewsStarted.add(started.value);
      const recorded = await append(id, {
        type: "task-started",
        task: started.value,
        command: start.command,
        preview: true,
      });
      if (!recorded.ok) {
        await tasks.stop(id, started.value, "owner");
        return recorded;
      }
      return ok(started.value);
    },

    /** A code session's pull request as the owner reviews it (#160). */
    pullRequestReview: async (rawId: string): Promise<Result<PullRequestReview, SessionError>> => {
      const found = await reviewIn(rawId);
      return found.ok ? ok(found.value.review) : found;
    },

    /**
     * Bring up to date (#278): fetches the base branch of a code session's pull request, then
     * sends the session the worker's message to merge it in and fix the conflict, on the model
     * the owner last used there; queued while a turn runs.
     */
    bringUpToDate: async (rawId: string): Promise<Result<null, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { id, workspaceId } = found.value;
      const code = await codeBranchOf(found.value);
      const events = await readEvents(id);
      if (!events.ok) return events;
      if (code === undefined) return err({ kind: "no-pull-request" });
      // As recorded, or, opened since it was last followed, as GitHub has it now.
      const pullRequest = pullRequestIn(events.value) ?? (await options.code.pullRequestOf(code));
      if (pullRequest === undefined) return err({ kind: "no-pull-request" });
      if (pullRequestEnded(pullRequest)) {
        return err({ kind: "pull-request-ended", state: pullRequest.state });
      }
      const fresh = await options.code.freshDefault(code.repoPath);
      if (!fresh.ok) return err({ kind: "branch-refused", refusal: fresh.error });
      const last = events.value.findLast((event) => event.type === "owner-message");
      if (last?.type !== "owner-message") return err({ kind: "no-pull-request" });
      const message: NewMessage = {
        text: bringUpToDateMessage({ number: pullRequest.number, base: fresh.value.branch }),
        model: last.model,
        ...(last.effort === undefined ? {} : { effort: last.effort }),
      };
      const provider = await providerIn(workspaceId, message);
      if (!provider.ok) return provider;
      await settled(id);
      const started = await startTurn({
        id,
        workspaceId,
        provider: provider.value.provider,
        message,
        since: freshStarts,
        coding: true,
      });
      return !started.ok && started.error.kind === "busy"
        ? queueMessage({ id, message, attachments: [] })
        : started;
    },

    /**
     * Merges a code session's pull request on GitHub (#160), refused with the reason while it
     * can't merge, and only while its latest commit is `reviewed`, the one the owner looked at. Once
     * merged, the session ends as one merged on GitHub does: the merge is recorded, and its worktree
     * and branch are cleared away.
     */
    mergePullRequest: async (
      rawId: string,
      reviewed: string,
    ): Promise<Result<null, SessionError>> => {
      const found = await reviewIn(rawId);
      if (!found.ok) return found;
      const { id, repoPath, review } = found.value;
      const { number, head } = review.pullRequest;
      // Before anything else: the reason it couldn't merge may be new since the owner looked.
      if (head !== reviewed) {
        return err({
          kind: "pull-request-refused",
          reason: "The pull request changed since you looked. Review it again.",
        });
      }
      if (review.merge.kind === "refused") {
        return err({ kind: "pull-request-refused", reason: review.merge.reason });
      }
      // GitHub merges it only while its latest commit is still the one reviewed.
      const merged = await options.code.merge({ repoPath, number, head: reviewed });
      if (!merged.ok) return err({ kind: "github", problem: merged.error });
      await followPullRequest(id);
      return ok(null);
    },

    /**
     * Closes a code session's pull request on GitHub without merging it (#160); the session ends
     * as one closed on GitHub does.
     */
    closePullRequest: async (rawId: string): Promise<Result<null, SessionError>> => {
      const found = await reviewIn(rawId);
      if (!found.ok) return found;
      const { id, repoPath, review } = found.value;
      const { number, state } = review.pullRequest;
      if (state !== "open") {
        return err({ kind: "pull-request-refused", reason: `It's ${state} already.` });
      }
      const closed = await options.code.close({ repoPath, number });
      if (!closed.ok) return err({ kind: "github", problem: closed.error });
      await followPullRequest(id);
      return ok(null);
    },

    /**
     * Follows every code session's pull request on GitHub (#172), for the worker's repeating
     * jobs: what changed is recorded, a failing check starts a fixing turn, and a merged or closed
     * one ends its session.
     */
    followPullRequests: async () => {
      const folders = await listFolder(sessionsDir);
      if (!folders.ok) return;
      for (const folder of folders.value) {
        const id = SessionId.safeParse(folder);
        if (id.success) await followPullRequest(id.data);
      }
    },

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

    /**
     * Undoes one of the session's project saves (#603), by its event number, or by the change it
     * was committed as (from Recent changes): the project goes back as it was, unless it's changed
     * since. Recorded in the session, so its note shows it from any device.
     */
    undoProject: (undo: { rawId: string; save: number | ChangeId }) =>
      undoFileSave(undo, "project"),

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
      /**
       * In a code workspace, the branch of a pull request no session opened (#278), to work on in
       * place of a session branch of its own.
       */
      onBranch?: string;
      /** Its title, in place of its first message's first line; kept as the starter's is. */
      title?: string;
      /** In a code workspace, it takes no place among the code sessions running (a grill, #363). */
      placeless?: boolean;
      /** In a code workspace, it's the workspace's Lead (#347), or one of its builders. */
      lead?: "lead" | "builder";
      /** In a code workspace, the issue it builds, next in order (Build, #298): claimed for it. */
      issue?: number;
      /**
       * A builder the Lead starts with Allow all for builders (#428): it allows all from the start,
       * until its pull request opens, until this at most.
       */
      allowAllUntil?: string;
    }): Promise<Result<SessionSummary, SessionError>> => {
      const since = freshStarts;
      if (settingAside) return err({ kind: "starting-fresh" });
      // Started from a project (#603): one of its planning workspace's, which it belongs to.
      const { project, ...firstMessage } = start.message;
      if (project !== undefined) {
        const projects = await readProjects({
          contextDir: options.contextDir,
          workspaceId: start.workspaceId,
        });
        if (!projects.ok) return err({ kind: "project-refused", refusal: projects.error });
        if (!projects.value.projects.some((one) => one.project.slug === project)) {
          return err({ kind: "project-refused", refusal: { kind: "not-found", slug: project } });
        }
      }
      const chosen = await withModel(firstMessage);
      if (!chosen.ok) return chosen;
      const message = await withSkillStarted(start.workspaceId, chosen.value);
      if (!message.ok) return message;
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
          : start.onBranch === undefined
            ? await options.code.startBranch({ repoPath, sessionId: id })
            : await options.code.startOnBranch({ repoPath, sessionId: id, branch: start.onBranch });
      if (branched !== undefined && !branched.ok) {
        return err({ kind: "branch-refused", refusal: branched.error });
      }
      const sessionBranch = branched?.value;
      // The issue it's started on (#324): Build's, else one its first message names, if it builds.
      const builds =
        sessionBranch !== undefined &&
        start.onBranch === undefined &&
        start.placeless !== true &&
        start.lead !== "lead";
      const issue = builds
        ? (start.issue ?? (await options.claims?.named(start.workspaceId, start.message.text)))
        : undefined;
      const file: SessionFile = {
        id,
        workspaceId: start.workspaceId,
        // A message with no words is titled by the first file it carried (#164).
        title:
          start.title ??
          titleFrom(start.message.text || (start.attachments?.[0]?.attachment.name ?? "")),
        ...(start.starter || start.title !== undefined ? { titledBy: "starter" } : {}),
        createdAt: at,
        updatedAt: at,
        ...(sessionBranch === undefined ? {} : { branch: sessionBranch.branch }),
        ...(sessionBranch?.kept === true ? { keepsBranch: true } : {}),
        ...(sessionBranch !== undefined && (start.placeless === true || start.lead === "lead")
          ? { placeless: true }
          : {}),
        ...(sessionBranch !== undefined && start.lead === "lead" ? { lead: true } : {}),
        ...(sessionBranch !== undefined && start.lead === "builder" ? { byLead: true } : {}),
        ...(issue === undefined ? {} : { claim: { issue, standing: true } }),
        ...(project === undefined ? {} : { project }),
      };
      const unstarted = async () => {
        if (repoPath !== undefined && sessionBranch !== undefined) {
          await options.code.clearBranch({ repoPath, sessionBranch, pushed: false });
        }
      };
      try {
        await mkdir(folderOf(id), { recursive: true });
      } catch {
        await unstarted();
        return err(STORAGE_ERROR);
      }
      const written = await writeJsonFile(sessionFilePath(id), file);
      // Allowing all from the start (#428), recorded before its first turn reads it.
      const allowing =
        written.ok && sessionBranch !== undefined && start.allowAllUntil !== undefined
          ? await append(id, {
              type: "allow-all-started",
              until: start.allowAllUntil,
              task: true,
              byLead: true,
            })
          : written;
      // Another session starting in a planning workspace has the notes of the ones before it
      // written now, which its first turn waits for (#601).
      if (written.ok && sessionBranch === undefined) notes.started(start.workspaceId, id);
      const started =
        written.ok && allowing.ok
          ? await startTurn({
              id,
              workspaceId: start.workspaceId,
              provider: provider.value.provider,
              message: message.value,
              since,
              coding: sessionBranch !== undefined,
              placeless: file.placeless === true,
              firstTurn: true,
              runsBuildOrder: file.lead === true,
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
      // Claimed as it starts, so its model finds the claim made for it (AGENTS.md, claim rule).
      if (issue !== undefined && sessionBranch !== undefined) {
        await options.claims?.claim(start.workspaceId, issue, {
          branch: sessionBranch.branch,
          why: start.issue === undefined ? "the owner asked" : "next in order",
        });
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
      const { rawId, attachments } = send;
      const since = freshStarts;
      const session = await findSession(rawId);
      if (!session.ok) return session;
      if (await isArchived(options.contextDir, session.value.workspaceId)) {
        return err({ kind: "workspace-archived" });
      }
      const provider = await providerIn(session.value.workspaceId, send.message);
      if (!provider.ok) return provider;
      const message = await withSkillStarted(session.value.workspaceId, send.message);
      if (!message.ok) return message;
      const { id } = session.value;
      // What a stopped worker left behind is put right first, so a turn it left open isn't busy.
      await settled(id);
      const started = await startTurn({
        id,
        workspaceId: session.value.workspaceId,
        provider: provider.value.provider,
        message: message.value,
        since,
        coding: session.value.branch !== undefined,
        placeless: session.value.placeless === true,
        attachments,
      });
      // A turn is running: it goes into that answer (#252), or waits its turn (#177).
      if (!started.ok && started.error.kind === "busy") {
        const steered = await steerInto({ id, message: message.value, attachments });
        return steered ?? queueMessage({ id, message: message.value, attachments });
      }
      return started;
    },

    /**
     * Removes one of the session's queued messages before it goes (#177), by its event number,
     * from any device; recorded in the session, so it goes from every device.
     */
    removeQueued: async (rawId: string, queued: number): Promise<Result<null, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { id } = found.value;
      const session = runningSession(id);
      return inOrder(session, async (): Promise<Result<null, SessionError>> => {
        const events = await readEvents(id);
        if (!events.ok) return events;
        const was = events.value.some(
          (event) => event.type === "message-queued" && event.seq === queued,
        );
        if (!was) return err({ kind: "queued-not-found" });
        const sent = events.value.some(
          (event) => event.type === "owner-message" && event.queued === queued,
        );
        if (sent) return err({ kind: "queued-sent" });
        // Removed already, from another device: it's gone, as asked.
        if (!queuedIn(events.value).some((event) => event.seq === queued)) return ok(null);
        const recorded = await writeEvent({
          id,
          session,
          event: { type: "queued-message-removed", queued },
        });
        return recorded.ok ? ok(null) : recorded;
      });
    },

    /**
     * Sends the queued messages a stopped worker left waiting (#177), for the worker to call as
     * it starts: each such session is put right, as the first touch does, and its next one goes.
     */
    resumeQueued: async () => {
      const folders = await listFolder(sessionsDir);
      if (!folders.ok) return;
      for (const folder of folders.value) {
        const id = SessionId.safeParse(folder);
        if (!id.success) continue;
        const text = await readTextFile(eventsPath(id.data));
        if (text.ok && text.value?.includes('"message-queued"')) runningSession(id.data);
      }
    },

    /**
     * Carry on (spec, Overflow): after the session's last turn hit a usage limit, records the move
     * to another provider's default and sends the turn's message to it again, at the default's
     * effort (#247). Only ever because the owner asked.
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
          ...(overflow.effort === undefined ? {} : { effort: overflow.effort }),
          ...(message.skill === undefined ? {} : { skill: message.skill }),
        },
        carryingOn: { turn: request.turn },
        coding: found.value.branch !== undefined,
        placeless: found.value.placeless === true,
        // Its attachments go again too, already in the session's folder.
        ...(message.attachments === undefined ? {} : { keptAttachments: message.attachments }),
        // Carrying on the first message is still the session's first turn.
        firstTurn: events.value.find((event) => event.type === "owner-message") === message,
        since,
      });
    },

    /**
     * Continue (#186): after a restart cut off the session's last turn, sends the worker's words
     * telling its model so, to carry on from where it was and check what already happened, on the
     * turn's model, effort and skill. The owner's tap, or the worker's after an Update now.
     */
    continue: (rawId: string, request: ContinueRequest) => continueTurn(rawId, request.turn),

    /** Retry (#592): a Lead's builder that's Stuck carries on, as the owner tapped. */
    retry: retryBuilder,

    /**
     * Continue the session's last turn, cut off by an update the worker started itself (#186):
     * after Update now, cut-off turns carry on by themselves.
     */
    continueLast: (id: SessionId) => continueTurn(id, undefined),

    /**
     * Checks every session as the worker starts (#186), not only once touched: a turn the stopped
     * worker left running is recorded as cut off, and a queued message it left waiting goes (#177).
     * Gives back the sessions whose turns were cut off, most recently active first.
     */
    recoverAll: async (): Promise<SessionSummary[]> => {
      const folders = await listFolder(sessionsDir);
      if (!folders.ok) return [];
      const cutOff: SessionSummary[] = [];
      for (const folder of folders.value) {
        const id = SessionId.safeParse(folder);
        if (!id.success) continue;
        const session = runningSession(id.data);
        await settled(id.data);
        if (!session.cutOffByRestart) continue;
        const file = await readJsonFile(sessionFilePath(id.data), SessionFile);
        if (file.ok && file.value !== undefined) cutOff.push(summaryOf(file.value));
      }
      return cutOff.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

    /**
     * The owner's answer to an approval its turn is waiting on (#171), by the approval's event
     * number. Recorded in the session, so every device sees it answered, and only the first answer
     * counts: answering again, from any device, gives back the one that stands. Allow always
     * (#185) needs the approval to have offered it; for the workspace, it's kept in the
     * workspace's settings before the answer is recorded, as a change to the context folder.
     */
    answerApproval: async (answering: {
      rawId: string;
      approval: number;
      answer: ApprovalAnswer;
      always?: AlwaysFor | undefined;
    }): Promise<Result<GivenAnswer, SessionError>> => {
      const found = await findSession(answering.rawId);
      if (!found.ok) return found;
      const { id, workspaceId, title } = found.value;
      const session = runningSession(id);
      return inOrder(session, async (): Promise<Result<GivenAnswer, SessionError>> => {
        const events = await readEvents(id);
        if (!events.ok) return events;
        const asked = events.value.find(
          (event) => event.type === "approval-requested" && event.seq === answering.approval,
        );
        if (asked?.type !== "approval-requested") return err({ kind: "approval-not-found" });
        const earlier = events.value.find(
          (event) => event.type === "approval-answered" && event.approval === answering.approval,
        );
        if (earlier?.type === "approval-answered") {
          return ok({
            answer: earlier.answer,
            ...(earlier.always === undefined ? {} : { always: earlier.always }),
          });
        }
        const waiting = session.approvals.get(answering.approval);
        if (waiting === undefined) return err({ kind: "approval-closed" });
        const { always } = answering;
        if (always !== undefined && asked.always === undefined) {
          return err({ kind: "always-not-offered" });
        }
        if (always === "workspace" && asked.always !== undefined) {
          const command = namedAs(asked.always);
          const kept = await options.contextFolder.change(
            () =>
              allowAlways(options.contextDir, {
                id: workspaceId,
                allowed: { command, at: new Date(options.now()).toISOString(), session: id, title },
              }),
            () => workspaceChange(`Allow always: ${command}`, workspaceId),
          );
          if (!kept.ok) return err({ kind: "workspace", error: kept.error });
        }
        const given: GivenAnswer = {
          answer: answering.answer,
          ...(always === undefined ? {} : { always }),
        };
        const recorded = await writeEvent({
          id,
          session,
          event: { type: "approval-answered", approval: answering.approval, ...given },
        });
        if (!recorded.ok) return recorded;
        session.approvals.delete(answering.approval);
        waiting(given);
        return ok(given);
      });
    },

    /**
     * Turns on Allow all for this task (#428) for a code session, for as long as the owner picked:
     * recorded, so it survives a restart, and each approval its turn waits on that it covers is
     * allowed at once. It isn't extended while it's on: Turn off first.
     */
    allowAll: async (
      rawId: string,
      lasts: AllowAllLasts,
    ): Promise<Result<SessionSummary, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const { workspaceId } = found.value;
      // A code session's own: never the Lead's, whose builders are allowed all by its order.
      if (found.value.branch === undefined || found.value.lead === true) {
        return err({ kind: "not-code-session" });
      }
      if (await isArchived(options.contextDir, workspaceId)) {
        return err({ kind: "workspace-archived" });
      }
      const started = await startAllowingAll(found.value, {
        until: allowAllUntil(lasts, options.now()),
        task: lasts === "task",
        byLead: false,
      });
      if (!started.ok) return started;
      return ok(summaryOf(found.value));
    },

    /** Turns Allow all for this task off (#428), at once. One that's off already stays off. */
    allowAllOff: async (rawId: string): Promise<Result<SessionSummary, SessionError>> => {
      const found = await findSession(rawId);
      if (!found.ok) return found;
      const ended = await stopAllowingAll(found.value.id, { byLead: false });
      if (!ended.ok) return ended;
      return ok(summaryOf(found.value));
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
      // The owner's, or an image a tool connection showed them (ADR 0023).
      const attachment = [...attachmentsOf(events.value), ...imagesShownIn(events.value)].find(
        ({ id }) => id === rawAttachmentId,
      );
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

    /** A session's events so far, as its event log has them: what the offline copy keeps (#106). */
    events: async (id: SessionId): Promise<Result<SessionEvent[], SessionError>> => {
      await settled(id);
      return readEvents(id);
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
      // A turn just ended finishes first: the pull request it opened is recorded by then (#324).
      if (session.turn.kind === "idle") await session.ended;
      // Its tasks end with it (#182), telling nobody, before its folder and worktree go.
      if (session.turn.kind === "idle") await tasks.stopAll(id, "session-ended");
      const events = await readEvents(id);
      // Nothing ever ran on its session branch, so that goes too (ADR 0007).
      const neverRan =
        events.ok &&
        events.value.filter((event) => event.type === "owner-message").length === 1 &&
        events.value.some((event) => event.type === "turn-queued") &&
        !events.value.some((event) => event.type === "turn-dequeued");
      // Deleted before its pull request, it lets its issue go (#324).
      const claim = events.ok ? claimToRelease(found.value, events.value) : undefined;
      // In the session's queue, so nothing is being written to it as its folder goes.
      const removed = await inOrder(session, async (): Promise<Result<null, SessionError>> => {
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
        if (branch !== undefined && typeof repoPath === "string") {
          const sessionBranch = sessionBranchOf({ ...found.value, branch });
          // Its helpers' branches go with it, whatever happens to its own (#395).
          if (neverRan) await options.code.clearBranch({ repoPath, sessionBranch, pushed: false });
          else await options.code.clearHelpers({ repoPath, sessionBranch });
        }
        return ok(null);
      });
      if (removed.ok && claim !== undefined) {
        await options.claims?.release(
          workspaceId,
          claim.issue,
          `the owner deleted Courtyard session (${claim.branch}) before its pull request.`,
        );
      }
      return removed;
    },

    /** Whether a turn is running in any of a workspace's sessions. */
    anyRunning: async (workspaceId: WorkspaceId): Promise<Result<boolean, SessionError>> => {
      const list = await sessionsOf(workspaceId);
      return list.ok ? ok(list.value.some((session) => session.busy)) : list;
    },

    /**
     * A workspace's sessions, its Lead first (#347), then most recently active first, each with
     * whether it's waiting.
     */
    list: sessionsOf,

    markSeen,

    /**
     * Mark all read (#345): every session in the workspace is seen up to its latest answer, so no
     * new reply waits there; an approval still does, as it waits on more than seeing.
     */
    markAllSeen: async (workspaceId: WorkspaceId): Promise<Result<null, SessionError>> => {
      const list = await sessionsOf(workspaceId);
      if (!list.ok) return list;
      for (const listed of list.value) {
        const { answer } = runningSession(listed.id).answered;
        if (answer === undefined) continue;
        const marked = await markSeen(listed.id, answer.seq);
        if (!marked.ok) return marked;
      }
      return ok(null);
    },

    /** How many code sessions are running, across the worker. */
    codeRunning: () => options.code.slots.running(),

    /** Records what the worker did for a code workspace's Lead, in its chat (#347). */
    note: async (id: SessionId, text: string): Promise<Result<null, SessionError>> => {
      const recorded = await append(id, { type: "lead-note", text });
      return recorded.ok ? ok(null) : recorded;
    },

    /**
     * Sends a code workspace's Lead the worker's message that one of its builders' pull requests
     * merged (#347), on the model its conversation last used. Refused, as `busy`, while a turn
     * runs there, so the worker tries again later rather than queueing it as the owner's.
     */
    tellMerged: async (
      id: SessionId,
      merged: { pullRequest: number; text: string },
    ): Promise<Result<null, SessionError>> => {
      const found = await findSession(id);
      if (!found.ok) return found;
      const events = await readEvents(id);
      if (!events.ok) return events;
      const last = events.value.findLast((event) => event.type === "owner-message");
      if (last?.type !== "owner-message") return err({ kind: "not-found" });
      const message: NewMessage = {
        text: merged.text,
        model: last.model,
        ...(last.effort === undefined ? {} : { effort: last.effort }),
      };
      const provider = await providerIn(found.value.workspaceId, message);
      if (!provider.ok) return provider;
      await settled(id);
      return startTurn({
        id,
        workspaceId: found.value.workspaceId,
        provider: provider.value.provider,
        message,
        since: freshStarts,
        coding: found.value.branch !== undefined,
        placeless: found.value.placeless === true,
        merged: { pullRequest: merged.pullRequest },
      });
    },

    /**
     * Stops a session building its issue (the Lead's skip, #347): its claim released, saying why
     * (#324), then whatever turn runs stopped, and waited for to end.
     */
    stopBuilding: async (id: SessionId, why: string) => {
      await releaseClaim(id, () => why);
      const session = running.get(id);
      if (session?.turn.kind !== "running") return;
      session.turn.stopper.abort();
      await session.ended;
    },

    /**
     * The model and effort a session's last message went to, which its picker changes (the Lead's
     * builders start on it, #347); `undefined` when it can't be read.
     */
    lastModelOf: async (id: SessionId): Promise<BuildIssue | undefined> => {
      const events = await readEvents(id);
      const last = events.ok
        ? events.value.findLast((event) => event.type === "owner-message")
        : undefined;
      if (last?.type !== "owner-message") return undefined;
      return { model: last.model, ...(last.effort === undefined ? {} : { effort: last.effort }) };
    },

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
        // Every session's tasks end with it (#182), before its folder moves.
        await Promise.all([...running.keys()].map((id) => tasks.stopAll(id, "session-ended")));
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
