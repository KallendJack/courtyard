import {
  nextStepOf,
  type Project,
  ProjectDecided,
  type ProjectDecision,
  type ProjectSlug,
  type SessionId,
  Undone,
  type WorkspaceId,
} from "@courtyard/contract";
import { sendJson } from "../../api/worker.ts";

// A planning workspace's projects' calls and words (#603), beside them so they stay off the first
// load. Home brings the projects themselves (`features/planning-home/api.ts`).

/** A project's place on its workspace's page, by the address's hash: `project/<slug>`. */
export const projectHash = (slug: ProjectSlug) => `project/${slug}`;

/** The project a workspace page's hash names, by its file's name, if it names one. */
export const projectInHash = (hash: string) => /^project\/([a-z0-9-]+)$/.exec(hash)?.[1];

/**
 * Carry on's first message (#603): the project and what's next, as the owner would say it, so the
 * session it starts reads as theirs.
 */
export const carryOnMessage = (project: Project) => {
  const next = nextStepOf(project);
  return next === undefined
    ? `Carry on with ${project.name}.`
    : `Carry on with ${project.name}: ${next.text}.`;
};

/**
 * Pick on an options block in a session that belongs to a project (#603): the project's decision,
 * with the options, the pick and why, as a change Undo takes back from Recent changes.
 */
export const pickDecision = (
  workspaceId: WorkspaceId,
  slug: ProjectSlug,
  decision: ProjectDecision,
) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/projects/${slug}/decision`,
    method: "PUT",
    body: decision,
    schema: ProjectDecided,
  });

/** Undoes one of a session's project saves, named by its event number (#603). */
export const undoProjectSave = (sessionId: SessionId, save: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/projects/${save}/undo`,
    body: {},
    schema: Undone,
  });
