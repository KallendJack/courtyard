/** Where session branches' names start, so the owner can tell Courtyard's from their own. */
export const BRANCH_PREFIX = "courtyard/";

/**
 * Where a session's helpers' branches' names start (#395): its own branch's, under `courtyard/`
 * for one the session didn't make (#326), so they're Courtyard's to clear away.
 */
export const helperBranchStem = (sessionBranch: string) =>
  `${sessionBranch.startsWith(BRANCH_PREFIX) ? "" : BRANCH_PREFIX}${sessionBranch}-helper-`;

/** Whether `branch` is one of a session's helpers' own branches (#395), by its name. */
export const isHelperBranchOf = (sessionBranch: string, branch: string) => {
  const stem = helperBranchStem(sessionBranch);
  return branch.startsWith(stem) && /^\d+$/.test(branch.slice(stem.length));
};
