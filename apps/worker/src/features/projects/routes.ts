import type { Context } from "hono";
import { apiError } from "../../lib/http.ts";
import type { WholeFilesUndoRefusal } from "../context-folder/index.ts";
import { type PlanningFiles, sharedFileError } from "../planning-files/routes.ts";
import type { ProjectRefusal } from "./index.ts";

// Projects have no routes of their own yet (#603): Home carries them, a session starts from one,
// and their saves are undone from their notes and Recent changes. This is how those answer a
// refusal.

const PROJECTS: PlanningFiles = { one: "project", many: "projects" };

/** Why a project wasn't found, saved or undone, as the API answers it. */
export const projectError = (c: Context, refusal: ProjectRefusal | WholeFilesUndoRefusal) => {
  switch (refusal.kind) {
    case "workspace":
    case "code-workspace":
    case "not-found":
    case "not-undoable":
    case "already-undone":
    case "storage":
      return sharedFileError(c, refusal, PROJECTS);
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "incomplete":
      return apiError(c, { status: 400, error: "Give the project a name." });
    case "clash":
      return apiError(c, {
        status: 409,
        error: `There's already a project called ${refusal.name}. Choose another name.`,
      });
    case "unreadable":
      return apiError(c, {
        status: 409,
        error: `${refusal.path} can't be read as a project, so it can't be changed here: ${refusal.problem}`,
      });
    case "no-such-step":
      return apiError(c, { status: 400, error: "That step isn't there any more." });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "stale":
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "That project has changed since, so this would lose the newer change.",
      });
  }
};
