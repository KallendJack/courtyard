import {
  CodeSessionList,
  type DocumentList,
  type OfflineCopy,
  type ProviderList,
  type SessionId,
  type SkillList,
  type ThingList,
  WorkspaceDetail,
  WorkspaceId,
} from "@courtyard/contract";
import type CodeHome from "../features/code-home/code-home.tsx";
import { loadDocuments } from "../features/documents/api.ts";
import { KEPT_HOME, loadHome } from "../features/planning-home/api.ts";
import type PlanningHome from "../features/planning-home/planning-home.tsx";
import { loadThings } from "../features/things/api.ts";
import { type FromWorker, fromWorker, NOT_FOUND } from "./worker.ts";
import { loadProviders, loadSkills } from "./worker-calls.ts";

/** A workspace's Home, by its kind: each with a stylesheet of its own, loaded only for one. */
export type Home =
  | { readonly kind: "code"; readonly Home: typeof CodeHome }
  | { readonly kind: "planning"; readonly Home: typeof PlanningHome };

/**
 * A workspace's page read from the device's copy (#106): when the copy is from, the sessions whose
 * conversations it keeps, and how many Things and documents the workspace has, which it doesn't.
 */
export type OfflinePage = {
  readonly at: string;
  readonly conversations: ReadonlySet<SessionId>;
  readonly notKept: { readonly things: number; readonly documents: number };
};

/**
 * The Home the workspace has, loaded with its data, so the page shows whole: its title never
 * waits on its own and then moves as the rest arrives (#339).
 */
const homeOf = async (detail: FromWorker<WorkspaceDetail>): Promise<Home | undefined> => {
  if (detail.kind !== "loaded") return undefined;
  if (detail.data.workspace.mode === "code") {
    const module = await import("../features/code-home/code-home.tsx");
    return { kind: "code", Home: module.default };
  }
  const module = await import("../features/planning-home/planning-home.tsx");
  return { kind: "planning", Home: module.default };
};

/** Everything a workspace's page shows, and, reading the device's copy, what it says of it. */
type WorkspacePage = {
  readonly detail: FromWorker<WorkspaceDetail>;
  readonly home: Home | undefined;
  readonly sessions: FromWorker<CodeSessionList>;
  readonly providers: FromWorker<ProviderList>;
  readonly skills: FromWorker<SkillList>;
  readonly documents: FromWorker<DocumentList>;
  readonly things: FromWorker<ThingList>;
  readonly offline: OfflinePage | undefined;
};

/** What isn't kept offline: everything but the workspace's detail and its sessions. */
const OFFLINE = { kind: "offline" } as const;

/** A workspace's page from the device's copy (#106); one the copy doesn't keep shows as offline. */
const readWorkspacePage = async (copy: OfflineCopy, workspace: string): Promise<WorkspacePage> => {
  const kept = copy.kept.find(({ detail }) => detail.workspace.id === workspace);
  const detail: FromWorker<WorkspaceDetail> =
    kept === undefined ? OFFLINE : { kind: "loaded", data: kept.detail };
  const sessions: FromWorker<CodeSessionList> =
    kept === undefined ? OFFLINE : { kind: "loaded", data: kept.sessions };
  const offline: OfflinePage = {
    at: copy.at,
    conversations: new Set(kept?.conversations.map(({ session }) => session.id)),
    notKept: kept?.notKept ?? { things: 0, documents: 0 },
  };
  return {
    detail,
    home: await homeOf(detail),
    sessions,
    providers: OFFLINE,
    skills: OFFLINE,
    documents: OFFLINE,
    things: OFFLINE,
    offline,
  };
};

/**
 * Everything a workspace's page shows, asked for at once. Its route imports this when the page
 * opens, so neither the code nor the schemas are on the first load. Reading the device's copy
 * (#106), it comes from that instead.
 */
export const loadWorkspacePage = async (
  workspace: string,
  reading: OfflineCopy | undefined,
): Promise<WorkspacePage> => {
  if (reading !== undefined) return readWorkspacePage(reading, workspace);
  const id = encodeURIComponent(workspace);
  const workspaceId = WorkspaceId.safeParse(workspace);
  const detailAndHome = fromWorker(`/workspaces/${id}`, WorkspaceDetail).then(async (detail) => ({
    detail,
    home: await homeOf(detail),
  }));
  const [{ detail, home }, sessions, providers, skills, documents, things, planningHome] = await Promise.all([
    detailAndHome,
    fromWorker(`/workspaces/${id}/sessions`, CodeSessionList),
    loadProviders(),
    workspaceId.success ? loadSkills(workspaceId.data) : NOT_FOUND,
    workspaceId.success ? loadDocuments(workspaceId.data) : NOT_FOUND,
    workspaceId.success ? loadThings(workspaceId.data) : NOT_FOUND,
    // A planning workspace's Home (#481) comes with the page, so its view never jumps in; a code
    // workspace has none, and its answer is passed over.
    workspaceId.success ? loadHome(workspaceId.data) : NOT_FOUND,
  ]);
  if (planningHome.kind === "loaded" && workspaceId.success) {
    KEPT_HOME.set(workspaceId.data, planningHome.data);
  }
  return { detail, home, sessions, providers, skills, documents, things, offline: undefined };
};
