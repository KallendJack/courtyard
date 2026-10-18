import { join } from "node:path";
import type { BumpStanding, PullRequestChecks } from "@courtyard/contract";
import { z } from "zod";
import type { FoundCheckRun, FoundPullRequest, GitHub } from "../../integrations/github/index.ts";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import type { Code } from "../code/index.ts";
import { fileInBuildOrder } from "../next-up/build-order.ts";
import { READY_LABEL } from "../next-up/index.ts";
import { listCodeWorkspaces } from "../workspaces/index.ts";

/**
 * Dependabot's version bumps (#84) look after themselves (#496), as a red main does (#355): when a
 * check fails on a bump's newest commit, the worker re-runs the failed jobs once, by itself. If
 * the re-run passes, the test was flaky, and it files "Flaky e2e" last in the build order (or
 * comments on the one there); if it fails, it files "Bump fails" first, one per bump, for the Lead
 * to fix on a branch of its own. Once that issue is closed (its fix merged), it asks Dependabot to
 * rebase; a bump still failing after that is the owner's, in Needs you. Only Dependabot's pull
 * requests: one the owner opened on GitHub is their work.
 */

/** Where what was done about each bump is kept, in the data folder. */
const FILE = "version-bumps.json";

/** Dependabot's login on GitHub: who opens its pull requests. */
export const DEPENDABOT = "dependabot[bot]";

/** The labels a bump's issue carries (Matt Pocock's triage labels). */
const LABELS = ["bug", READY_LABEL];

/** What was done about one bump. */
const Bump = z.object({
  /** The commit the re-run and its outcome are about: the bump's newest when last looked at. */
  head: z.string(),
  /** The re-run on `head`: the failed jobs it replaces, and why GitHub wouldn't, if it wouldn't. */
  rerun: z
    .object({
      replaces: z.array(z.object({ id: z.number(), name: z.string(), url: z.string() })),
      refused: z.string().nullable(),
    })
    .nullable(),
  /** What the re-run on `head` showed, once filed: a flaky test, or a bump that fails. */
  outcome: z.enum(["flaky", "failed"]).nullable(),
  /** Its "Bump fails" issue, by number: one per bump, whatever its commit. */
  issue: z.number().nullable(),
  /** The commit Dependabot was asked to rebase once that issue closed, its fix merged. */
  rebasedFrom: z.string().nullable(),
});
type Bump = z.infer<typeof Bump>;
const Kept = z.object({ repos: z.record(z.string(), z.record(z.string(), Bump)) });

const isBump = (pull: FoundPullRequest) => pull.author === DEPENDABOT;

/**
 * Where a bump stands for the PRs tab and Needs you, from what was done about it and its checks
 * now: nothing to say once they pass, or while nothing has failed.
 */
const standingOf = (
  pull: { head: string; checks: PullRequestChecks },
  bump: Bump | undefined,
): BumpStanding | undefined => {
  if (pull.checks.kind === "passed") return undefined;
  const now = bump?.head === pull.head ? bump : undefined;
  if (now?.outcome === "failed" && now.issue !== null) {
    const stuck = now.rebasedFrom !== null && now.rebasedFrom !== now.head;
    return { kind: stuck ? "stuck" : "fixing", issue: now.issue };
  }
  if (pull.checks.kind === "failed") return { kind: "rerunning" };
  return now?.rerun !== null && now?.rerun !== undefined && now.outcome === null
    ? { kind: "rerunning" }
    : undefined;
};

const bodyOf = (failing: {
  pull: FoundPullRequest;
  test: string;
  job: { name: string; url: string };
  refused: string | null;
}) => {
  const { pull, test, job, refused } = failing;
  const again =
    refused === null
      ? "and again when Courtyard's worker re-ran its failed jobs"
      : `and Courtyard's worker couldn't re-run its failed jobs (${refused})`;
  return [
    `Dependabot's [#${pull.number} ${pull.title}](${pull.url}) failed its checks on ${pull.head.slice(0, 7)}, ${again}.`,
    "",
    `- **Failed:** ${test}`,
    `- **Job, with its log:** [${job.name}](${job.url})`,
    "",
    "Fix it on a branch of its own from main, never on Dependabot's branch: Dependabot stops rebasing a branch someone else pushed to. Once the fix merges, Courtyard asks Dependabot to rebase the bump.",
  ].join("\n");
};

export const createVersionBumps = (options: {
  contextDir: string;
  dataDir: string;
  code: Pick<Code, "onGitHub">;
  github: Pick<
    GitHub,
    | "openPullRequests"
    | "commitJobs"
    | "rerunFailedJobs"
    | "checkRunFailure"
    | "openIssues"
    | "commentOnIssue"
    | "openMilestones"
    | "describeMilestone"
    | "createIssue"
  >;
}) => {
  const { code, github } = options;
  const keptFile = join(options.dataDir, FILE);

  const keptIn = async (repo: string) => {
    const kept = await readJsonFile(keptFile, Kept);
    return kept.ok ? (kept.value?.repos[repo] ?? {}) : {};
  };

  const keep = async (repo: string, bumps: Record<string, Bump>) => {
    const kept = await readJsonFile(keptFile, Kept);
    const repos = kept.ok ? (kept.value?.repos ?? {}) : {};
    const written = await writeJsonFile(keptFile, { repos: { ...repos, [repo]: bumps } });
    if (!written.ok) console.error(`What was done about ${repo}'s version bumps couldn't be kept`);
  };

  /** The test a failed job names, else the job's own name. */
  const testOf = async (repo: string, job: { id: number; name: string }) => {
    const named = await github.checkRunFailure({ repo, id: job.id });
    return named.ok && named.value !== null ? named.value : job.name;
  };

  /** The open bug titled `title` in `repo`, if there is one; `undefined` too if it can't be told. */
  const openBug = async (repo: string, title: string) => {
    const open = await github.openIssues({ repo, label: "bug", forBuild: false });
    return open.ok ? open.value.find((issue) => issue.title === title) : undefined;
  };

  const comment = async (repo: string, number: number, body: string) => {
    const made = await github.commentOnIssue({ repo, number, body });
    if (!made.ok) console.error(`#${number} couldn't be commented on`, made.error);
    return made.ok;
  };

  /** The re-run passed: the test is flaky, filed last in the order, or noted on its issue. */
  const fileFlaky = async (
    repo: string,
    pull: FoundPullRequest,
    job: { id: number; name: string; url: string },
  ) => {
    const test = await testOf(repo, job);
    const title = `Flaky e2e: ${test}`;
    const known = await openBug(repo, title);
    if (known !== undefined) return comment(repo, known.number, `Seen again on #${pull.number}.`);
    const filed = await fileInBuildOrder(github, {
      repo,
      title,
      body: [
        `${test} failed on Dependabot's #${pull.number} (${pull.head.slice(0, 7)}) and passed when Courtyard's worker re-ran it, so the test is flaky, not the bump.`,
        "",
        `- **Job, with its log:** [${job.name}](${job.url})`,
        "",
        "Find and fix the real cause, as in #495.",
      ].join("\n"),
      labels: LABELS,
      place: "last",
    });
    if (!filed.ok) console.error(`${repo}'s flaky test couldn't be filed`, filed.error);
    return filed.ok;
  };

  /** The re-run failed too: the bump's issue, filed first in the order, or a comment on it. */
  const fileFailing = async (
    repo: string,
    pull: FoundPullRequest,
    bump: Bump,
    failed: FoundCheckRun,
  ): Promise<Bump | undefined> => {
    const test = await testOf(repo, failed);
    const refused = bump.rerun?.refused ?? null;
    if (bump.issue !== null) {
      const after = bump.rebasedFrom !== null;
      const said = after
        ? `Still failing after the fix, on ${pull.head.slice(0, 7)}: ${test} ([${failed.name}](${failed.url})). It's with the owner now.`
        : `Failed again on ${pull.head.slice(0, 7)}: ${test} ([${failed.name}](${failed.url})).`;
      return (await comment(repo, bump.issue, said)) ? { ...bump, outcome: "failed" } : undefined;
    }
    const filed = await fileInBuildOrder(github, {
      repo,
      title: `Bump fails: ${pull.title}`,
      body: bodyOf({ pull, test, job: failed, refused }),
      labels: LABELS,
      place: "first",
    });
    if (!filed.ok) {
      console.error(`${repo}'s failing bump couldn't be filed`, filed.error);
      return undefined;
    }
    return { ...bump, outcome: "failed", issue: filed.value };
  };

  /** Once its issue has closed, its fix merged, Dependabot is asked to rebase the bump. */
  const rebaseOnceFixed = async (repo: string, pull: FoundPullRequest, bump: Bump) => {
    if (bump.issue === null || bump.rebasedFrom !== null) return bump;
    const open = await github.openIssues({ repo, label: "bug", forBuild: false });
    if (!open.ok || open.value.some((issue) => issue.number === bump.issue)) return bump;
    return (await comment(repo, pull.number, "@dependabot rebase"))
      ? { ...bump, rebasedFrom: pull.head }
      : bump;
  };

  /** Looks at one bump's newest commit: what's to be done about it now. */
  const look = async (repo: string, pull: FoundPullRequest, last: Bump | undefined) => {
    const bump: Bump =
      last?.head === pull.head
        ? last
        : {
            head: pull.head,
            rerun: null,
            outcome: null,
            issue: last?.issue ?? null,
            rebasedFrom: last?.rebasedFrom ?? null,
          };
    if (bump.outcome === "failed") return rebaseOnceFixed(repo, pull, bump);
    if (bump.outcome !== null) return bump;
    const jobs = await github.commitJobs({ repo, commit: pull.head });
    // Signed out, or GitHub out of reach: asked again next time round.
    if (!jobs.ok || jobs.value === undefined) return bump;
    if (jobs.value.some((job) => job.outcome === "running")) return bump;
    const failed = jobs.value.filter((job) => job.outcome === "failed");
    const [first] = failed;
    const { rerun } = bump;
    if (first === undefined) {
      const [flaky] = rerun?.refused === null ? rerun.replaces : [];
      if (flaky === undefined) return bump;
      return (await fileFlaky(repo, pull, flaky)) ? { ...bump, outcome: "flaky" as const } : bump;
    }
    if (rerun === null) {
      const asked = await github.rerunFailedJobs({ repo, commit: pull.head });
      const refused = asked.ok
        ? null
        : asked.error.kind === "github"
          ? asked.error.message
          : "not signed in";
      // Refused, there's no new try to wait for: it's filed next time round.
      const replaces = asked.ok ? failed.map(({ id, name, url }) => ({ id, name, url })) : [];
      return { ...bump, rerun: { replaces, refused } };
    }
    // GitHub hasn't started the new try yet.
    if (failed.some((job) => rerun.replaces.some((replaced) => replaced.id === job.id))) {
      return bump;
    }
    return (await fileFailing(repo, pull, bump, first)) ?? bump;
  };

  /** Looks at each open bump in `repo`, keeping what was done about those still open. */
  const watchRepo = async (repo: string) => {
    const open = await github.openPullRequests({ repo });
    if (!open.ok) return;
    const kept = await keptIn(repo);
    const bumps: Record<string, Bump> = {};
    for (const { found } of open.value) {
      if (!isBump(found)) continue;
      bumps[found.number] = await look(repo, found, kept[found.number]);
    }
    await keep(repo, bumps);
  };

  return {
    /** For the worker's repeating jobs: looks at each code workspace's bumps once. */
    watch: async () => {
      const workspaces = await listCodeWorkspaces(options.contextDir);
      if (!workspaces.ok) return;
      const seen = new Set<string>();
      for (const { repoPath } of workspaces.value) {
        const repo = await code.onGitHub(repoPath);
        if (!repo.ok || seen.has(repo.value)) continue;
        seen.add(repo.value);
        await watchRepo(repo.value);
      }
    },

    /**
     * Where each of `repoPath`'s open pull requests stands as a bump, by number, for the PRs tab
     * and Needs you: read from what was kept, never asking GitHub.
     */
    standings: async (repoPath: string) => {
      const repo = await code.onGitHub(repoPath);
      const kept = repo.ok ? await keptIn(repo.value) : {};
      return (found: FoundPullRequest, checks: PullRequestChecks) =>
        isBump(found) ? standingOf({ head: found.head, checks }, kept[found.number]) : undefined;
    },
  };
};

export type VersionBumps = ReturnType<typeof createVersionBumps>;
