import { useState } from "react";
import { Button } from "../buttons/button.tsx";
import { Scroller } from "../layout/scroller.tsx";

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
  /**
   * A planning workspace's next steps under its Home's view (#481): named so, in one row that
   * scrolls sideways when it's wider than the screen.
   */
  row?: { readonly label: string };
}) {
  const [sending, setSending] = useState(false);
  const pick = async (reply: string) => {
    setSending(true);
    if (!(await props.onPick(reply))) setSending(false);
  };
  const pills = props.replies.map((reply) => (
    <li key={reply} className={props.row === undefined ? "max-w-full" : "shrink-0"}>
      <Button
        variant="reply"
        size={props.row === undefined ? "wraps" : "md"}
        disabled={sending}
        onClick={() => void pick(reply)}
      >
        {reply}
      </Button>
    </li>
  ));
  if (props.row !== undefined) {
    return (
      <Scroller axis="x" className="-mx-4 px-4 md:mx-0 md:px-0">
        <ul aria-label={props.row.label} className="flex w-max gap-2">
          {pills}
        </ul>
      </Scroller>
    );
  }
  return (
    <ul
      aria-label="Suggested replies"
      className="flex flex-col items-start gap-2 md:flex-row md:flex-wrap"
    >
      {pills}
    </ul>
  );
}
