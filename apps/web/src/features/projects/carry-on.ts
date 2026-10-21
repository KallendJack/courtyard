import type { Project, WorkspaceId } from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { startSession } from "../sessions/composer/messages.ts";
import { carryOnMessage } from "./api.ts";

/**
 * Carry on (#603): a session started from a project, which belongs to it, its first message the
 * project and what's next, then open. On the model the worker picks, as a new session's is.
 */
export const useCarryOn = (workspaceId: WorkspaceId) => {
  const navigate = useNavigate();
  return useAction(async (project: Project) => {
    const session = await startSession({
      workspaceId,
      message: { text: carryOnMessage(project), project: project.slug },
      files: [],
    });
    if (session.kind !== "loaded") return describeProblem(session).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId, sessionId: session.data.id },
    });
    return undefined;
  });
};
