import type { WorkspaceId } from "@courtyard/contract";
import { useKept } from "@/components/layout/kept";
import { StatusLineView } from "@/components/workspace/status-line";
import { describeProblem } from "../../components/layout/problems.tsx";
import { changeStatusLine, KEPT_STATUS_LINE, loadStatusLine } from "./api.ts";

/**
 * A workspace's status line under its name (#256), as the page loaded it, then kept fresh the
 * shared way (#387), and asked for again as `again` changes (a session ending, say). A change the
 * owner makes shows at once.
 */
export function WorkspaceStatusLine(props: { workspaceId: WorkspaceId; again?: unknown }) {
  const { workspaceId } = props;
  const line = useKept(KEPT_STATUS_LINE, {
    key: workspaceId,
    load: async () => {
      const loaded = await loadStatusLine(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    again: props.again,
  });
  return (
    <StatusLineView
      line={line}
      change={async (change) => {
        const changed = await changeStatusLine(workspaceId, change);
        if (changed.kind !== "loaded") return describeProblem(changed).body;
        KEPT_STATUS_LINE.set(workspaceId, changed.data);
        return undefined;
      }}
    />
  );
}
