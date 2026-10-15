import type { LeadStatus, WorkspaceId } from "@courtyard/contract";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { mergeInOrder } from "./api.ts";

/**
 * Merge in order, as a tap runs it (#423), from Needs you or the Lead's chat: the Lead merges the
 * pull requests the screen shows ready, by number, and `onMerging` is told how it stands then.
 */
export const useMergeInOrder = (merging: {
  workspaceId: WorkspaceId;
  pullRequests: readonly number[];
  onMerging: (lead: LeadStatus) => void;
}) =>
  useAction(async () => {
    const started = await mergeInOrder(merging.workspaceId, merging.pullRequests);
    if (started.kind !== "loaded") return describeProblem(started).body;
    merging.onMerging(started.data);
    return undefined;
  });
