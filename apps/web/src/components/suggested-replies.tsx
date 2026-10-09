import { useState } from "react";
import { Button } from "./button.tsx";

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
          <Button variant="reply" size="wraps" disabled={sending} onClick={() => void pick(reply)}>
            {reply}
          </Button>
        </li>
      ))}
    </ul>
  );
}
