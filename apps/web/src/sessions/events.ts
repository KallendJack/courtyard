import {
  ApiError,
  type FailureReason,
  type ModelRef,
  SessionEvent,
  type SessionId,
} from "@courtyard/contract";
import { useEffect, useReducer, useState } from "react";

/** One message from the owner and everything the model did in response to it. */
export type Turn = {
  readonly seq: number;
  readonly text: string;
  readonly model: ModelRef;
  readonly answer: string;
  readonly state:
    | { readonly kind: "running" }
    | { readonly kind: "done" }
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
 * Applies one event to the turns so far. Events already seen are ignored, so a reconnect that
 * repeats one changes nothing. Only the last turn's object changes, so the rest don't re-render.
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
          { seq, text: event.text, model: event.model, answer: "", state: { kind: "running" } },
        ],
      };
    case "text-delta":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, answer: turn.answer + event.text }),
      });
    case "turn-completed":
      return withLastTurn(log, { seq, change: (turn) => ({ ...turn, state: { kind: "done" } }) });
    case "turn-failed":
      return withLastTurn(log, {
        seq,
        change: (turn) => ({ ...turn, state: { kind: "failed", reason: event.reason } }),
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

/**
 * Follows a session's events: its whole event log first, then live as the worker records them.
 * Also returns the worker's reason when the stream can't start at all.
 */
export const useSessionTurns = (sessionId: SessionId) => {
  const [log, dispatch] = useReducer(applyEvent, { lastSeq: 0, turns: [] });
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    // The browser reconnects by itself, sending the last event id it saw (ADR 0006).
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events?after=0`);
    source.onmessage = (message) => {
      const event = SessionEvent.safeParse(parseJson(message.data));
      if (event.success) dispatch(event.data);
    };
    source.addEventListener("problem", (message) => {
      const error = ApiError.safeParse(parseJson(message.data));
      setProblem(error.success ? error.data.error : "This session can't be opened.");
      source.close();
    });
    return () => source.close();
  }, [sessionId]);

  return { turns: log.turns, problem };
};
