import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { InfoBox } from "@/components/notice";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { type GettingToKnow, loadProviders, startGettingToKnow } from "../worker.ts";
import { availableModels } from "./models.ts";

/**
 * An offer to get to know an empty workspace or owner context (docs/ai-conduct.md, Getting to
 * know a workspace): a new session the worker starts with its own message, answered by the first
 * model on offer that saves to context. Providers are only asked once it's tapped.
 */
export function GetToKnow(props: {
  about: GettingToKnow;
  /** The button, which also names the box. */
  label: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const start = useAction(async () => {
    const providers = await loadProviders();
    if (providers.kind !== "loaded") return describeProblem(providers).body;
    const saving = providers.data.providers.filter(
      (provider) => provider.available && provider.capabilities.savesContext,
    );
    const model = availableModels(saving)[0]?.ref;
    if (model === undefined)
      return "No model that saves to context is available. Check the providers' settings.";
    const session = await startGettingToKnow(props.about, { model });
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
