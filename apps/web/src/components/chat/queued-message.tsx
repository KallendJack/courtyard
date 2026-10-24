import { IconButton } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { Pencil, X } from "lucide-react";
import { useState } from "react";
import { ChatFlowScope } from "./chat-flow-scope.tsx";

/** One of the owner's messages waiting for the running turn to end (#177). */
export type Queued = {
  readonly seq: number;
  readonly text: string;
  /** How many photos and PDFs it carries. */
  readonly attachments: number;
};

/** A queued message as its bubble says it: its words, and how many files it carries, if any. */
const queuedLine = (message: Queued) => {
  const files = `${message.attachments} attachment${message.attachments === 1 ? "" : "s"}`;
  // Only attachments, with no words (#164).
  if (message.text === "") return files;
  return message.attachments === 0 ? message.text : `${message.text} (with ${files})`;
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
 * each an outlined bubble with × to remove it, and, for one of words only, Edit to take it back
 * into the Reply box (#252), saying when it goes. Every device shows them, and removing one
 * removes it everywhere.
 */
export function QueuedMessages(props: {
  messages: readonly Queued[];
  /** A turn is running, so the first goes when it ends. */
  running: boolean;
  /** Removes one: what went wrong, or nothing once it's removed. */
  onRemove: (queued: number) => Promise<string | undefined>;
  /** Takes one back into the Reply box, out of the queue: what went wrong, or nothing (#252). */
  onEdit?: (queued: Queued) => Promise<string | undefined>;
}) {
  const { onEdit } = props;
  const [problem, setProblem] = useState<string>();
  if (props.messages.length === 0) return null;
  return (
    <ChatFlowScope>
      <ol aria-label="Queued messages" className="flex flex-col items-end gap-3">
        {props.messages.map((message, index) => (
          <li key={message.seq} className="flex max-w-[85%] flex-col items-end gap-1.5">
            <div className="flex items-start gap-1.5 rounded-bubble rounded-br-sm py-1.5 pr-1.5 pl-4 ring-stroke ring-muted-foreground/40 ring-inset">
              <p className="py-1.5 text-message/5.5 whitespace-pre-wrap wrap-anywhere text-foreground/85 md:text-base/5.5">
                {queuedLine(message)}
              </p>
              {onEdit !== undefined && message.attachments === 0 && (
                <IconButton
                  label="Edit queued message"
                  icon={<Pencil />}
                  size="sm"
                  onClick={async () => setProblem(await onEdit(message))}
                />
              )}
              <IconButton
                label="Remove queued message"
                icon={<X />}
                size="sm"
                onClick={async () => setProblem(await props.onRemove(message.seq))}
              />
            </div>
            <p className="text-meta font-semibold text-muted-foreground">
              {index > 0
                ? `Queued · ${ordinal(index + 1)}`
                : props.running
                  ? "Queued · goes when this answer ends"
                  : "Queued"}
            </p>
          </li>
        ))}
      </ol>
      <FormError message={problem} />
    </ChatFlowScope>
  );
}
