import { useState } from "react";

/**
 * The replies a model suggested under its latest answer (ADR 0017), as outlined pills that send
 * one with a tap: in a row that wraps, stacked on a phone. Once one is sent they stay disabled
 * until the reply takes them away; a reply that couldn't be sent gives them back. Not on the
 * first load.
 */
export function SuggestedReplies(props: {
  replies: readonly string[];
  /** Sends the reply as the owner's message: whether it was sent. */
  onPick: (reply: string) => Promise<boolean>;
}) {
  const [sending, setSending] = useState(false);
  const pick = async (reply: string) => {
    setSending(true);
    if (!(await props.onPick(reply))) setSending(false);
  };
  return (
    <ul
      aria-label="Suggested replies"
      className="flex flex-col items-start gap-2 md:flex-row md:flex-wrap"
    >
      {props.replies.map((reply) => (
        <li key={reply} className="max-w-full">
          <button
            type="button"
            disabled={sending}
            onClick={() => void pick(reply)}
            className="max-w-full rounded-full border border-border bg-field px-4 py-2 text-left text-sm font-medium wrap-anywhere text-primary-text outline-none transition-colors select-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
          >
            {reply}
          </button>
        </li>
      ))}
    </ul>
  );
}
