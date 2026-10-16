import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { InfoBox } from "@/components/layout/notice";
import { useAction } from "@/hooks/use-action";
import type { ContextPlace } from "../../../api/worker.ts";
import { startGettingToKnow } from "../../../api/worker-calls.ts";
import { describeProblem } from "../../../components/layout/problems.tsx";

/**
 * An offer to get to know an empty workspace or owner context (docs/ai-conduct.md, Getting to
 * know a workspace): a new session the worker starts with the Get to know or Get to know me skill,
 * answered by the first model that saves to context and isn't at its usage limit.
 */
export function GetToKnow(props: {
  about: ContextPlace;
  /** The button, which also names the box. */
  label: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const start = useAction(async () => {
    const session = await startGettingToKnow(props.about, {});
    if (session.kind !== "loaded") return describeProblem(session).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: session.data.workspaceId, sessionId: session.data.id },
    });
    return undefined;
  });

  return (
    <InfoBox label={props.label}>
      <p className="min-w-0 flex-1 basis-60">{props.children}</p>
      <Button size="sm" onClick={() => void start.run()} busy={start.busy} busyLabel="Starting…">
        {props.label}
      </Button>
      {start.error !== undefined && (
        <div className="basis-full">
          <FormError message={start.error} />
        </div>
      )}
    </InfoBox>
  );
}
