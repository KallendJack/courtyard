import { type ReactNode, useState } from "react";
import { PillButton } from "@/components/pill-button";

/**
 * The step between asking to archive or delete something and doing it: it names what's about to
 * go and what happens to it, so a mis-tap is never final. `confirm` returns an error to show, or
 * nothing once it's done.
 */
export function ConfirmStep(props: {
  /** The question, naming the thing: "Archive Garage gym?" */
  question: string;
  /** What happens to it. */
  children: ReactNode;
  /** The confirming button: "Archive workspace", say. */
  confirmLabel: string;
  confirm: () => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  const confirm = async () => {
    setWorking(true);
    const problem = await props.confirm();
    setWorking(false);
    setError(problem);
  };

  return (
    <section
      aria-label={props.question}
      className="mt-4 rounded-md bg-destructive-soft px-3.5 py-3 text-sm/[21px] text-destructive-text"
    >
      <p className="font-semibold text-destructive">{props.question}</p>
      <div className="mt-1">{props.children}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PillButton variant="destructive" onClick={confirm} disabled={working}>
          {props.confirmLabel}
        </PillButton>
        <PillButton variant="outline" onClick={props.onCancel}>
          Cancel
        </PillButton>
      </div>
      {error && (
        <p role="alert" className="mt-2">
          {error}
        </p>
      )}
    </section>
  );
}
