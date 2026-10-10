import { ArrowDown } from "lucide-react";
import { ChatFlowScope } from "./chat-flow-scope.tsx";

/**
 * Jump to latest (#168, Paper board Handheld · 22): while the owner reads back, a pill floating
 * just above the message box that brings them down to the latest, with a live violet dot and
 * "still answering" while the turn is running. New text never moves them; only this does.
 */
export function JumpToLatest(props: { answering: boolean; onJump: () => void }) {
  return (
    <ChatFlowScope>
      <button
        type="button"
        onClick={props.onJump}
        className="absolute bottom-full left-1/2 mb-3 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-foreground pr-4.5 pl-4 text-sm/[18px] font-extrabold whitespace-nowrap text-background shadow-[0_8px_24px_#00000099] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
      >
        {props.answering && (
          <span
            aria-hidden
            className="size-1.75 shrink-0 animate-pulse rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"
          />
        )}
        {props.answering ? "Jump to latest · still answering" : "Jump to latest"}
        <ArrowDown aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
      </button>
    </ChatFlowScope>
  );
}
