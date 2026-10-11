import { z } from "zod";

// In a file of its own, so a new workspace's schema can name it without bringing the rest of
// GitHub's shapes onto the first load.

/** A repository on GitHub as `owner/name`, in the letters GitHub allows. */
export const GitHubRepoName = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
