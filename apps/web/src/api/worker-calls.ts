import {
  ContextBackup,
  type GetToKnowRequest,
  OwnerContextDetail,
  ProviderList,
  type SessionChange,
  type SessionId,
  SessionSummary,
  SkillList,
  type WorkspaceId,
} from "@courtyard/contract";
import { type ContextPlace, type FromWorker, fromWorker, sendJson } from "./worker.ts";

// The worker's calls that read with the contract's fuller schemas, kept apart from worker.ts so
// only the pages that make them load them (and the full Zod they're written in), never the first
// load (#393).

/** A workspace's skills, for the skill picker and its Skills section (ADR 0016). */
export const loadSkills = (workspaceId: WorkspaceId): Promise<FromWorker<SkillList>> =>
  fromWorker(`/workspaces/${encodeURIComponent(workspaceId)}/skills`, SkillList);

/** The providers and their models, for the model picker. */
export const loadProviders = () => fromWorker("/providers", ProviderList);

/** Whether the context folder's backup has every change. */
export const loadBackup = () => fromWorker("/backup", ContextBackup);

/** The owner context, or `null` when there isn't one yet. */
export const loadOwnerContext = () => fromWorker("/owner-context", OwnerContextDetail);

/** Starts the owner context from the worker's starter file. */
export const startOwnerContext = () =>
  sendJson({ path: "/owner-context", body: {}, schema: OwnerContextDetail });

/** Renames a session. */
export const renameSession = (id: SessionId, change: SessionChange) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: change,
    schema: SessionSummary,
  });

/** Starts a session getting to know a workspace or the owner context, with the worker's starter. */
export const startGettingToKnow = (about: ContextPlace, start: GetToKnowRequest) =>
  sendJson({
    path:
      about.kind === "owner"
        ? "/owner-context/get-to-know"
        : `/workspaces/${encodeURIComponent(about.id)}/get-to-know`,
    body: start,
    schema: SessionSummary,
  });
