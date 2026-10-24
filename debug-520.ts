// [DEBUG-520] Throwaway: counts the GitHub requests one Next up read makes. Deleted before commit.
import { execFileSync } from "node:child_process";
import { createGitHubApi } from "./apps/worker/src/integrations/github/api.ts";

const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const real = globalThis.fetch;
const asked: string[] = [];
globalThis.fetch = (input, init) => {
  asked.push(`${init?.method ?? "GET"} ${String(input).replace("https://api.github.com", "")}`);
  return real(input, init);
};
const github = createGitHubApi({ clientId: "unused" });
const repo = "KallendJack/courtyard";
const label = "ready-for-agent";
const read = await github.openIssues(token, { repo, label, forBuild: true });
if (!read.ok) throw new Error(read.error);
const claimed = read.value.filter((issue) => issue.comments.some((c) => /^\s*building this\b/im.test(c)));
const blocked = read.value.filter((issue) => issue.blockedBy.length > 0);
console.log(
  JSON.stringify({
    requests: asked.length,
    rest: asked.filter((each) => !each.includes("/graphql")).length,
    issues: read.value.length,
    claimed: claimed.map((issue) => issue.number),
    blocked: blocked.map((issue) => [issue.number, issue.blockedBy]),
    withBody: read.value.filter((issue) => issue.body !== "").length,
    milestones: [...new Set(read.value.map((issue) => issue.milestone))],
  }),
);
