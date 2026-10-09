import { type GrillRequest, SessionSummary, type WorkspaceId } from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { Flame } from "lucide-react";
import { IconButton } from "@/components/button";
import { FormError } from "@/components/form-error";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { sendJson } from "../worker.ts";

/**
 * Starts a session grilling one of a workspace's plans. Here rather than in worker.ts, which the
 * first load carries, so it loads with the workspace page.
 */
const grillPlan = (workspaceId: WorkspaceId, grill: GrillRequest) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/grill`,
    body: grill,
    schema: SessionSummary,
  });

/**
 * One of a workspace's plans with Grill this plan beside it (docs/ai-conduct.md, Grilling): a new
 * session whose first message is the plan with the Grilling tag, answered by the model the worker
 * picks. Why it didn't start shows under the line.
 */
export function GrillablePlan(props: { workspaceId: WorkspaceId; plan: string }) {
  const navigate = useNavigate();
  const grill = useAction(async () => {
    const session = await grillPlan(props.workspaceId, { plan: props.plan });
    if (session.kind !== "loaded") return describeProblem(session).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: session.data.workspaceId, sessionId: session.data.id },
    });
    return undefined;
  });

  return (
    <div className="flex flex-wrap items-start gap-x-2.5">
      <span className="min-w-0 flex-1 py-0.5">{props.plan}</span>
      <IconButton
        label="Grill this plan"
        icon={<Flame />}
        size="sm"
        filled
        disabled={grill.busy}
        onClick={() => void grill.run()}
      />
      {grill.error !== undefined && (
        <div className="basis-full">
          <FormError message={grill.error} />
        </div>
      )}
    </div>
  );
}
