import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { GitHubRepo } from "@courtyard/contract";
import type { Code } from "../code/index.ts";
import { isFolder, removeFolder } from "../files.ts";
import { git, gitFailureReason } from "../git.ts";
import type { FoundRepo, GitHub, GitHubProblem } from "../github/index.ts";
import { createOneAtATime } from "../one-at-a-time.ts";
import { err, ok, type Result } from "../result.ts";
import { listCodeWorkspaces, type WorkspaceError } from "../workspaces/index.ts";

/**
 * The owner's GitHub repos as code workspaces (#258): the repos Courtyard's GitHub App reaches,
 * each marked when a code workspace works on it already, and getting one onto the worker machine
 * for a new code workspace. A repo goes into the data folder's `repos/<owner>/<name>`, cloned with
 * Courtyard's own GitHub sign-in, the way code sessions fetch (#99): the token is never in the
 * address git keeps, nor in its settings.
 */

/** Where repos got from GitHub for code workspaces go, in the data folder. */
export const REPOS_FOLDER = "repos";

/** How long getting a repo may take: a large one comes down slowly. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** Why a repo couldn't be listed or got onto the worker machine. */
export type RepoProblem =
  | GitHubProblem
  /** The GitHub App doesn't reach it, or GitHub has no such repo. */
  | { readonly kind: "unreached"; readonly repo: string }
  /** A code workspace works on it already. */
  | { readonly kind: "added"; readonly repo: string; readonly workspace: string }
  /** The workspaces couldn't be read to tell. */
  | { readonly kind: "workspaces"; readonly error: WorkspaceError }
  /** Git couldn't get it, in git's own words. */
  | { readonly kind: "clone"; readonly repo: string; readonly reason: string };

/** A repo's name compared as GitHub does, case aside. */
const keyOf = (fullName: string) => fullName.toLowerCase();

/** Newest pushed first, one never pushed to after; the ones already added last. */
const byShown = (a: GitHubRepo & FoundRepo, b: GitHubRepo & FoundRepo) =>
  Number(a.added) - Number(b.added) || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");

export const createRepos = (options: {
  dataDir: string;
  contextDir: string;
  github: Pick<GitHub, "repos" | "commandEnv">;
  code: Pick<Code, "onGitHub">;
}) => {
  const { github } = options;
  const reposFolder = resolve(options.dataDir, REPOS_FOLDER);
  /** Where a repo goes in the data folder. */
  const folderOf = (fullName: string) => join(reposFolder, ...fullName.split("/"));
  /** Getting repos, one at a time, so two asks for the same one never clone over each other. */
  const oneAtATime = createOneAtATime();

  /**
   * Which workspace works on each repo, by the repo's name: one whose repository is a repo's
   * folder here, or whose remote is on GitHub (a checkout of the owner's own, named by hand).
   */
  const workspacesByRepo = async (): Promise<Result<Map<string, string>, RepoProblem>> => {
    const workspaces = await listCodeWorkspaces(options.contextDir);
    if (!workspaces.ok) return err({ kind: "workspaces", error: workspaces.error });
    const byRepo = new Map<string, string>();
    for (const { summary, repoPath } of workspaces.value) {
      const here = relative(reposFolder, resolve(repoPath));
      const parts = here.split(/[\\/]/);
      const inReposFolder =
        here !== "" && !here.startsWith("..") && !isAbsolute(here) && parts.length === 2;
      const onGitHub = inReposFolder ? ok(parts.join("/")) : await options.code.onGitHub(repoPath);
      if (onGitHub.ok) byRepo.set(keyOf(onGitHub.value), summary.name);
    }
    return ok(byRepo);
  };

  /** The repos the GitHub App reaches, each marked when a code workspace works on it. */
  const listed = async (): Promise<
    Result<(GitHubRepo & FoundRepo & { workspace?: string })[], RepoProblem>
  > => {
    const [found, byRepo] = await Promise.all([github.repos(), workspacesByRepo()]);
    if (!found.ok) return found;
    if (!byRepo.ok) return byRepo;
    return ok(
      found.value
        .map((repo) => {
          const workspace = byRepo.value.get(keyOf(repo.fullName));
          return {
            ...repo,
            repo: repo.fullName,
            name: repo.fullName.split("/").at(-1) ?? repo.fullName,
            added: workspace !== undefined,
            ...(workspace === undefined ? {} : { workspace }),
          };
        })
        .sort(byShown),
    );
  };

  /** Clones a repo into its folder here, or leaves what's there when it's a git repository already. */
  const fetch = async (repo: FoundRepo): Promise<Result<string, RepoProblem>> => {
    const folder = folderOf(repo.fullName);
    const there = await isFolder(folder);
    if (!there.ok) {
      return err({ kind: "clone", repo: repo.fullName, reason: "its folder can't be read" });
    }
    if (there.value) {
      // Its own `.git`, not a repository further up that the data folder happens to be in.
      const cloned = await isFolder(join(folder, ".git"));
      if (cloned.ok && cloned.value) return ok(folder);
      return err({
        kind: "clone",
        repo: repo.fullName,
        reason: `${folder} is there already and isn't a git repository`,
      });
    }
    try {
      await mkdir(dirname(folder), { recursive: true });
      await git(dirname(folder), ["clone", "--quiet", "--", repo.cloneUrl, folder], {
        timeoutMs: CLONE_TIMEOUT_MS,
        env: await github.commandEnv(),
      });
      return ok(folder);
    } catch (error) {
      // Half a clone would only be in the way of the next try.
      await removeFolder(folder);
      return err({ kind: "clone", repo: repo.fullName, reason: gitFailureReason(error) });
    }
  };

  return {
    /** The repos New workspace → Code offers, as the browser shows them. */
    list: async (): Promise<Result<GitHubRepo[], RepoProblem>> => {
      const repos = await listed();
      if (!repos.ok) return repos;
      return ok(
        repos.value.map(({ repo, name, description, private: hidden, added }) => ({
          repo,
          name,
          description,
          private: hidden,
          added,
        })),
      );
    },

    /**
     * Gets `fullName` onto the worker machine for a new code workspace, unless it's here already:
     * the folder it's in. Refuses one the GitHub App doesn't reach, or one a code workspace works
     * on already.
     */
    place: (fullName: string): Promise<Result<string, RepoProblem>> =>
      oneAtATime(async () => {
        const repos = await listed();
        if (!repos.ok) return repos;
        const repo = repos.value.find((each) => keyOf(each.fullName) === keyOf(fullName));
        if (repo === undefined) return err({ kind: "unreached", repo: fullName });
        if (repo.workspace !== undefined) {
          return err({ kind: "added", repo: repo.name, workspace: repo.workspace });
        }
        return fetch(repo);
      }),
  };
};

export type Repos = ReturnType<typeof createRepos>;
