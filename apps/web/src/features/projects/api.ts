import {
  nextStepOf,
  type Project,
  type ProjectSlug,
  type SessionId,
  Undone,
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

/** A step's detail line: what it asks of the owner, then what it takes or who to get. */
export const stepDetail = (step: { kind: string; detail?: string | undefined }) =>
  [`${step.kind.charAt(0).toUpperCase()}${step.kind.slice(1)}`, step.detail]
    .filter((said) => said !== undefined)
    .join(" · ");

/** Undoes one of a session's project saves, named by its event number (#603). */
export const undoProjectSave = (sessionId: SessionId, save: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/projects/${save}/undo`,
    body: {},
    schema: Undone,
  });
