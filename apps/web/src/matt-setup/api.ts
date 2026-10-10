import { MattSetup, type MattSetupAnswer, type WorkspaceId } from "@courtyard/contract";
import { fromWorker, sendJson } from "../worker.ts";

// The setup check's calls live with its offer, so they stay off the first load (#181).

const setupOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/matt-setup`;

/** What a code workspace's repository is missing of Matt's setup, if anything to offer. */
export const loadMattSetup = (workspaceId: WorkspaceId) =>
  fromWorker(setupOf(workspaceId), MattSetup);

/** The owner's answer to the offer: Allow adds what's missing, Not now leaves it. */
export const answerMattSetup = (workspaceId: WorkspaceId, answer: MattSetupAnswer["answer"]) =>
  sendJson({
    path: setupOf(workspaceId),
    body: { answer } satisfies MattSetupAnswer,
    schema: MattSetup,
  });
