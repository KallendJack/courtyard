import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { InfoBox } from "@/components/notice";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { type ContextPlace, startGettingToKnow } from "../worker.ts";

/**
 * An offer to get to know an empty workspace or owner context (docs/ai-conduct.md, Getting to
 * know a workspace): a new session the worker starts with its own message, answered by the first
 * model that saves to context and isn't at its usage limit, which the worker picks.
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
      <Button size="sm" onClick={() => void start.run()} disabled={start.busy}>
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
