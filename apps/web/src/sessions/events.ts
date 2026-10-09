import {
  type Activity,
  ApiError,
  type Attachment,
  type DocumentSave,
  type Effort,
  type FailureReason,
  type ModelRef,
  type PlacedLine,
  type Save,
  SessionEvent,
  type SessionId,
  type SkillName,
  type Source,
  type ThingSave,
} from "@courtyard/contract";
import { useEffect, useReducer, useRef, useState } from "react";

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
  readonly answer: string;
  /**
   * How much of the answer was replayed from the event log (opening the session, or reconnecting)
   * rather than streamed live. It shows at once; only the rest is revealed.
   */
  readonly replayed: number;
  /** What the model did along the way, such as files it read. */
  readonly activities: readonly Activity[];
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
  readonly state:
    | { readonly kind: "running" }
    | { readonly kind: "done" }
    | { readonly kind: "stopped" }
    | { readonly kind: "failed"; readonly reason: FailureReason };
};

type Log = {
  readonly lastSeq: number;
  readonly turns: readonly Turn[];
  /** The title a model gave the session after its first answer, if one has. */
  readonly modelTitle: string | undefined;
};

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
      return {
        ...log,
        lastSeq: seq,
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
            replayed: 0,
            activities: [],
            notes: [],
            documents: [],
            things: [],
            replies: [],
            sources: [],
            state: { kind: "running" },
          },
        ],
      };
    }
    // The owner message after it shows the change; nothing else to show.
    case "model-changed":
      return { ...log, lastSeq: seq };
    case "session-titled":
      return { ...log, lastSeq: seq, modelTitle: event.title };
    case "text-delta":
      return withLastTurn(log, {
        seq,
        change: (turn) => {
          const answer = turn.answer + event.text;
          return { ...turn, answer, replayed: replayed ? answer.length : turn.replayed };
        },
      });
    case "activity":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, activities: [...turn.activities, event.activity] }),
      });
    case "suggested-replies":
      return withLastTurn(log, { seq, change: (turn) => ({ ...turn, replies: event.replies }) });
    case "sources":
      return withLastTurn(log, { seq, change: (turn) => ({ ...turn, sources: event.sources }) });
    case "turn-completed":
      return withLastTurn(log, { seq, change: (turn) => ({ ...turn, state: { kind: "done" } }) });
    case "turn-stopped":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, state: { kind: "stopped" } }),
      });
    case "turn-failed":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, state: { kind: "failed", reason: event.reason } }),
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
 * once rather than revealed.
 */
export const useSessionTurns = (sessionId: SessionId) => {
  const [log, dispatch] = useReducer(applyBatch, {
    lastSeq: 0,
    turns: [],
    modelTitle: undefined,
  });
  const [problem, setProblem] = useState<string>();
  const [reconnecting, setReconnecting] = useState(false);
  const lastSeen = useRef(0);

  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
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
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      source?.close();
    };
  }, [sessionId]);

  return { turns: log.turns, modelTitle: log.modelTitle, problem, reconnecting };
};
