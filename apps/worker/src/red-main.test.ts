import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubConnection } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoundCheckRun } from "./github/api.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  type FakeGitHub,
  gitIn,
  postJson,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// A red main after a merge (#355): the worker re-runs main's failed jobs once, by itself, and if
// they fail again, files a bug first in the current milestone's build order.

let root: string;
let onGitHub: string;
/** Main's newest commit. */
let head: string;
let github: FakeGitHub;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

const runJobs = async () => {
  for (const job of jobs) await job();
};

const job = (id: number, name: string, outcome: FoundCheckRun["outcome"]): FoundCheckRun => ({
  id,
  name,
  outcome,
  url: `https://github.com/octo-owner/side-project/actions/runs/1/job/${id}`,
  startedAt: "2026-10-12T09:00:00Z",
  completedAt: outcome === "running" ? null : "2026-10-12T09:03:00Z",
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const made = await codeRepo(root);
  onGitHub = made.github;
  head = (await gitIn(made.repo, "rev-parse", "HEAD")).trim();
  await codeWorkspace(root, "side-project", made.repo);
  github = createFakeGitHub({
    issues: {
      [onGitHub]: [
        { number: 5, title: "Five", milestone: "4 · Code workspaces" },
        { number: 6, title: "Six", milestone: "4 · Code workspaces" },
      ],
    },
    milestones: {
      [onGitHub]: {
        Later: "Parked ideas.",
        "5 · Stage 3": "Build order: #9.",
        "4 · Code workspaces": "NOW. Build order: #5 → #6. Then stage 3.",
      },
    },
  });
  jobs = [];
  const request = await asOwner(
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

describe("a red main (#355)", () => {
  it("has its failed jobs re-run once, by the worker itself", async () => {
    github.setCommitChecks(head, [job(1, "Checks", "passed"), job(2, "E2E 4/4", "failed")]);

    await runJobs();
    // GitHub hasn't started the new try yet: the failed one is still the latest.
    await runJobs();

    expect(github.reruns()).toEqual([{ repo: onGitHub, commit: head }]);
    expect(github.issuesFiled()).toEqual([]);
  });

  it("failing again, is filed as a bug first in the current milestone's build order", async () => {
    github.setCommitChecks(head, [job(1, "Checks", "passed"), job(2, "E2E 4/4", "failed")]);
    await runJobs();
    github.setCommitChecks(head, [
      job(1, "Checks", "passed"),
      job(2, "E2E 4/4", "failed"),
      job(3, "E2E 4/4", "failed"),
    ]);
    github.setFailure(3, "[chromium] › waiting.spec.ts:40:3 › a session waits for its reply");

    await runJobs();
    await runJobs();

    expect(github.reruns()).toHaveLength(1);
    const filed = github.issuesFiled();
    expect(filed).toEqual([
      {
        number: 7,
        title: "Main fails: [chromium] › waiting.spec.ts:40:3 › a session waits for its reply",
        body: expect.stringContaining(job(3, "E2E 4/4", "failed").url),
        labels: ["bug", "ready-for-agent"],
        milestone: "4 · Code workspaces",
      },
    ]);
    expect(github.milestoneDescription(onGitHub, "4 · Code workspaces")).toBe(
      "NOW. Build order: #7 → #5 → #6. Then stage 3.",
    );
  });

  it("failing again with no test named, is filed after its job", async () => {
    github.setCommitChecks(head, [job(1, "Checks", "failed")]);
    await runJobs();
    github.setCommitChecks(head, [job(1, "Checks", "failed"), job(4, "Checks", "failed")]);

    await runJobs();

    expect(github.issuesFiled().map((issue) => issue.title)).toEqual(["Main fails: Checks"]);
  });

  it("passing on the re-run, files nothing", async () => {
    github.setCommitChecks(head, [job(2, "E2E 4/4", "failed")]);
    await runJobs();
    github.setCommitChecks(head, [job(2, "E2E 4/4", "failed"), job(3, "E2E 4/4", "running")]);
    await runJobs();
    github.setCommitChecks(head, [job(2, "E2E 4/4", "failed"), job(3, "E2E 4/4", "passed")]);

    await runJobs();

    expect(github.reruns()).toHaveLength(1);
    expect(github.issuesFiled()).toEqual([]);
  });
});
