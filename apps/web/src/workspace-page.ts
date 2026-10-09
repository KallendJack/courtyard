import { SessionList, WorkspaceDetail, WorkspaceId } from "@courtyard/contract";
import { loadDocuments } from "./documents/api.ts";
import { loadThings } from "./things/api.ts";
import { fromWorker, loadProviders, loadSkills, NOT_FOUND } from "./worker.ts";

/**
 * Everything a workspace's page shows, asked for at once. Its route imports this when the page
 * opens, so neither the code nor the schemas are on the first load.
 */
export const loadWorkspacePage = async (workspace: string) => {
  const id = encodeURIComponent(workspace);
  const workspaceId = WorkspaceId.safeParse(workspace);
  const [detail, sessions, providers, skills, documents, things] = await Promise.all([
    fromWorker(`/workspaces/${id}`, WorkspaceDetail),
    fromWorker(`/workspaces/${id}/sessions`, SessionList),
    loadProviders(),
    workspaceId.success ? loadSkills(workspaceId.data) : NOT_FOUND,
    workspaceId.success ? loadDocuments(workspaceId.data) : NOT_FOUND,
    workspaceId.success ? loadThings(workspaceId.data) : NOT_FOUND,
  ]);
  return { detail, sessions, providers, skills, documents, things };
};
