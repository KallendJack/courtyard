import { z } from "zod";
import { GitHubRepoName } from "./github-repo-name.ts";

// In a file of their own, so only New workspace, which loads with its page, carries them: the
// first load has a budget.

/**
 * One of the owner's repos New workspace → Code offers (#258): those Courtyard's GitHub App
 * reaches, with what GitHub says of each. Never where it's cloned from or kept.
 */
export const GitHubRepo = z.object({
  /** `owner/name`. */
  repo: GitHubRepoName,
  /** Its name alone, as the picker shows it. */
  name: z.string(),
  /** Its description on GitHub, or `null` when it has none. */
  description: z.string().nullable(),
  private: z.boolean(),
  /** A code workspace works on it already, so it isn't offered again. */
  added: z.boolean(),
});
export type GitHubRepo = z.infer<typeof GitHubRepo>;

/** The owner's repos, newest pushed first, the ones already added last. */
export const GitHubRepoList = z.object({ repos: z.array(GitHubRepo) });
export type GitHubRepoList = z.infer<typeof GitHubRepoList>;
