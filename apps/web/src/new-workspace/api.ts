import { GitHubRepoList, type NewRepo, NewRepoMade, NewRepoOffer } from "@courtyard/contract";
import { fromWorker, sendJson } from "../worker.ts";

// New workspace's calls live with it rather than in worker.ts, so they stay off the first load.

/** The owner's GitHub repos New workspace → Code offers (#258), each marked when it's added. */
export const loadRepos = () => fromWorker("/github/repos", GitHubRepoList);

/** What New repo needs to offer (#391): the account it's made on, and whether Paper can be made. */
export const loadNewRepoOffer = () => fromWorker("/github/repos/new", NewRepoOffer);

/** Makes a new repo on the house standard and a code workspace on it (#391). */
export const createRepo = (repo: NewRepo) =>
  sendJson({ path: "/github/repos/new", body: repo, schema: NewRepoMade });
