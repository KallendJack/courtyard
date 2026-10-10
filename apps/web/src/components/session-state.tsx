import { type ApprovalAsk, type Doing, skillTitle, type TurnNow } from "@courtyard/contract";
import { useEffect, useRef, useState } from "react";
import { classes } from "@/lib/classes";
import { ChatFlowScope } from "./chat-flow-scope.tsx";

// Whose turn it is in a session (#179, Paper board Handheld · 20): Working in violet, Needs you in
// gold, Your turn in white, the same in the chat, the workspace's sessions and the sidebar.

/** What a working model is doing now, in a few words, as the Working line says it. */
export const doingWords = (doing: Doing) => {
  if (doing.kind === "thinking") return "thinking";
  if (doing.kind === "writing") return "writing the answer";
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
    case "check-failed":
      return `fixing the ${activity.name} check`;
  }
};

/** What a session waiting on the owner asks to do, in a few words. */
export const askWords = (ask: ApprovalAsk) =>
  ask.kind === "command" ? `asks to run ${ask.command}` : `asks to change ${ask.path}`;

/** How long something has taken, as a clock shows it: "0:40", "2:14", "1:02:14". */
export const elapsedWords = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}:${two(seconds % 60)}`
    : `${Math.floor(minutes / 60)}:${two(minutes % 60)}:${two(seconds % 60)}`;
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

/** How often a list of sessions asks again while one of them is working or needs the owner. */
const REFRESH_MS = 3000;

/**
 * Calls `refresh` every few seconds while any of `sessions` is working or needs the owner, so a
 * list of sessions keeps saying whose turn it is.
 */
export const useRefreshWhileBusy = (
  sessions: readonly { readonly now: TurnNow }[],
  refresh: () => void,
) => {
  const busy = sessions.some((session) => session.now.kind !== "your-turn");
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => latest.current(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [busy]);
};

const TONES = {
  working: { dot: "bg-primary shadow-[0_0_8px_var(--color-primary)]", text: "text-primary-text" },
  "needs-you": { dot: "bg-warning", text: "text-warning" },
  "your-turn": { dot: "bg-foreground", text: "text-foreground" },
} as const;

const NAMES = { working: "Working", "needs-you": "Needs you", "your-turn": "Your turn" } as const;

/** A session's state as a dot alone, before its title in the sidebar; none when it's the owner's turn. */
export function SessionStateDot(props: { now: TurnNow }) {
  if (props.now.kind === "your-turn") return null;
  return (
    <ChatFlowScope inline>
      <span
        role="img"
        aria-label={NAMES[props.now.kind]}
        className={classes(
          "mr-2 mb-px inline-block size-1.75 rounded-full align-middle",
          TONES[props.now.kind].dot,
        )}
      />
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
 * code session to end says that instead (#174).
 */
export function ListedSessionText(props: {
  title: string;
  now: TurnNow;
  updatedAt: string;
  /** Waiting for one of the code sessions running to end before its turn starts. */
  waitsForSlot: boolean;
  /** When something happened, as the page says it. */
  when: (iso: string) => string;
}) {
  const { now } = props;
  return (
    <ChatFlowScope grows>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{props.title}</span>
          {props.waitsForSlot ? (
            <span className="shrink-0 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Queued · starts when a slot frees
            </span>
          ) : (
            <span
              className={classes(
                "flex shrink-0 items-center gap-1.5 text-[12px]/4 font-bold",
                TONES[now.kind].text,
              )}
            >
              <span
                aria-hidden
                className={classes("size-1.75 shrink-0 rounded-full", TONES[now.kind].dot)}
              />
              {NAMES[now.kind]}
            </span>
          )}
        </span>
        {!props.waitsForSlot && (
          <span className="truncate font-mono text-[11px]/[15px] text-muted-foreground">
            {now.kind === "your-turn" ? props.when(props.updatedAt) : <Ticking now={now} />}
          </span>
        )}
      </span>
    </ChatFlowScope>
  );
}
