import { MattSetup, type MattSetupAnswer, type WorkspaceId } from "@courtyard/contract";
import { fromWorker, sendJson } from "../../api/worker.ts";

// The setup card's calls live with it, so they stay off the first load (#181, #323).

const setupOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/matt-setup`;

/** A code workspace's setup card, if its repository has anything to set up. */
export const loadMattSetup = (workspaceId: WorkspaceId) =>
  fromWorker(setupOf(workspaceId), MattSetup);

/** The owner's answer to the setup card: Set up with their choices, or Not now, which leaves it. */
export const answerMattSetup = (workspaceId: WorkspaceId, answer: MattSetupAnswer) =>
  sendJson({ path: setupOf(workspaceId), body: answer, schema: MattSetup });
