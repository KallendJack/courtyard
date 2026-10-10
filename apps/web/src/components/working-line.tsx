import type { Doing } from "@courtyard/contract";
import { ChatFlowScope } from "./chat-flow-scope.tsx";
import { doingWords, useElapsed } from "./session-state.tsx";

/**
 * The Working line under the latest answer while its turn runs (#179, Paper board Handheld · 20):
 * three violet dots, Working, what the model is doing now, and how long the turn has taken.
 */
export function WorkingLine(props: { since: string; doing: Doing }) {
  const elapsed = useElapsed(props.since);
  return (
    <ChatFlowScope>
      <div
        // Not a live region: its clock ticks every second.
        className="flex items-center gap-3 rounded-lg bg-primary/11 px-4 py-3 ring-1 ring-primary/27 ring-inset"
      >
        <span aria-hidden className="flex shrink-0 items-center gap-1">
          <span className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
          <span className="size-1.5 rounded-full bg-primary opacity-60" />
          <span className="size-1.5 rounded-full bg-primary opacity-30" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-sm/[18px] font-extrabold text-primary-text">Working</span>
          <span className="font-mono text-[12px]/4 wrap-anywhere text-foreground/85">
            {doingWords(props.doing)}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[12px]/4 text-muted-foreground">{elapsed}</span>
      </div>
    </ChatFlowScope>
  );
}

/** A time of day as a clock shows it, "09:41". */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The Your turn mark under the last answer once its turn has ended (#179, Paper board Handheld ·
 * 21): a rule with "Your turn · finished 09:41" (or "stopped") in its middle, so a finished session
 * never looks like one still working.
 */
export function TurnEndMark(props: { at: string; stopped: boolean }) {
  return (
    <ChatFlowScope>
      <p className="flex items-center gap-2.5">
        <span aria-hidden className="h-px flex-1 bg-input" />
        <span className="flex items-center gap-1.75 rounded-full bg-secondary px-3 py-1.5 text-[12px]/4 font-extrabold text-foreground ring-1 ring-input ring-inset">
          <span aria-hidden className="size-1.75 shrink-0 rounded-full bg-foreground" />
          Your turn · {props.stopped ? "stopped" : "finished"} {clock(props.at)}
        </span>
        <span aria-hidden className="h-px flex-1 bg-input" />
      </p>
    </ChatFlowScope>
  );
}
