import {
  type Activity,
  type AlwaysAllow,
  ApiError,
  type ApprovalAsk,
  type Attachment,
  type DocumentSave,
  type Doing,
  type Effort,
  type FailureReason,
  type HelperId,
  type ModelRef,
  type PhotoAttachment,
  type PlacedLine,
  type PullRequest,
  type Save,
  SessionEvent,
  type SessionId,
  type SkillName,
  type Source,
  type ThingSave,
} from "@courtyard/contract";
import { useEffect, useReducer, useRef, useState } from "react";
import type { Queued } from "@/components/chat/queued-message";

/**
 * A save the model made, shown as a note under its answer, and what the owner has done with it
 * since: kept, undone, or edited to a new line.
 */
export type Note = {
  /** The save's event number, which Undo and Edit name it by. */
  readonly seq: number;
  readonly save: Save;
  readonly state:
    | { readonly kind: "kept" }
    | { readonly kind: "undone" }
    | { readonly kind: "edited"; readonly now: PlacedLine };
};

/**
 * A document saved from an answer (ADR 0020), by the model or with Save as document, shown as a
 * note under it, and whether the owner has undone it since.
 */
export type DocumentNote = {
  /** The save's event number, which Undo names it by. */
  readonly seq: number;
  readonly save: DocumentSave;
  readonly undone: boolean;
};

/** A Thing the model saved in its answer (ADR 0020), shown as a note under it, and whether the owner has undone it since. */
export type ThingNote = {
  /** The save's event number, which Undo names it by. */
  readonly seq: number;
  readonly save: ThingSave;
  readonly undone: boolean;
};

/** An image a tool connection showed (ADR 0023), by what it shows. */
export type ShownImage = {
  readonly connection: string;
  readonly of: string;
  readonly image: PhotoAttachment;
};

/**
 * A piece of a turn's answer: text the model wrote, or what it did next (such as files it read),
 * up to the text after it.
 */
export type AnswerPart =
  | {
      readonly kind: "text";
      readonly text: string;
      /**
       * How much of the text was replayed from the event log (opening the session, or
       * reconnecting) rather than streamed live. It shows at once; only the rest is revealed.
       */
      readonly replayed: number;
    }
  | { readonly kind: "activities"; readonly activities: readonly MarkedActivity[] }
  /** Helpers the model started (#117), each by its id in the turn's `helpers`. */
  | { readonly kind: "helpers"; readonly helpers: readonly HelperId[] }
  /**
   * A message the owner added while it answered (#252), where it was sent: whether an approval
   * waited as it was sent, and whether the turn ended before the model read it.
   */
  | {
      readonly kind: "added";
      readonly seq: number;
      readonly text: string;
      readonly afterApproval: boolean;
      readonly unread: boolean;
    };

/**
 * Something a model did (an activity), marked when it ran without asking because the session was
 * allowing all (#428): "ran under Allow all".
 */
export type MarkedActivity = Activity & { readonly allowedAll?: true };

/**
 * A helper the model started (#117): its name, whether it waits for a place among the helpers,
 * everything it did (and waited for) in order, and its final report once it has finished.
 */
export type Helper = {
  readonly id: HelperId;
  readonly name: string;
  readonly waiting: boolean;
  /**
   * Where its work goes (#395): the session's own worktree, which it shares; a branch of its own;
   * that branch merged back into the session's; or kept, as it clashed, for the session to sort.
   */
  readonly branch: HelperBranch;
  readonly activities: readonly MarkedActivity[];
  readonly report: string | undefined;
};

/** Where a helper's work goes (#395), as its line shows it. */
export type HelperBranch = "shared" | "own" | "merged" | "clashed";

/** A helper started after a turn's parts so far: with the ones just before it, or after the rest. */
const withHelper = (parts: readonly AnswerPart[], helper: HelperId): readonly AnswerPart[] => {
  const last = parts.at(-1);
  if (last?.kind !== "helpers") return [...parts, { kind: "helpers", helpers: [helper] }];
  return [...parts.slice(0, -1), { kind: "helpers", helpers: [...last.helpers, helper] }];
};

/** A turn's helpers with the one numbered `helper` changed, leaving the rest as they were. */
const changeHelper = (
  helpers: readonly Helper[],
  helper: HelperId,
  change: (helper: Helper) => Helper,
) => helpers.map((each) => (each.id === helper ? change(each) : each));

/** Text after a turn's parts so far: added to the text it's writing, or a new piece. */
const withText = (
  parts: readonly AnswerPart[],
  text: string,
  replayed: boolean,
): readonly AnswerPart[] => {
  const last = parts.at(-1);
  if (last?.kind === "text") {
    const whole = last.text + text;
    return [
      ...parts.slice(0, -1),
      { kind: "text", text: whole, replayed: replayed ? whole.length : last.replayed },
    ];
  }
  // A new piece starts at its first words, not at the break before them.
  const start = text.trimStart();
  if (start === "") return parts;
  return [...parts, { kind: "text", text: start, replayed: replayed ? start.length : 0 }];
};

/**
 * An activity after a turn's parts so far: with the ones just before it, or after the text. A
 * build's newer place in the queue takes the older one's line (#281).
 */
const withActivity = (
  parts: readonly AnswerPart[],
  activity: MarkedActivity,
): readonly AnswerPart[] => {
  const last = parts.at(-1);
  if (last?.kind !== "activities") {
    return [...parts, { kind: "activities", activities: [activity] }];
  }
  const moved =
    activity.kind === "waiting-for-build" && last.activities.at(-1)?.kind === "waiting-for-build";
  const before = moved ? last.activities.slice(0, -1) : last.activities;
  return [...parts.slice(0, -1), { kind: "activities", activities: [...before, activity] }];
};

/** One message from the owner and everything the model did in response to it. */
export type Turn = {
  readonly seq: number;
  readonly text: string;
  readonly model: ModelRef;
  /** The effort it was sent with; `undefined` for the model's default. */
  readonly effort: Effort | undefined;
  /** The skill the owner started with it, if any (ADR 0016). */
  readonly skill: SkillName | undefined;
  /** The photos and PDFs it carried (#78). */
  readonly attachments: readonly Attachment[];
  /** Whether it went to another model than the turn before it, by a pick or by Carry on. */
  readonly modelChanged: boolean;
  /** Everything the model wrote, each piece between its parts a paragraph of its own. */
  readonly answer: string;
  /** What the model wrote and did, in order: its text between its parts, as Claude shows it (#200). */
  readonly parts: readonly AnswerPart[];
  /** The helpers it started (#117), in order, each line of which its `parts` place. */
  readonly helpers: readonly Helper[];
  /** The saves it made, in order. */
  readonly notes: readonly Note[];
  /** The documents saved from it, in order. */
  readonly documents: readonly DocumentNote[];
  /** The Things its model saved, in order. */
  readonly things: readonly ThingNote[];
  /** Replies the model suggested the owner tap (ADR 0017); none when it suggested none. */
  readonly replies: readonly string[];
  /** The web pages the answer used, listed under it (ADR 0019); none when it used none. */
  readonly sources: readonly Source[];
  /**
   * The images its tool connections showed, such as screenshots of Paper boards (ADR 0023): the
   * newest of each thing shown, in the order each was first shown.
   */
  readonly images: readonly ShownImage[];
  /**
   * The approval the turn is waiting on (#171), by its event number, until the owner answers it
   * from any device; `undefined` when it waits on none.
   */
  readonly approval:
    | {
        readonly seq: number;
        readonly ask: ApprovalAsk;
        readonly why: string | undefined;
        /** The helper asking (#117), or none for the model itself. */
        readonly helper: HelperId | undefined;
        /** What Allow always would allow (#185), when it's offered. */
        readonly always: AlwaysAllow | undefined;
        /** Allow all for this task would cover it (#428), so the card offers turning it on. */
        readonly all: boolean;
      }
    | undefined;
  /**
   * Whether the worker sent it, not the owner, because the session's pull request's checks
   * failed (#172): the failed checks open its activity in place of the owner's message.
   */
  readonly fixesChecks: boolean;
  /**
   * Whether the worker sent it, not the owner, so their message isn't shown: a failed check's
   * (#172), or a Lead's builder's merged pull request (#347).
   */
  readonly fromWorker: boolean;
  /** What the worker did for a code workspace's Lead after this turn (#347), each in its words. */
  readonly leadNotes: readonly string[];
  /** When the owner's message was recorded, which the Working line counts from (#179). */
  readonly startedAt: string;
  /**
   * What its model is doing now, while it runs: its latest activity, or writing its answer; or,
   * before it starts, waiting for a place among the code sessions running (#362).
   */
  readonly doing: Doing;
  readonly state:
    | { readonly kind: "running" }
    | { readonly kind: "done"; readonly at: string }
    | { readonly kind: "stopped"; readonly at: string }
    | { readonly kind: "failed"; readonly reason: FailureReason; readonly at: string };
};

type Log = {
  readonly lastSeq: number;
  readonly turns: readonly Turn[];
  /** The title a model gave the session after its first answer, if one has. */
  readonly modelTitle: string | undefined;
  /** A code session's pull request as it last stood (#172), once it has one. */
  readonly pullRequest: PullRequest | undefined;
  /**
   * The event number Allow all for this task last turned on or off at (#428), or 0: the session's
   * page asks the worker again then, which decides whether it's on.
   */
  readonly allowAllChanged: number;
  /** The owner's messages waiting for the running turn to end (#177), first first. */
  readonly queuedMessages: readonly QueuedMessage[];
};

/** A message the owner sent while a turn ran (#177), waiting to go, by its event number. */
export type QueuedMessage = Queued;

/** Writing its answer, kept as one object so text arriving doesn't make a new one each time. */
const WRITING: Doing = { kind: "writing" };

/** Swaps in a new last turn and leaves every other turn object as it was. */
const withLastTurn = (log: Log, update: { seq: number; change: (turn: Turn) => Turn }): Log => {
  const last = log.turns.at(-1);
  if (!last) return { ...log, lastSeq: update.seq };
  return { ...log, lastSeq: update.seq, turns: [...log.turns.slice(0, -1), update.change(last)] };
};

/**
 * Swaps in a new version of the turn holding the note numbered `save`, which can be any turn: the
 * owner undoes and edits saves whenever they like. Every other turn object stays as it was.
 */
const withNote = (
  log: Log,
  update: { seq: number; save: number; change: (note: Note) => Note },
): Log => ({
  ...log,
  lastSeq: update.seq,
  turns: log.turns.map((turn) =>
    turn.notes.some((note) => note.seq === update.save)
      ? {
          ...turn,
          notes: turn.notes.map((note) => (note.seq === update.save ? update.change(note) : note)),
        }
      : turn,
  ),
});

/** Swaps in a new version of the turn `holds` picks (given whether it's the last), leaving the rest. */
const withTurn = (
  log: Log,
  update: {
    seq: number;
    holds: (turn: Turn, last: boolean) => boolean;
    change: (turn: Turn) => Turn;
  },
): Log => ({
  ...log,
  lastSeq: update.seq,
  turns: log.turns.map((turn, index) =>
    update.holds(turn, index === log.turns.length - 1) ? update.change(turn) : turn,
  ),
});

/**
 * Applies one event to the turns so far. Events already seen are ignored, so a reconnect that
 * repeats one changes nothing. Only the turn an event belongs to changes, so the rest don't re-render.
 */
const applyEvent = (log: Log, update: { event: SessionEvent; replayed: boolean }): Log => {
  const { event, replayed } = update;
  if (event.seq <= log.lastSeq) return log;
  const seq = event.seq;
  switch (event.type) {
    case "owner-message": {
      const before = log.turns.at(-1)?.model;
      const { queued } = event;
      return {
        ...log,
        lastSeq: seq,
        // Sent from the queue, so it waits no more.
        queuedMessages:
          queued === undefined
            ? log.queuedMessages
            : log.queuedMessages.filter((message) => message.seq !== queued),
        turns: [
          ...log.turns,
          {
            seq,
            text: event.text,
            model: event.model,
            effort: event.effort,
            skill: event.skill,
            attachments: event.attachments ?? [],
            modelChanged:
              before !== undefined &&
              (before.provider !== event.model.provider || before.model !== event.model.model),
            answer: "",
            parts: [],
            helpers: [],
            notes: [],
            documents: [],
            things: [],
            replies: [],
            sources: [],
            images: [],
            approval: undefined,
            fixesChecks: event.checksFailed !== undefined,
            fromWorker: event.checksFailed !== undefined || event.merged !== undefined,
            leadNotes: [],
            startedAt: event.at,
            doing: { kind: "thinking" },
            state: { kind: "running" },
          },
        ],
      };
    }
    case "message-queued":
      return {
        ...log,
        lastSeq: seq,
        queuedMessages: [
          ...log.queuedMessages,
          { seq, text: event.text, attachments: event.attachments?.length ?? 0 },
        ],
      };
    case "message-added":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          parts: [
            ...turn.parts,
            {
              kind: "added",
              seq,
              text: event.text,
              afterApproval: event.afterApproval === true,
              unread: false,
            },
          ],
        }),
      });
    case "added-not-read":
      return withTurn(log, {
        seq,
        holds: (turn) =>
          turn.parts.some((part) => part.kind === "added" && part.seq === event.added),
        change: (turn) => ({
          ...turn,
          parts: turn.parts.map((part) =>
            part.kind === "added" && part.seq === event.added ? { ...part, unread: true } : part,
          ),
        }),
      });
    case "queued-message-removed":
      return {
        ...log,
        lastSeq: seq,
        queuedMessages: log.queuedMessages.filter((message) => message.seq !== event.queued),
      };
    // The owner message after it shows the change; nothing else to show.
    case "model-changed":
      return { ...log, lastSeq: seq };
    case "session-titled":
      return { ...log, lastSeq: seq, modelTitle: event.title };
    case "pull-request":
      return { ...log, lastSeq: seq, pullRequest: event.pullRequest };
    case "allow-all-started":
    case "allow-all-ended":
      return { ...log, lastSeq: seq, allowAllChanged: seq };
    case "text-delta":
      return withLastTurn(log, {
        seq,
        change: (turn) => {
          // Text after an activity or a helper is a paragraph of its own in the answer too, as
          // copied or saved.
          const after =
            (turn.parts.at(-1)?.kind ?? "text") !== "text" && !/(^|\n\n)$/.test(turn.answer);
          return {
            ...turn,
            answer: `${turn.answer}${after ? "\n\n" : ""}${event.text}`,
            parts: withText(turn.parts, event.text, replayed),
            doing: WRITING,
          };
        },
      });
    case "activity": {
      const { helper } = event;
      const marked: MarkedActivity = event.allowedAll
        ? { ...event.activity, allowedAll: true }
        : event.activity;
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          // A helper's goes on its own line (#117), the model's between what it writes.
          ...(helper !== undefined && turn.helpers.some((each) => each.id === helper)
            ? {
                helpers: changeHelper(turn.helpers, helper, (each) => ({
                  ...each,
                  activities: [...each.activities, marked],
                })),
              }
            : { parts: withActivity(turn.parts, marked) }),
          doing: { kind: "activity", activity: event.activity },
        }),
      });
    }
    case "helper-started": {
      const waiting = event.waiting === true;
      return withLastTurn(log, {
        seq,
        // Recorded again once one that waited has its place.
        change: (turn) =>
          turn.helpers.some((each) => each.id === event.helper)
            ? {
                ...turn,
                helpers: changeHelper(turn.helpers, event.helper, (each) => ({ ...each, waiting })),
              }
            : {
                ...turn,
                parts: withHelper(turn.parts, event.helper),
                helpers: [
                  ...turn.helpers,
                  {
                    id: event.helper,
                    name: event.name,
                    waiting,
                    branch: "shared",
                    activities: [],
                    report: undefined,
                  },
                ],
              },
      });
    }
    case "helper-branched":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          helpers: changeHelper(turn.helpers, event.helper, (each) => ({ ...each, branch: "own" })),
        }),
      });
    case "helper-finished": {
      const { merged } = event;
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          helpers: changeHelper(turn.helpers, event.helper, (each) => ({
            ...each,
            report: event.report,
            ...(merged === undefined ? {} : { branch: merged ? "merged" : "clashed" }),
          })),
        }),
      });
    }
    case "suggested-replies":
      return withLastTurn(log, { seq, change: (turn) => ({ ...turn, replies: event.replies }) });
    case "sources":
      return withLastTurn(log, { seq, change: (turn) => ({ ...turn, sources: event.sources }) });
    case "image-shown": {
      const shown: ShownImage = { connection: event.connection, of: event.of, image: event.image };
      // A newer screenshot of the same thing takes the older one's place.
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          images: turn.images.some((each) => each.of === shown.of)
            ? turn.images.map((each) => (each.of === shown.of ? shown : each))
            : [...turn.images, shown],
        }),
      });
    }
    case "approval-requested":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          approval: {
            seq,
            ask: event.ask,
            why: event.why,
            helper: event.helper,
            always: event.always,
            all: event.all === true,
          },
        }),
      });
    case "approval-answered":
      return withTurn(log, {
        seq,
        holds: (turn) => turn.approval?.seq === event.approval,
        change: (turn) => ({ ...turn, approval: undefined }),
      });
    // Waiting for a place among the code sessions running, and moving up, until it starts (#362).
    case "turn-queued": {
      const { ahead } = event;
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          doing:
            ahead === undefined
              ? { kind: "waiting-for-place" }
              : { kind: "waiting-for-place", ahead },
        }),
      });
    }
    case "turn-dequeued":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, doing: { kind: "thinking" } }),
      });
    case "turn-completed":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, state: { kind: "done", at: event.at } }),
      });
    case "turn-stopped":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, state: { kind: "stopped", at: event.at } }),
      });
    case "turn-failed":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          state: { kind: "failed", reason: event.reason, at: event.at },
        }),
      });
    case "context-saved":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({
          ...turn,
          notes: [...turn.notes, { seq, save: event.save, state: { kind: "kept" } }],
        }),
      });
    case "context-undone":
      return withNote(log, {
        seq,
        save: event.save,
        change: (note) => ({ ...note, state: { kind: "undone" } }),
      });
    case "context-edited":
      return withNote(log, {
        seq,
        save: event.save,
        change: (note) => ({ ...note, state: { kind: "edited", now: event.now } }),
      });
    case "document-saved": {
      const note: DocumentNote = { seq, save: event.save, undone: false };
      // Saved with Save as document, under the answer it was saved from; else by this turn's model.
      const { answer } = event;
      return withTurn(log, {
        seq,
        holds: (turn, last) => (answer === undefined ? last : turn.seq === answer),
        change: (turn) => ({ ...turn, documents: [...turn.documents, note] }),
      });
    }
    case "document-undone":
      return withTurn(log, {
        seq,
        holds: (turn) => turn.documents.some((note) => note.seq === event.save),
        change: (turn) => ({
          ...turn,
          documents: turn.documents.map((note) =>
            note.seq === event.save ? { ...note, undone: true } : note,
          ),
        }),
      });
    case "thing-saved": {
      const note: ThingNote = { seq, save: event.save, undone: false };
      return withTurn(log, {
        seq,
        holds: (_, last) => last,
        change: (turn) => ({ ...turn, things: [...turn.things, note] }),
      });
    }
    // What the worker did for a code workspace's Lead (#347), under the turn before it.
    case "lead-note":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, leadNotes: [...turn.leadNotes, event.text] }),
      });
    case "thing-undone":
      return withTurn(log, {
        seq,
        holds: (turn) => turn.things.some((note) => note.seq === event.save),
        change: (turn) => ({
          ...turn,
          things: turn.things.map((note) =>
            note.seq === event.save ? { ...note, undone: true } : note,
          ),
        }),
      });
  }
};

/** The events that arrived in one frame, and whether they were replayed from the event log. */
type Batch = { readonly events: readonly SessionEvent[]; readonly replayed: boolean };

const applyBatch = (log: Log, batch: Batch): Log =>
  batch.events.reduce((next, event) => applyEvent(next, { event, replayed: batch.replayed }), log);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const NO_EVENTS: Log = {
  lastSeq: 0,
  turns: [],
  modelTitle: undefined,
  pullRequest: undefined,
  allowAllChanged: 0,
  queuedMessages: [],
};

/**
 * Each session's log as last shown, for the tab's lifetime (owner, 2026-10-12: nothing jumps in):
 * coming back to a session shows it at once, and its stream carries on after it.
 */
const shownLogs = new Map<SessionId, Log>();

/** A log shown again: all of its text shows at once, none of it revealed again. */
const shownAgain = (log: Log): Log => ({
  ...log,
  turns: log.turns.map((turn) => ({
    ...turn,
    parts: turn.parts.map((part) =>
      part.kind === "text" ? { ...part, replayed: part.text.length } : part,
    ),
  })),
});

/** How long to wait before opening a stream again after the browser gave up on one. */
const RECONNECT_MS = 3000;
/** The longest a replay of the event log is taken to last after (re)connecting. */
const REPLAY_MS = 500;

/**
 * Follows a session's events: its whole event log first, then live as the worker records them.
 * Also says when it's reconnecting, and the worker's reason when the stream can't start at all.
 *
 * Events are applied once per frame, however many arrive, so a burst redraws the page once. The
 * worker sends what's already in the event log in one burst on (re)connecting, so everything up to
 * the first quiet frame after it (and within `REPLAY_MS`) counts as replayed: its text shows at
 * once rather than revealed. A session shown before in this tab starts from where it was shown,
 * and is ready at once; one opened for the first time is ready once its replay has arrived.
 */
export const useSessionTurns = (sessionId: SessionId) => {
  const [log, dispatch] = useReducer(applyBatch, sessionId, (id) => {
    const shown = shownLogs.get(id);
    return shown === undefined ? NO_EVENTS : shownAgain(shown);
  });
  const [problem, setProblem] = useState<string>();
  const [reconnecting, setReconnecting] = useState(false);
  /** Whether the session's events so far have arrived, so its conversation can show. */
  const [ready, setReady] = useState(() => shownLogs.has(sessionId));
  const lastSeen = useRef(log.lastSeq);

  useEffect(() => {
    if (log !== NO_EVENTS) shownLogs.set(sessionId, log);
  }, [sessionId, log]);

  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    /** Shows the conversation once a stream that sends nothing has had time to. */
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let queued: SessionEvent[] = [];
    let frame: number | undefined;
    let replaying = true;
    let connectedAt = performance.now();
    // A hidden page draws no frames, so what arrives meanwhile waits for the owner's return, and
    // then shows at once like a replay.
    let hidden = document.hidden;
    const onVisibility = () => {
      hidden ||= document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const flush = () => {
      frame = undefined;
      // However busy the stream, a replay is over within moments of (re)connecting.
      if (performance.now() - connectedAt > REPLAY_MS) replaying = false;
      if (queued.length === 0) {
        replaying = false;
        hidden = false;
        // The replay is all in, so the conversation shows as a whole.
        setReady(true);
        return;
      }
      dispatch({ events: queued, replayed: replaying || hidden });
      hidden = false;
      queued = [];
      // While replaying, look again next frame: a frame with nothing new ends the replay.
      if (replaying) frame = requestAnimationFrame(flush);
    };

    const connect = () => {
      // Starts after the last event seen, so a new connection carries on where the old one ended.
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/events?after=${lastSeen.current}`;
      const opened = new EventSource(url);
      source = opened;
      // Also when the browser reconnects by itself: it's sent what was missed first.
      opened.onopen = () => {
        replaying = true;
        connectedAt = performance.now();
        setReconnecting(false);
        clearTimeout(quiet);
        quiet = setTimeout(() => setReady(true), REPLAY_MS);
      };
      opened.onmessage = (message) => {
        const event = SessionEvent.safeParse(parseJson(message.data));
        if (!event.success) return;
        lastSeen.current = Math.max(lastSeen.current, event.data.seq);
        queued.push(event.data);
        frame ??= requestAnimationFrame(flush);
      };
      opened.addEventListener("problem", (message) => {
        const error = ApiError.safeParse(parseJson(message.data));
        setProblem(error.success ? error.data.error : "This session can't be opened.");
        stopped = true;
        opened.close();
      });
      opened.onerror = () => {
        if (stopped) return;
        setReconnecting(true);
        // After a dropped connection the browser retries by itself (sending the last event id it
        // saw, ADR 0006). After an error answer, such as a proxy's 502 while the worker is down,
        // it gives up for good, so start again by hand.
        if (opened.readyState === EventSource.CLOSED) retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(quiet);
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      source?.close();
    };
  }, [sessionId]);

  return {
    turns: log.turns,
    /** The last event number shown, which the page tells the worker the owner has seen (#334). */
    lastSeq: log.lastSeq,
    modelTitle: log.modelTitle,
    pullRequest: log.pullRequest,
    allowAllChanged: log.allowAllChanged,
    queuedMessages: log.queuedMessages,
    problem,
    reconnecting,
    ready,
  };
};
