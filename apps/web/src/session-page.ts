import { SessionDetail, WorkspaceId } from "@courtyard/contract";
import { fromWorker, NOT_FOUND } from "./worker.ts";
import { loadProviders, loadSkills } from "./worker-calls.ts";

/**
 * Everything a session's page shows, asked for at once. Its route imports this when the page
 * opens, so neither the code nor the schemas are on the first load (#393).
 */
export const loadSessionPage = async (params: { workspaceId: string; sessionId: string }) => {
  const workspaceId = WorkspaceId.safeParse(params.workspaceId);
  const [session, providers, skills] = await Promise.all([
    fromWorker(`/sessions/${encodeURIComponent(params.sessionId)}`, SessionDetail),
    loadProviders(),
    workspaceId.success ? loadSkills(workspaceId.data) : NOT_FOUND,
  ]);
  return { session, providers, skills };
};
