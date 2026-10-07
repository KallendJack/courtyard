import {
  type Activity,
  ApiError,
  type Effort,
  type FailureReason,
  type ModelRef,
  type PlacedLine,
  type Save,
  SessionEvent,
  type SessionId,
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

/** One message from the owner and everything the model did in response to it. */
export type Turn = {
  readonly seq: number;
  readonly text: string;
  readonly model: ModelRef;
  /** The effort it was sent with; `undefined` for the model's default. */
  readonly effort: Effort | undefined;
  readonly answer: string;
  /** What the model did along the way, such as files it read. */
  readonly activities: readonly Activity[];
  /** The saves it made, in order. */
  readonly notes: readonly Note[];
  readonly state:
    | { readonly kind: "running" }
    | { readonly kind: "done" }
    | { readonly kind: "stopped" }
    | { readonly kind: "failed"; readonly reason: FailureReason };
};

type Log = { readonly lastSeq: number; readonly turns: readonly Turn[] };

/** Swaps in a new last turn and leaves every other turn object as it was. */
const withLastTurn = (log: Log, update: { seq: number; change: (turn: Turn) => Turn }): Log => {
  const last = log.turns.at(-1);
  if (!last) return { ...log, lastSeq: update.seq };
  return { lastSeq: update.seq, turns: [...log.turns.slice(0, -1), update.change(last)] };
};

/**
 * Swaps in a new version of the turn holding the note numbered `save`, which can be any turn: the
 * owner undoes and edits saves whenever they like. Every other turn object stays as it was.
 */
const withNote = (
  log: Log,
  update: { seq: number; save: number; change: (note: Note) => Note },
): Log => ({
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

/**
 * Applies one event to the turns so far. Events already seen are ignored, so a reconnect that
 * repeats one changes nothing. Only the turn an event belongs to changes, so the rest don't re-render.
 */
export const applyEvent = (log: Log, event: SessionEvent): Log => {
  if (event.seq <= log.lastSeq) return log;
  const seq = event.seq;
  switch (event.type) {
    case "owner-message":
      return {
        lastSeq: seq,
        turns: [
          ...log.turns,
          {
            seq,
            text: event.text,
            model: event.model,
            effort: event.effort,
            answer: "",
            activities: [],
            notes: [],
            state: { kind: "running" },
          },
        ],
      };
    case "text-delta":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, answer: turn.answer + event.text }),
      });
    case "activity":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, activities: [...turn.activities, event.activity] }),
      });
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
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** How long to wait before opening a stream again after the browser gave up on one. */
const RECONNECT_MS = 3000;

/**
 * Follows a session's events: its whole event log first, then live as the worker records them.
 * Also says when it's reconnecting, and the worker's reason when the stream can't start at all.
 */
export const useSessionTurns = (sessionId: SessionId) => {
  const [log, dispatch] = useReducer(applyEvent, { lastSeq: 0, turns: [] });
  const [problem, setProblem] = useState<string>();
  const [reconnecting, setReconnecting] = useState(false);
  const lastSeen = useRef(0);

  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      // Starts after the last event seen, so a new connection carries on where the old one ended.
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/events?after=${lastSeen.current}`;
      const opened = new EventSource(url);
      source = opened;
      opened.onopen = () => setReconnecting(false);
      opened.onmessage = (message) => {
        const event = SessionEvent.safeParse(parseJson(message.data));
        if (!event.success) return;
        lastSeen.current = Math.max(lastSeen.current, event.data.seq);
        dispatch(event.data);
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
      source?.close();
    };
  }, [sessionId]);

  return { turns: log.turns, problem, reconnecting };
};
