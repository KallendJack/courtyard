import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGitHubApi } from "../src/integrations/github/api.ts";
import { ok } from "../src/lib/result.ts";

// GitHub's hourly allowance (#520): the worker asks the same things again and again (Next up,
// each session's pull request), so an answer unchanged since it last asked must cost nothing.
// GitHub doesn't count a conditional request it answers 304, Not Modified.

const REPO = "octo-owner/side-project";
const TOKEN = "ghu_test";

/**
 * A stand-in for GitHub's REST API: a repository's ready issues, their comments, and its pull
 * requests, each answer with an ETag, as GitHub gives them. `charged` counts what GitHub would
 * take from the hourly allowance: every answer but a 304.
 */
const standInGitHub = (issues: { number: number; comments: string[] }[]) => {
  let charged = 0;
  const answerFor = (url: URL): unknown => {
    const path = url.pathname;
    if (path === `/repos/${REPO}/issues`) {
      if (url.searchParams.get("labels") !== "ready-for-agent") return [];
      return issues.map(({ number, comments }) => ({
        number,
        title: `Issue ${number}`,
        html_url: `https://github.com/${REPO}/issues/${number}`,
        milestone: null,
        body: "",
        comments: comments.length,
      }));
    }
    const commented = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(path);
    if (commented !== null) {
      const issue = issues.find((each) => each.number === Number(commented[1]));
      return (issue?.comments ?? []).map((body) => ({ body }));
    }
    if (path === `/repos/${REPO}/pulls`) {
      return url.searchParams.get("head") === "octo-owner:courtyard/1" ? [{ number: 7 }] : [];
    }
    if (path === `/repos/${REPO}/pulls/7`) {
      return {
        number: 7,
        title: "A change",
        body: null,
        html_url: `https://github.com/${REPO}/pull/7`,
        state: "open",
        merged_at: null,
        head: { sha: "abc123", ref: "courtyard/1", repo: { full_name: REPO } },
        user: { login: "octo-owner" },
        base: { ref: "main" },
        additions: 1,
        deletions: 0,
        changed_files: 1,
        mergeable: true,
        draft: false,
      };
    }
    if (path === `/repos/${REPO}/commits/abc123/check-runs`) {
      return { check_runs: [{ name: "verify", status: "completed", conclusion: "success" }] };
    }
    throw new Error(`The stand-in GitHub has no ${path}`);
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = JSON.stringify(answerFor(url));
    const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
    const asked = new Headers(init?.headers).get("if-none-match");
    if (asked === etag) return new Response(null, { status: 304, headers: { etag } });
    charged += 1;
    return new Response(body, { status: 200, headers: { etag } });
  };
  return { fetch, charged: () => charged };
};

const READY = { repo: REPO, label: "ready-for-agent", forBuild: true } as const;

describe("GitHub's allowance (#520)", () => {
  it("costs nothing to read Next up again when nothing on GitHub changed", async () => {
    const issues = Array.from({ length: 20 }, (_, at) => ({
      number: at + 1,
      comments: ["Building this: Courtyard session (courtyard/1), next in order", "Stopped: no"],
    }));
    const github = standInGitHub(issues);
    const api = createGitHubApi({ clientId: "Iv1.test", fetch: github.fetch });

    const first = await api.openIssues(TOKEN, READY);
    expect(first.ok).toBe(true);
    // The list, then each issue's comments.
    expect(github.charged()).toBe(21);

    const again = await api.openIssues(TOKEN, READY);
    expect(again).toEqual(first);
    expect(github.charged()).toBe(21);
  });

  it("asks only for what changed: a new comment costs the list and that issue's comments", async () => {
    const issues = [1, 2, 3].map((number) => ({ number, comments: ["A thought."] }));
    const github = standInGitHub(issues);
    const api = createGitHubApi({ clientId: "Iv1.test", fetch: github.fetch });
    await api.openIssues(TOKEN, READY);
    const before = github.charged();

    issues[1]?.comments.push("Building this: Courtyard session (courtyard/2), next in order");
    const read = await api.openIssues(TOKEN, READY);

    expect(github.charged() - before).toBe(2);
    expect(read.ok && read.value.find((issue) => issue.number === 2)?.comments).toEqual([
      "A thought.",
      "Building this: Courtyard session (courtyard/2), next in order",
    ]);
  });

  it("costs nothing to follow a session's pull request again when it hasn't changed", async () => {
    const github = standInGitHub([]);
    const api = createGitHubApi({ clientId: "Iv1.test", fetch: github.fetch });
    const find = { repo: REPO, branch: "courtyard/1" };

    const first = await api.pullRequest(TOKEN, find);
    expect(first.ok && first.value?.checks).toEqual([{ name: "verify", outcome: "passed" }]);
    // The branch's pull requests, the one found, and its checks.
    expect(github.charged()).toBe(3);

    expect(await api.pullRequest(TOKEN, find)).toEqual(first);
    expect(await api.pullRequest(TOKEN, { ...find, branch: "courtyard/2" })).toEqual(ok(null));
    // Only the branch never asked about before.
    expect(github.charged()).toBe(4);
  });
});
