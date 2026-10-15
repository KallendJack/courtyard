import { join } from "node:path";
import { z } from "zod";
import type { FoundCheckRun, FoundMilestone, GitHub } from "../../integrations/github/index.ts";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { gitOrNothing } from "../../lib/git.ts";
import type { Code } from "../code/index.ts";
import { buildOrderOf, milestoneRank, READY_LABEL } from "../next-up/index.ts";
import { listCodeWorkspaces } from "../workspaces/index.ts";

/**
 * A red main (#355): when main's build fails on a code workspace's repository, the worker re-runs
 * its failed jobs once, by itself; if they fail again, it files a bug, ready for a model to build,
 * in the current milestone, first in its `Build order:` line. Nobody waits on main for it, and no
 * session is held open: it's one of the worker's repeating jobs.
 */

/** Where what was done about each repository's main is kept, in the data folder. */
const FILE = "red-main.json";

/** The labels a red main's issue carries (Matt Pocock's triage labels). */
const LABELS = ["bug", READY_LABEL];

/** The longest title GitHub shows whole in a list. */
const TITLE_MAX_LENGTH = 200;

/** What was done about main's newest commit in one repository. */
const Done = z.object({
  commit: z.string(),
  /** The re-run: the failed jobs it replaces, and why GitHub wouldn't, if it wouldn't. */
  rerun: z.object({ replaces: z.array(z.number()), refused: z.string().nullable() }).nullable(),
  /** The issue filed, by its number. */
  filed: z.number().nullable(),
});
type Done = z.infer<typeof Done>;
const Kept = z.object({ repos: z.record(z.string(), Done) });

/** The milestone work goes in first: the lowest-numbered open one (docs/agents/roadmap.md). */
const currentOf = (milestones: readonly FoundMilestone[]) =>
  [...milestones].sort((a, b) => {
    const [rankA, numberA] = milestoneRank(a.title);
    const [rankB, numberB] = milestoneRank(b.title);
    return rankA - rankB || numberA - numberB;
  })[0];

/** A milestone's description with issue `number` first in its `Build order:` line, or a new one. */
const putFirst = (description: string, number: number) => {
  const order = buildOrderOf(description);
  if (order.includes(number)) return description;
  const line = /build order:[ \t]*/i.exec(description);
  if (line === null) {
    return description.trim() === ""
      ? `Build order: #${number}.`
      : `Build order: #${number}. ${description}`;
  }
  const at = line.index + line[0].length;
  const then = order.length > 0 ? " → " : "";
  return `${description.slice(0, at)}#${number}${then}${description.slice(at)}`;
};

const titleOf = (test: string) => {
  const title = `Main fails: ${test}`;
  return title.length <= TITLE_MAX_LENGTH
    ? title
    : `${title.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
};

const bodyOf = (filing: { commit: string; test: string; job: FoundCheckRun; done: Done }) => {
  const { commit, test, job, done } = filing;
  const again =
    done.rerun === null || done.rerun.refused === null
      ? "and again when Courtyard's worker re-ran its failed jobs"
      : `and Courtyard's worker couldn't re-run its failed jobs (${done.rerun.refused})`;
  return [
    `Main's build failed on ${commit.slice(0, 7)}, ${again}, so nothing on main goes live until it's fixed.`,
    "",
    `- **Failed:** ${test}`,
    `- **Job:** [${job.name}](${job.url})`,
    `- **Commit:** ${commit}`,
  ].join("\n");
};

export const createRedMain = (options: {
  contextDir: string;
  dataDir: string;
  code: Pick<Code, "onGitHub" | "freshDefault">;
  github: Pick<
    GitHub,
    | "commitJobs"
    | "rerunFailedJobs"
    | "checkRunFailure"
    | "openMilestones"
    | "describeMilestone"
    | "createIssue"
  >;
}) => {
  const { code, github } = options;
  const keptFile = join(options.dataDir, FILE);

  const keep = async (repo: string, done: Done) => {
    const kept = await readJsonFile(keptFile, Kept);
    const repos = kept.ok ? (kept.value?.repos ?? {}) : {};
    const written = await writeJsonFile(keptFile, { repos: { ...repos, [repo]: done } });
    if (!written.ok) console.error(`What was done about ${repo}'s red main couldn't be kept`);
  };

  /** Files the failure on main, first in the current milestone's build order. */
  const fileIssue = async (repo: string, failed: FoundCheckRun, done: Done) => {
    const named = await github.checkRunFailure({ repo, id: failed.id });
    const test = named.ok && named.value !== null ? named.value : failed.name;
    const milestones = await github.openMilestones({ repo });
    const current = milestones.ok ? currentOf(milestones.value) : undefined;
    const created = await github.createIssue({
      repo,
      title: titleOf(test),
      body: bodyOf({ commit: done.commit, test, job: failed, done }),
      labels: LABELS,
      milestone: current?.number ?? null,
    });
    // Tried again next time round.
    if (!created.ok) return console.error(`${repo}'s red main couldn't be filed`, created.error);
    await keep(repo, { ...done, filed: created.value.number });
    if (current === undefined) return;
    const described = await github.describeMilestone({
      repo,
      number: current.number,
      description: putFirst(current.description, created.value.number),
    });
    if (!described.ok) {
      console.error(`#${created.value.number} couldn't be put first in ${current.title}`);
    }
  };

  /** Looks at main's newest commit in `repo`, re-running or filing it when it's red. */
  const look = async (repo: string, repoPath: string) => {
    const fresh = await code.freshDefault(repoPath);
    if (!fresh.ok) return;
    const commit = (await gitOrNothing(repoPath, ["rev-parse", fresh.value.tracking]))?.trim();
    if (commit === undefined || commit === "") return;
    const jobs = await github.commitJobs({ repo, commit });
    // Signed out, or GitHub out of reach: asked again next time round.
    if (!jobs.ok || jobs.value === undefined) return;
    if (jobs.value.some((job) => job.outcome === "running")) return;
    const failed = jobs.value.filter((job) => job.outcome === "failed");
    const [first] = failed;
    if (first === undefined) return;

    const kept = await readJsonFile(keptFile, Kept);
    const last = kept.ok ? kept.value?.repos[repo] : undefined;
    const done = last?.commit === commit ? last : { commit, rerun: null, filed: null };
    if (done.filed !== null) return;
    if (done.rerun === null) {
      const rerun = await github.rerunFailedJobs({ repo, commit });
      const refused = rerun.ok
        ? null
        : rerun.error.kind === "github"
          ? rerun.error.message
          : "not signed in";
      // Refused, there's no new try to wait for: it's filed next time round.
      const replaces = rerun.ok ? failed.map((job) => job.id) : [];
      return keep(repo, { ...done, rerun: { replaces, refused } });
    }
    // GitHub hasn't started the new try yet.
    if (failed.some((job) => done.rerun?.replaces.includes(job.id))) return;
    await fileIssue(repo, first, done);
  };

  return {
    /** For the worker's repeating jobs: looks at each code workspace's main once. */
    watch: async () => {
      const workspaces = await listCodeWorkspaces(options.contextDir);
      if (!workspaces.ok) return;
      const seen = new Set<string>();
      for (const { repoPath } of workspaces.value) {
        const repo = await code.onGitHub(repoPath);
        if (!repo.ok || seen.has(repo.value)) continue;
        seen.add(repo.value);
        await look(repo.value, repoPath);
      }
    },
  };
};

export type RedMain = ReturnType<typeof createRedMain>;
