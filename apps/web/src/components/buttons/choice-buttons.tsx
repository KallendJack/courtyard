import type { SessionId } from "@courtyard/contract";
import { useState } from "react";
import { useAction } from "@/hooks/use-action";
import { answerQuestion } from "../../api/worker.ts";
import { FormError } from "../forms/form-error.tsx";
import { describeProblem } from "../layout/problems.tsx";
import { ThumbButton } from "./thumb-button.tsx";

/**
 * A session's question's choices (#541; Paper, "Tablet · Code Home: builders wait until
 * answered"), as gold pills that answer it with one tap: the one its model would pick first
 * filled, the rest ringed. A tap sends the choice as the owner's message; once sent they stay
 * disabled until the question goes, and one that couldn't be sent says why and gives them back.
 */
export function ChoiceButtons(props: {
  sessionId: SessionId;
  /** The question, by its event number, and its choices. */
  asked: number;
  choices: readonly string[];
  /** What the question is about, for each button's name: the session's title. */
  about: string;
  /** It was answered: whatever shows it asks for its lists again. */
  onAnswered: () => void;
}) {
  const [sent, setSent] = useState(false);
  const answer = useAction(async (choice: number) => {
    const answered = await answerQuestion(props.sessionId, { asked: props.asked, choice });
    if (answered.kind !== "loaded") return describeProblem(answered).body;
    setSent(true);
    props.onAnswered();
    return undefined;
  });
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label={`Answers for ${props.about}`} className="flex flex-wrap gap-2">
        {props.choices.map((choice, index) => (
          <li key={choice} className="max-w-full">
            <ThumbButton
              look={index === 0 ? "needs" : "ringed"}
              pill
              disabled={sent || (answer.busy && answer.running?.[0] !== index)}
              busy={answer.running?.[0] === index}
              busyLabel="Sending…"
              onClick={() => void answer.run(index)}
            >
              {choice}
            </ThumbButton>
          </li>
        ))}
      </ul>
      <FormError message={answer.error} />
    </div>
  );
}
