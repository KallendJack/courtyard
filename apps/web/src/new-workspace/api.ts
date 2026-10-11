import { GitHubRepoList } from "@courtyard/contract";
import { fromWorker } from "../worker.ts";

// New workspace's calls live with it rather than in worker.ts, so they stay off the first load.

/** The owner's GitHub repos New workspace → Code offers (#258), each marked when it's added. */
export const loadRepos = () => fromWorker("/github/repos", GitHubRepoList);
