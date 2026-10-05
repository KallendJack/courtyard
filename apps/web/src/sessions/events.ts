import {
  type FailureReason,
  type ModelRef,
  SessionEvent,
  type SessionId,
} from "@courtyard/contract";
import { useEffect, useReducer } from "react";

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
const withLastTurn = (log: Log, change: (turn: Turn) => Turn, seq: number): Log => {
  const last = log.turns.at(-1);
  if (!last) return { ...log, lastSeq: seq };
  return { lastSeq: seq, turns: [...log.turns.slice(0, -1), change(last)] };
};

/**
 * Applies one event to the turns so far. Events already seen are ignored, so a reconnect that
 * repeats one changes nothing. Only the last turn's object changes, so the rest don't re-render.
 */
export const applyEvent = (log: Log, event: SessionEvent): Log => {
  if (event.seq <= log.lastSeq) return log;
  switch (event.type) {
    case "user-message":
      return {
        lastSeq: event.seq,
        turns: [
          ...log.turns,
          {
            seq: event.seq,
            text: event.text,
            model: event.model,
            answer: "",
            state: { kind: "running" },
          },
        ],
      };
    case "text-delta":
      return withLastTurn(
        log,
        (turn) => ({ ...turn, answer: turn.answer + event.text }),
        event.seq,
      );
    case "turn-completed":
      return withLastTurn(log, (turn) => ({ ...turn, state: { kind: "done" } }), event.seq);
    case "turn-failed":
      return withLastTurn(
        log,
        (turn) => ({ ...turn, state: { kind: "failed", reason: event.reason } }),
        event.seq,
      );
  }
};

/** Follows a session's events: its whole history first, then live as the worker records them. */
export const useSessionTurns = (sessionId: SessionId) => {
  const [log, dispatch] = useReducer(applyEvent, { lastSeq: 0, turns: [] });

  useEffect(() => {
    // The browser reconnects by itself, sending the last event id it saw (ADR 0006).
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events?after=0`);
    source.onmessage = (message) => {
      try {
        const event = SessionEvent.safeParse(JSON.parse(message.data));
        if (event.success) dispatch(event.data);
      } catch {
        // Not an event; ignore it.
      }
    };
    return () => source.close();
  }, [sessionId]);

  return log.turns;
};
