import {
  type FrictionPlace,
  type FrictionReport,
  SESSION_TITLE_MAX_LENGTH,
  type SessionSummary,
} from "@courtyard/contract";
import { gitOrNothing } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { frictionMessage } from "../../prompts/index.ts";
import type { PreparedAttachment } from "../attachments/index.ts";
import type { Code } from "../code/index.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { getWorkspace, listWorkspaces } from "../workspaces/index.ts";

/**
 * Something's off (#554): friction the owner reports from any screen, filed by a session in
 * Courtyard's own code workspace, the one on the repository the live copy runs from.
 */

/** Why a report wasn't filed. */
export type FrictionProblem =
  | { readonly kind: "nowhere" }
  | { readonly kind: "session"; readonly error: SessionError };

export const createFriction = (options: {
  contextDir: string;
  /** The live copy this worker runs from, when it's one (ADR 0011). */
  liveCopy: string | null;
  /** The repository the live copy is on GitHub, as `workspace-main/` reads it. */
  liveRepo: () => Promise<string | undefined>;
  code: Pick<Code, "onGitHub">;
  sessions: Pick<Sessions, "create">;
}) => {
  const { contextDir, liveCopy } = options;

  /** The code workspace on the live copy's repository, if one is. */
  const courtyard = async () => {
    const repo = await options.liveRepo();
    if (repo === undefined) return undefined;
    const listed = await listWorkspaces(contextDir);
    if (!listed.ok) return undefined;
    for (const summary of listed.value.filter((each) => each.mode === "code")) {
      const workspace = await getWorkspace(contextDir, summary.id);
      if (!workspace.ok || workspace.value.repoPath === null) continue;
      const onGitHub = await options.code.onGitHub(workspace.value.repoPath);
      if (onGitHub.ok && onGitHub.value === repo) return summary;
    }
    return undefined;
  };

  return {
    /** Where a report goes, and the version running (`FrictionPlace`). */
    place: async (): Promise<FrictionPlace> => {
      const [workspace, version] = await Promise.all([
        courtyard(),
        liveCopy === null ? undefined : gitOrNothing(liveCopy, ["rev-parse", "--short=7", "HEAD"]),
      ]);
      return {
        workspace: workspace === undefined ? null : { id: workspace.id, name: workspace.name },
        version: version ?? null,
      };
    },

    /**
     * Files a report (docs/ai-conduct.md, Coding): a session in Courtyard's code workspace whose
     * first message is the worker's, with the screen attached when it could be taken. Like a
     * grill, it claims nothing and takes no place among the code sessions running.
     */
    file: async (
      report: FrictionReport,
      screen: PreparedAttachment | undefined,
    ): Promise<Result<SessionSummary, FrictionProblem>> => {
      const workspace = await courtyard();
      if (workspace === undefined) return err({ kind: "nowhere" });
      const title = `Something's off: ${report.said.replace(/\s+/g, " ")}`;
      const created = await options.sessions.create({
        workspaceId: workspace.id,
        message: { text: frictionMessage({ ...report, picture: screen !== undefined }) },
        ...(screen === undefined ? {} : { attachments: [screen] }),
        title:
          title.length > SESSION_TITLE_MAX_LENGTH
            ? `${title.slice(0, SESSION_TITLE_MAX_LENGTH).replace(/\s+\S*$/, "")}…`
            : title,
        placeless: true,
      });
      return created.ok ? ok(created.value) : err({ kind: "session", error: created.error });
    },
  };
};

export type Friction = ReturnType<typeof createFriction>;
