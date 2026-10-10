import { X } from "lucide-react";
import { useState } from "react";
import { IconButton } from "./button.tsx";
import { ChatFlowScope } from "./chat-flow-scope.tsx";
import { FormError } from "./form-error.tsx";

/** One of the owner's messages waiting for the running turn to end (#177). */
export type Queued = {
  readonly seq: number;
  readonly text: string;
  /** How many photos and PDFs it carries. */
  readonly attachments: number;
};

/** "2nd", "3rd", "11th": where a queued message is in the queue. */
const ordinal = (place: number) => {
  const tens = place % 100;
  const ending =
    tens >= 11 && tens <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[place % 10] ?? "th");
  return `${place}${ending}`;
};

/**
 * The owner's queued messages, under the Working line, in order (#177, Paper board Handheld · 23):
 * each an outlined bubble with × to remove it, saying when it goes. Every device shows them, and
 * removing one removes it everywhere.
 */
export function QueuedMessages(props: {
  messages: readonly Queued[];
  /** A turn is running, so the first goes when it ends. */
  running: boolean;
  /** Removes one: what went wrong, or nothing once it's removed. */
  onRemove: (queued: number) => Promise<string | undefined>;
}) {
  const [problem, setProblem] = useState<string>();
  if (props.messages.length === 0) return null;
  return (
    <ChatFlowScope>
      <ol aria-label="Queued messages" className="flex flex-col items-end gap-3">
        {props.messages.map((message, index) => (
          <li key={message.seq} className="flex max-w-[85%] flex-col items-end gap-1.5">
            <div className="flex items-start gap-1.5 rounded-bubble rounded-br-sm py-1.5 pr-1.5 pl-4 ring-[1.5px] ring-muted-foreground/40 ring-inset">
              <p className="py-1.5 text-[15px]/[22px] whitespace-pre-wrap wrap-anywhere text-foreground/85 md:text-base/[22px]">
                {message.text}
                {message.attachments > 0 &&
                  ` (with ${message.attachments} attachment${message.attachments === 1 ? "" : "s"})`}
              </p>
              <IconButton
                label="Remove queued message"
                icon={<X />}
                size="sm"
                onClick={async () => setProblem(await props.onRemove(message.seq))}
              />
            </div>
            <p className="text-[12px]/4 font-semibold text-muted-foreground">
              {index > 0
                ? `Queued · ${ordinal(index + 1)}`
                : props.running
                  ? "Queued · sends when this turn ends"
                  : "Queued"}
            </p>
          </li>
        ))}
      </ol>
      <FormError message={problem} />
    </ChatFlowScope>
  );
}
