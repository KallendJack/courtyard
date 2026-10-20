import {
  type CodeSessionList,
  STATUS_ITEM_MAX_LENGTH,
  type StatusItem,
  type StatusLine,
  type WorkspaceId,
} from "@courtyard/contract";
import { err, ok, type Result } from "../../lib/result.ts";
import { getWorkspace, type WorkspaceError } from "../workspaces/index.ts";

/**
 * The status line under a code workspace's name (#256): ✓ just done · ● now · ○ next, built from
 * its data with no model. A planning workspace has none (#600).
 */

/** Why a status line couldn't be read. */
export type StatusLineRefusal =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** A planning workspace has no status line (#600). */
  | { readonly kind: "planning" };

/** A title's words as the line shows them: on one line, without quotes or a full stop, cut to fit. */
const itemWords = (said: string) => {
  const words = said
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  return words.length > STATUS_ITEM_MAX_LENGTH
    ? `${words.slice(0, STATUS_ITEM_MAX_LENGTH - 1).trimEnd()}…`
    : words;
};

/**
 * An issue's or pull request's title in product words: without what a session did to it ("Build
 * #256: "), the issue it closes ("(#256)"), or the ellipsis a session's title was cut with.
 */
const productWords = (title: string) =>
  itemWords(
    title
      .replace(/^(?:Build|Grill) #\d+: /, "")
      .replace(/\s*\(#\d+\)\s*$/, "")
      .replace(/…$/, ""),
  );

export const createStatusLine = (options: {
  contextDir: string;
  /** What a code workspace's line is built from: its sessions, and its Next up. */
  code: {
    sessions: (workspaceId: WorkspaceId) => Promise<Result<CodeSessionList["sessions"], unknown>>;
    nextUp: (
      workspaceId: WorkspaceId,
    ) => Promise<Result<{ issues: readonly { title: string; ready: boolean }[] }, unknown>>;
  };
}) => {
  /**
   * A code workspace's line, from its data with no model: ✓ the last pull request merged from one
   * of its sessions, ● the first build running now (not the Lead), ○ the first ready issue in Next
   * up, each in the product words of its title. Next up GitHub can't be asked for is left out.
   */
  const codeLine = async (workspaceId: WorkspaceId): Promise<StatusLine> => {
    const [sessions, nextUp] = await Promise.all([
      options.code.sessions(workspaceId),
      options.code.nextUp(workspaceId),
    ]);
    const listed = sessions.ok ? sessions.value : [];
    const merged = listed
      .filter((session) => session.pullRequest?.state === "merged")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const building = listed
      .filter((session) => session.busy && session.lead !== true)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const ready = nextUp.ok ? nextUp.value.issues.find((issue) => issue.ready) : undefined;
    const itemOf = (title: string | undefined): StatusItem | null => {
      const text = title === undefined ? "" : productWords(title);
      return text === "" ? null : { text };
    };
    return {
      done: itemOf(merged?.pullRequest?.title ?? merged?.title),
      now: itemOf(building?.title),
      next: itemOf(ready?.title),
    };
  };

  return {
    /** A code workspace's status line now. */
    of: async (rawId: string): Promise<Result<StatusLine, StatusLineRefusal>> => {
      const workspace = await getWorkspace(options.contextDir, rawId);
      if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
      const { summary } = workspace.value;
      if (summary.mode !== "code") return err({ kind: "planning" });
      return ok(await codeLine(summary.id));
    },
  };
};

export type StatusLines = ReturnType<typeof createStatusLine>;
