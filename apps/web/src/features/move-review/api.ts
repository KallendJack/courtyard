import { MovesMade, type WorkspaceId } from "@courtyard/contract";
import { sendJson } from "../../api/worker.ts";

// The move review's call (#603), beside it so its schema stays off the first load. Home brings the
// review itself (`features/planning-home/api.ts`).

/** The owner's ticks: the moves to make, by number; none leaves everything as it is. */
export const moveTicked = (workspaceId: WorkspaceId, moves: readonly number[]) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/review`,
    body: { moves },
    schema: MovesMade,
  });
