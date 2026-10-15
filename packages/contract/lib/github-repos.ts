import { z } from "zod";
import { GitHubRepoName } from "./github-repo-name.ts";
import { SetupPaper } from "./matt-setup.ts";
import {
  CONTEXT_LINE_MAX_CHARACTERS,
  WORKSPACE_NAME_MAX_LENGTH,
  WorkspaceSummary,
} from "./workspace.ts";

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

/**
 * What New workspace → Code needs besides the repos (#391): the account a new repo is made on,
 * and whether Courtyard can make it a Paper file.
 */
export const NewRepoOffer = z.object({ account: z.string(), paper: z.boolean() });
export type NewRepoOffer = z.infer<typeof NewRepoOffer>;

/** The longest new repo name: a workspace's longest, since its workspace is named from it. */
export const REPO_NAME_MAX_LENGTH = WORKSPACE_NAME_MAX_LENGTH;

/** A new repo's name as GitHub takes one: letters, digits, `.`, `-` and `_`, never `.` or `..`. */
export const NewRepoName = z
  .string()
  .trim()
  .min(1, "Give the repo a name.")
  .max(REPO_NAME_MAX_LENGTH, `Keep the repo's name to ${REPO_NAME_MAX_LENGTH} characters.`)
  .regex(/^[A-Za-z0-9._-]+$/, "A repo's name is letters, digits, dots, dashes and underscores.")
  .refine((name) => name !== "." && name !== "..", "That can't be a repo's name.");

/**
 * New repo (#391): a GitHub repo made on the owner's account, on the house standard, and a code
 * workspace on it, with a Paper file when asked.
 */
export const NewRepo = z.object({
  name: NewRepoName,
  /** What it's for, in one line: its description on GitHub, and its first idea to grill. */
  intro: z
    .string()
    .trim()
    .max(
      CONTEXT_LINE_MAX_CHARACTERS,
      `Keep what it's for to ${CONTEXT_LINE_MAX_CHARACTERS} characters.`,
    )
    .refine((line) => !/[\r\n]/.test(line), "Keep what it's for to one line."),
  private: z.boolean(),
  paper: z.boolean(),
});
export type NewRepo = z.infer<typeof NewRepo>;

/** A new repo made: its code workspace, and what happened to its Paper file. */
export const NewRepoMade = z.object({ workspace: WorkspaceSummary, paper: SetupPaper });
export type NewRepoMade = z.infer<typeof NewRepoMade>;

/** The words people leave out of a repo's name. */
const SMALL_WORDS = new Set(
  "a an and the for of to in on at by with my our your both all every each from into about track keep make".split(
    " ",
  ),
);

/**
 * A repo's name from what was said it's for (#391), for the owner to change: the words of its
 * first part (up to a colon, comma or full stop) that carry meaning, three at most, in lower case,
 * joined by dashes ("Track servicing for both bikes: parts…" → "servicing-bikes").
 */
export const repoNameFrom = (words: string) =>
  (words.split(/[:,.;]/)[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !SMALL_WORDS.has(word))
    .slice(0, 3)
    .join("-")
    .slice(0, 40);

/** A repo's name as a workspace's: its words, each with a capital (garrett-kitchens → Garrett Kitchens). */
export const workspaceNameFrom = (repo: string) =>
  repo
    .split(/[-_.\s]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
