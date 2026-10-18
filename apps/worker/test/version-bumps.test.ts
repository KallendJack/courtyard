import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubConnection, OpenPullRequestList } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoundCheckRun } from "../src/integrations/github/api.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  type FakeGitHub,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// Dependabot's version bumps look after themselves (#496): the worker re-runs a failed check once
// per commit, files what the re-run shows for the Lead, asks Dependabot to rebase once the fix
// merges, and hands a bump still failing after that to the owner.

const DEPENDABOT = "dependabot[bot]";

let root: string;
let onGitHub: string;
let github: FakeGitHub;
let request: Requester;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

const runJobs = async () => {
  for (const job of jobs) await job();
};

let ids = 0;
const job = (name: string, outcome: FoundCheckRun["outcome"]): FoundCheckRun => {
  ids += 1;
  return {
    id: ids,
    name,
    outcome,
    url: `https://github.com/octo-owner/side-project/actions/runs/1/job/${ids}`,
    startedAt: "2026-10-12T09:00:00Z",
    completedAt: outcome === "running" ? null : "2026-10-12T09:03:00Z",
  };
};

/** The checks on pull request `number`'s commit `head` are now `runs`, every try of each. */
const checksOn = (number: number, head: string, runs: readonly FoundCheckRun[]) => {
  github.setCommitChecks(head, runs);
  const latest = new Map(runs.map((run) => [run.name, run.outcome]));
  github.setChecks(
    number,
    [...latest].map(([name, outcome]) => ({ name, outcome })),
    head,
  );
};

/** Dependabot opened a bump on commit `head`: its number. */
const bump = (head = "bump-1", title = "Bump the routine group with 3 updates") =>
  github.openPullRequest({
    repo: onGitHub,
    branch: `dependabot/npm_and_yarn/routine-${head}`,
    head,
    title,
    author: DEPENDABOT,
  });

const listed = async () =>
  OpenPullRequestList.parse(
    await (await request("/api/workspaces/side-project/pull-requests")).json(),
  ).pullRequests;

const listedAs = async (number: number) =>
  (await listed()).find((pull) => pull.pullRequest.number === number);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const made = await codeRepo(root);
  onGitHub = made.github;
  await codeWorkspace(root, "side-project", made.repo);
  github = createFakeGitHub({
    issues: { [onGitHub]: [{ number: 5, title: "Five", milestone: "4 · Code workspaces" }] },
    milestones: {
      [onGitHub]: {
        Later: "Parked ideas.",
        "4 · Code workspaces": "NOW. Build order: #4 → #5. Then stage 3.",
      },
    },
  });
  jobs = [];
  request = await asOwner(
    testWorker({
      root,
      github: github.api,
      repeat: (_everyMs, each) => {
        jobs.push(each);
      },
    }),
  );
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
    .toBe("signed-in");
});

afterEach(async () => {
  await removeTestFolder(root);
});

describe("a Dependabot bump (#496)", () => {
  it("has a failed check re-run once per commit, by the worker itself", async () => {
    const number = bump("bump-1");
    checksOn(number, "bump-1", [job("Checks", "passed"), job("E2E 2/4", "failed")]);

    await runJobs();
    // GitHub hasn't started the new try yet: the failed one is still the latest.
    await runJobs();

    expect(github.reruns()).toEqual([{ repo: onGitHub, commit: "bump-1" }]);
    expect(await listedAs(number)).toMatchObject({
      from: { kind: "dependabot" },
      bump: { kind: "rerunning" },
      waiting: "nothing",
    });

    // Dependabot rebased it: the new commit earns a fresh try.
    checksOn(number, "bump-2", [job("E2E 2/4", "failed")]);
    await runJobs();

    expect(github.reruns()).toEqual([
      { repo: onGitHub, commit: "bump-1" },
      { repo: onGitHub, commit: "bump-2" },
    ]);
  });

  it("passing on the re-run, files its test as flaky, last in the build order", async () => {
    const number = bump("bump-1");
    const failed = job("E2E 2/4", "failed");
    github.setFailure(failed.id, "[chromium] › review.spec.ts:88:3 › a review shows its diff");
    checksOn(number, "bump-1", [job("Checks", "passed"), failed]);
    await runJobs();
    checksOn(number, "bump-1", [job("Checks", "passed"), failed, job("E2E 2/4", "passed")]);

    await runJobs();
    await runJobs();

    const title = "Flaky e2e: [chromium] › review.spec.ts:88:3 › a review shows its diff";
    expect(github.issuesFiled()).toEqual([
      {
        number: 6,
        title,
        body: expect.stringContaining(failed.url),
        labels: ["bug", "ready-for-agent"],
        milestone: "4 · Code workspaces",
      },
    ]);
    expect(github.milestoneDescription(onGitHub, "4 · Code workspaces")).toBe(
      "NOW. Build order: #4 → #5 → #6. Then stage 3.",
    );
    // Its checks passed: it's the owner's to merge, from Dependabot.
    expect(await listedAs(number)).toMatchObject({
      from: { kind: "dependabot" },
      waiting: "merge",
    });

    // The same test, flaky on another bump: a comment on its issue, never a second one.
    const another = bump("other-1", "Bump zod from 4.6.7 to 4.6.8");
    const again = job("E2E 2/4", "failed");
    github.setFailure(again.id, "[chromium] › review.spec.ts:88:3 › a review shows its diff");
    checksOn(another, "other-1", [again]);
    await runJobs();
    checksOn(another, "other-1", [again, job("E2E 2/4", "passed")]);
    await runJobs();

    expect(github.issuesFiled()).toHaveLength(1);
    expect(github.commentsOn(onGitHub, 6)).toEqual([`Seen again on #${another}.`]);
  });

  it("failing on the re-run, is filed for the Lead first in the build order, once", async () => {
    const number = bump("bump-1", "Bump @types/node from 24.19.2 to 25.0.0");
    const first = job("Checks", "failed");
    checksOn(number, "bump-1", [first]);
    await runJobs();
    const failed = job("Checks", "failed");
    checksOn(number, "bump-1", [first, failed]);

    await runJobs();
    await runJobs();

    expect(github.reruns()).toHaveLength(1);
    expect(github.issuesFiled()).toEqual([
      {
        number: 6,
        title: "Bump fails: Bump @types/node from 24.19.2 to 25.0.0",
        body: expect.stringContaining(failed.url),
        labels: ["bug", "ready-for-agent"],
        milestone: "4 · Code workspaces",
      },
    ]);
    expect(github.milestoneDescription(onGitHub, "4 · Code workspaces")).toBe(
      "NOW. Build order: #6 → #4 → #5. Then stage 3.",
    );
    // The Lead has it: it shows only in the PRs tab.
    expect(await listedAs(number)).toMatchObject({
      bump: { kind: "fixing", issue: 6 },
      waiting: "nothing",
    });

    // Dependabot updated it, and it fails again: a comment on its issue, never a second one.
    checksOn(number, "bump-2", [job("Checks", "failed")]);
    await runJobs();
    checksOn(number, "bump-2", [job("Checks", "failed"), job("Checks", "failed")]);
    await runJobs();

    expect(github.issuesFiled()).toHaveLength(1);
    expect(github.commentsOn(onGitHub, 6)).toEqual([expect.stringMatching(/^Failed again on /)]);
    expect(github.commentsOn(onGitHub, number)).toEqual([]);
  });

  it("once its fix merges, is rebased; still failing after that, it's the owner's", async () => {
    const number = bump("bump-1");
    checksOn(number, "bump-1", [job("Checks", "failed")]);
    await runJobs();
    checksOn(number, "bump-1", [job("Checks", "failed"), job("Checks", "failed")]);
    await runJobs();
    const [filed] = github.issuesFiled();
    if (filed === undefined) throw new Error("Nothing was filed");

    // The Lead's fix merged, closing the issue.
    github.closeIssue(onGitHub, filed.number);
    await runJobs();
    await runJobs();

    expect(github.commentsOn(onGitHub, number)).toEqual(["@dependabot rebase"]);
    expect(await listedAs(number)).toMatchObject({ bump: { kind: "fixing" }, waiting: "nothing" });

    // Dependabot rebased it onto the fix, and it still fails after its one re-run.
    checksOn(number, "bump-2", [job("Checks", "failed")]);
    await runJobs();
    checksOn(number, "bump-2", [job("Checks", "failed"), job("Checks", "failed")]);
    await runJobs();
    await runJobs();

    expect(github.reruns()).toHaveLength(2);
    expect(github.issuesFiled()).toHaveLength(1);
    expect(github.commentsOn(onGitHub, number)).toEqual(["@dependabot rebase"]);
    expect(await listedAs(number)).toMatchObject({
      bump: { kind: "stuck", issue: filed.number },
      waiting: "failed",
    });
  });

  it("isn't one the owner opened: their failing PR is theirs, with no re-run", async () => {
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: "try-a-thing",
      head: "mine-1",
    });
    checksOn(number, "mine-1", [job("Checks", "failed")]);

    await runJobs();

    expect(github.reruns()).toEqual([]);
    expect(await listedAs(number)).toMatchObject({ waiting: "failed" });
    expect((await listedAs(number))?.bump).toBeUndefined();
  });
});
