import { CodeSessionList, WorkspaceDetail, WorkspaceId } from "@courtyard/contract";
import type CodeHome from "./code-home/code-home.tsx";
import { loadDocuments } from "./documents/api.ts";
import type PlanningHome from "./planning-home/planning-home.tsx";
import { loadThings } from "./things/api.ts";
import { type FromWorker, fromWorker, loadProviders, loadSkills, NOT_FOUND } from "./worker.ts";

/** A workspace's Home, by its kind: each with a stylesheet of its own, loaded only for one. */
export type Home =
  | { readonly kind: "code"; readonly Home: typeof CodeHome }
  | { readonly kind: "planning"; readonly Home: typeof PlanningHome };

/**
 * The Home the workspace has, loaded with its data, so the page shows whole: its title never
 * waits on its own and then moves as the rest arrives (#339).
 */
const homeOf = async (detail: FromWorker<WorkspaceDetail>): Promise<Home | undefined> => {
  if (detail.kind !== "loaded") return undefined;
  if (detail.data.workspace.mode === "code") {
    const module = await import("./code-home/code-home.tsx");
    return { kind: "code", Home: module.default };
  }
  const module = await import("./planning-home/planning-home.tsx");
  return { kind: "planning", Home: module.default };
};

/**
 * Everything a workspace's page shows, asked for at once. Its route imports this when the page
 * opens, so neither the code nor the schemas are on the first load.
 */
export const loadWorkspacePage = async (workspace: string) => {
  const id = encodeURIComponent(workspace);
  const workspaceId = WorkspaceId.safeParse(workspace);
  const detailAndHome = fromWorker(`/workspaces/${id}`, WorkspaceDetail).then(async (detail) => ({
    detail,
    home: await homeOf(detail),
  }));
  const [{ detail, home }, sessions, providers, skills, documents, things] = await Promise.all([
    detailAndHome,
    fromWorker(`/workspaces/${id}/sessions`, CodeSessionList),
    loadProviders(),
    workspaceId.success ? loadSkills(workspaceId.data) : NOT_FOUND,
    workspaceId.success ? loadDocuments(workspaceId.data) : NOT_FOUND,
    workspaceId.success ? loadThings(workspaceId.data) : NOT_FOUND,
  ]);
  return { detail, home, sessions, providers, skills, documents, things };
};
