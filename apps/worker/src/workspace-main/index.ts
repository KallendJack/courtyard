import type { WorkspaceMain } from "@courtyard/contract";
import type { Code } from "../code/index.ts";
import { gitOrNothing } from "../git.ts";
import type { GitHub } from "../github/index.ts";
import { err, ok, type Result } from "../result.ts";
import { getWorkspace, type WorkspaceError } from "../workspaces/index.ts";

/**
 * A code workspace's main (#301's Main row): its default branch's newest commit, freshly fetched,
 * and that commit's build as #249 reads it from GitHub, asked for only when a page asks and kept a
 * little while; and whether the repository is the one Courtyard's live copy runs from, the only
 * one Home offers Update on.
 */

/** How long an answer is kept while its build runs, and once it has finished. */
const KEEP_RUNNING_MS = 15 * 1000;
const KEEP_MS = 60 * 1000;

/** Why a workspace's main can't be shown. */
export type WorkspaceMainProblem =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  | { readonly kind: "not-code" }
  /** Its repository isn't on GitHub, or its main couldn't be fetched or read. */
  | { readonly kind: "unknown" };

const FIELD = "\x1f";

export const createWorkspaceMain = (options: {
  contextDir: string;
  code: Pick<Code, "onGitHub" | "freshDefault">;
  github: Pick<GitHub, "mainBuild">;
  /** The live copy this worker runs from, when it's one (ADR 0011). */
  liveCopy: string | null;
  now: () => number;
}) => {
  const { code, now } = options;
  const kept = new Map<string, { readonly at: number; readonly main: WorkspaceMain }>();

  /** The repository the live copy is on GitHub, once read. */
  let liveRepo: Promise<string | undefined> | undefined;
  const liveRepoOf = () => {
    const { liveCopy } = options;
    if (liveCopy === null) return Promise.resolve(undefined);
    liveRepo ??= code.onGitHub(liveCopy).then((repo) => (repo.ok ? repo.value : undefined));
    return liveRepo;
  };

  return {
    of: async (rawId: string): Promise<Result<WorkspaceMain, WorkspaceMainProblem>> => {
      const workspace = await getWorkspace(options.contextDir, rawId);
      if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
      const { repoPath, summary } = workspace.value;
      if (summary.mode !== "code" || repoPath === null) return err({ kind: "not-code" });
      const repo = await code.onGitHub(repoPath);
      if (!repo.ok) return err({ kind: "unknown" });
      const last = kept.get(repo.value);
      const keepFor = last?.main.build?.kind === "running" ? KEEP_RUNNING_MS : KEEP_MS;
      if (last !== undefined && now() - last.at < keepFor) return ok(last.main);

      const fresh = await code.freshDefault(repoPath);
      if (!fresh.ok) return err({ kind: "unknown" });
      const read = await gitOrNothing(repoPath, [
        "log",
        "-2",
        `--format=%H${FIELD}%h %s`,
        fresh.value.tracking,
      ]);
      const [newest, previous] = (read ?? "")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => {
          const [commit = "", title = ""] = line.split(FIELD);
          return { commit, title };
        });
      if (newest === undefined) return err({ kind: "unknown" });
      const build = await options.github.mainBuild({
        repo: repo.value,
        commit: newest.commit,
        previous: previous?.commit ?? null,
      });
      const main: WorkspaceMain = {
        newest,
        // No checks at all says nothing about main: the row shows none.
        build: build.ok && build.value !== undefined && build.value.jobs.length > 0 ? build.value : null,
        liveCopy: (await liveRepoOf()) === repo.value,
      };
      kept.set(repo.value, { at: now(), main });
      return ok(main);
    },
  };
};

export type WorkspaceMainOf = ReturnType<typeof createWorkspaceMain>;
