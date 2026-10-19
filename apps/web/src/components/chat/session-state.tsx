import {
  type ApprovalAsk,
  type Doing,
  type SessionWaiting,
  skillTitle,
  type TurnNow,
} from "@courtyard/contract";
import { useEffect, useState } from "react";
import { classes } from "@/lib/classes";
import { elapsedWords } from "../../lib/when.ts";
import { ChatFlowScope } from "./chat-flow-scope.tsx";

// Whose turn it is in a session (#179, Paper board Handheld · 20): Working in violet, Needs you in
// gold, Your turn in white, the same in the chat, the workspace's sessions and the sidebar.

/** What a working model is doing now, in a few words, as the Working line says it. */
export const doingWords = (doing: Doing) => {
  if (doing.kind === "thinking") return "thinking";
  if (doing.kind === "writing") return "writing the answer";
  if (doing.kind === "waiting-for-place") {
    return doing.ahead === undefined
      ? "waiting for a place"
      : `waiting for a place · ${doing.ahead} ahead`;
  }
  const { activity } = doing;
  switch (activity.kind) {
    case "read-file":
      return `reading ${activity.path}`;
    case "skill-loaded":
      return `using ${skillTitle(activity.name)}`;
    case "skill-file-read":
      return `reading ${skillTitle(activity.name)}'s ${activity.path}`;
    case "web-searched":
      return `searching the web for “${activity.query}”`;
    case "page-read":
      return `reading ${activity.site}`;
    case "edited-file":
      return `editing ${activity.path}`;
    case "ran-command":
      return `running ${activity.command}`;
    case "waiting-for-build":
      return `waiting for another build · ${activity.ahead} ahead`;
    case "updated-tasks":
      return "updating the task list";
    case "check-failed":
      return `fixing the ${activity.name} check`;
    case "used-tool":
      return `using ${activity.connection}: ${activity.action}`;
  }
};

/** What a session waiting on the owner asks to do, in a few words. */
export const askWords = (ask: ApprovalAsk) => {
  switch (ask.kind) {
    case "command":
      return `asks to run ${ask.command}`;
    case "tool":
      return `asks to ${ask.action} in ${ask.connection}`;
    default:
      return `asks to change ${ask.path}`;
  }
};

/** How long it's been since `since`, as `elapsedWords` says it, ticking every second. */
export const useElapsed = (since: string) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return elapsedWords(now - Date.parse(since));
};

const TONES = {
  working: { dot: "bg-primary shadow-glow", text: "text-primary-text" },
  "needs-you": { dot: "bg-warning", text: "text-warning" },
  "your-turn": { dot: "bg-foreground", text: "text-foreground" },
} as const;

const NAMES = { working: "Working", "needs-you": "Needs you", "your-turn": "Your turn" } as const;

/**
 * A listed session's dot, as the worker says it waits (#492): gold while it needs the owner (an
 * approval, a turn cut off by a restart, or a builder stalled, #474), violet while it's working or
 * has a new reply; none otherwise. Its word, for a list with room to say it: Approve, Continue,
 * Stalled, Running, New reply.
 */
export const waitingMark = (session: { now: TurnNow; waiting: SessionWaiting }) => {
  if (session.waiting === "approval") {
    return { tone: "needs-you", name: "Needs you", word: "Approve" } as const;
  }
  if (session.waiting === "cut-off") {
    return { tone: "needs-you", name: "Needs you", word: "Continue" } as const;
  }
  if (session.waiting === "stalled") {
    return { tone: "needs-you", name: "Needs you", word: "Stalled" } as const;
  }
  if (session.now.kind === "working") {
    return { tone: "working", name: "Working", word: "Running" } as const;
  }
  if (session.waiting === "reply") {
    return { tone: "working", name: "New reply", word: "New reply" } as const;
  }
  return undefined;
};

/** The dot `waitingMark` says, in a slot of its own so titles line up; an empty slot otherwise. */
export function SessionWaitingDot(props: { now: TurnNow; waiting: SessionWaiting }) {
  const mark = waitingMark(props);
  return (
    <ChatFlowScope inline>
      <span className="inline-flex h-4.5 w-1.75 shrink-0 items-center">
        {mark !== undefined && (
          <span
            role="img"
            aria-label={mark.name}
            className={classes("size-1.75 rounded-full", TONES[mark.tone].dot)}
          />
        )}
      </span>
    </ChatFlowScope>
  );
}

/** What a working session is doing, or asks, and for how long, ticking. */
function Ticking(props: { now: Exclude<TurnNow, { kind: "your-turn" }> }) {
  const { now } = props;
  const elapsed = useElapsed(now.since);
  return (
    <>
      {now.kind === "working" ? doingWords(now.doing) : askWords(now.ask)} · {elapsed}
    </>
  );
}

/**
 * A session in its workspace's list: its title and its state (a dot and a word), and under them
 * what it's doing or asks and for how long, or when it was last active. A session waiting for a
 * place among the code sessions running says so there, with how many are ahead (#362).
 */
export function ListedSessionText(props: {
  title: string;
  now: TurnNow;
  updatedAt: string;
  /** When something happened, as the page says it. */
  when: (iso: string) => string;
  /**
   * Read from the device's copy (#106; Paper, "Cover · Workspace, offline"): no state, only when
   * it was last active, and, when the copy doesn't keep its conversation, faint, saying so.
   */
  offline?: "kept" | "not-kept";
}) {
  const { now } = props;
  if (props.offline !== undefined) {
    const notKept = props.offline === "not-kept";
    return (
      <span className={classes("flex min-w-0 flex-col gap-1", notKept && "text-placeholder")}>
        <span className="truncate font-medium">{props.title}</span>
        <span
          className={classes(
            "truncate font-mono text-caption/3.75",
            notKept ? "text-placeholder" : "text-muted-foreground",
          )}
        >
          {props.when(props.updatedAt)}
          {notKept && " · Not kept offline"}
        </span>
      </span>
    );
  }
  return (
    <ChatFlowScope grows>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{props.title}</span>
          <span
            className={classes(
              "flex shrink-0 items-center gap-1.5 text-meta font-bold",
              TONES[now.kind].text,
            )}
          >
            <span
              aria-hidden
              className={classes("size-1.75 shrink-0 rounded-full", TONES[now.kind].dot)}
            />
            {NAMES[now.kind]}
          </span>
        </span>
        <span className="truncate font-mono text-caption/3.75 text-muted-foreground">
          {now.kind === "your-turn" ? props.when(props.updatedAt) : <Ticking now={now} />}
        </span>
      </span>
    </ChatFlowScope>
  );
}
