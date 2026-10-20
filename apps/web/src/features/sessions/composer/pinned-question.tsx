import type { SessionId } from "@courtyard/contract";
import { ChoiceButtons } from "@/components/buttons/choice-buttons";
import { ChatFlowScope } from "@/components/chat/chat-flow-scope";

/**
 * The question a code session's model asked the owner (#541; Paper, "Tablet · Session: question
 * pinned, refusal line"), pinned in gold above the reply box until they send a message: a tap on
 * one of its choices, or their own reply. Reading it never clears it.
 */
export function PinnedQuestion(props: {
  sessionId: SessionId;
  title: string;
  asked: { readonly seq: number; readonly question: string; readonly choices: readonly string[] };
  /** A choice was sent: the page follows the turn it started. */
  onAnswered: () => void;
}) {
  const { asked } = props;
  return (
    <ChatFlowScope>
      <section
        aria-label="Waiting on you"
        className="mb-2 flex flex-col gap-2 rounded-row border border-warning/25 bg-warning/10 px-3.5 py-3"
      >
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm/4.5 font-bold">{asked.question}</p>
            <p className="text-meta font-medium text-warning">
              Waiting on you · stays until you send a reply
            </p>
          </div>
        </div>
        {asked.choices.length > 0 && (
          <ChoiceButtons
            sessionId={props.sessionId}
            asked={asked.seq}
            choices={asked.choices}
            about={props.title}
            onAnswered={props.onAnswered}
          />
        )}
      </section>
    </ChatFlowScope>
  );
}
