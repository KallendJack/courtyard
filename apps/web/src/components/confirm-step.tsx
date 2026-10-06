import type { ReactNode } from "react";
import { useAction } from "@/lib/use-action";
import { Button } from "./button.tsx";
import { FormError } from "./form-error.tsx";
import { Notice } from "./notice.tsx";

/**
 * The step between asking to archive or delete something and doing it: it names what's about to
 * go and what happens to it, so a mis-tap is never final. `confirm` returns an error to show, or
 * nothing once it's done. Not an approval: those are the owner's yes or no to what a model wants
 * to do; this is the owner checking their own tap.
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
  const confirm = useAction(props.confirm);

  return (
    <Notice
      region={props.question}
      title={props.question}
      footer={
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => void confirm.run()}
              disabled={confirm.busy}
            >
              {props.confirmLabel}
            </Button>
            <Button variant="outline" onClick={props.onCancel}>
              Cancel
            </Button>
          </div>
          <FormError message={confirm.error} />
        </>
      }
    >
      {props.children}
    </Notice>
  );
}
