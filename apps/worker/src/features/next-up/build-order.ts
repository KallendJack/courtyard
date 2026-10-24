import type { FoundMilestone, GitHub, GitHubProblem } from "../../integrations/github/index.ts";
import { ok, type Result } from "../../lib/result.ts";
import { buildOrderLineOf, buildOrderOf } from "./build-order-line.ts";
import { milestoneRank } from "./index.ts";

/**
 * Filing an issue the worker found for the Lead, in its place in the build order: a red main
 * (#355) and a bump that fails (#496) go first, a flaky test (#496) last.
 */

/** The longest title GitHub shows whole in a list. */
const TITLE_MAX_LENGTH = 200;

/** A title kept to the length GitHub shows whole. */
export const issueTitle = (title: string) =>
  title.length <= TITLE_MAX_LENGTH ? title : `${title.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;

/** The milestone work goes in first: the lowest-numbered open one (docs/agents/roadmap.md). */
const currentOf = (milestones: readonly FoundMilestone[]) =>
  [...milestones].sort((a, b) => {
    const [rankA, numberA] = milestoneRank(a.title);
    const [rankB, numberB] = milestoneRank(b.title);
    return rankA - rankB || numberA - numberB;
  })[0];

/** A milestone's description with issue `number` first in its `Build order:` line, or a new one. */
const putFirst = (description: string, number: number) => {
  const line = buildOrderLineOf(description);
  if (line === null) {
    return description.trim() === ""
      ? `Build order: #${number}.`
      : `Build order: #${number}. ${description}`;
  }
  const at = line.at + (/^[ \t]*/.exec(line.list)?.[0].length ?? 0);
  const then = buildOrderOf(description).length > 0 ? " → " : "";
  return `${description.slice(0, at)}#${number}${then}${description.slice(at)}`;
};

/** A milestone's description with issue `number` last in its `Build order:` line, or a new one. */
const putLast = (description: string, number: number) => {
  const line = buildOrderLineOf(description);
  const last = [...(line?.list ?? "").matchAll(/#\d+/g)].at(-1);
  if (line === null || last === undefined) return putFirst(description, number);
  const at = line.at + last.index + last[0].length;
  return `${description.slice(0, at)} → #${number}${description.slice(at)}`;
};

/**
 * Files an issue in `repo`'s current milestone, and puts it `first` or `last` in that milestone's
 * `Build order:` line: its number.
 */
export const fileInBuildOrder = async (
  github: Pick<GitHub, "openMilestones" | "describeMilestone" | "createIssue">,
  issue: {
    repo: string;
    title: string;
    body: string;
    labels: readonly string[];
    place: "first" | "last";
  },
): Promise<Result<number, GitHubProblem>> => {
  const { repo } = issue;
  const milestones = await github.openMilestones({ repo });
  const current = milestones.ok ? currentOf(milestones.value) : undefined;
  const created = await github.createIssue({
    repo,
    title: issueTitle(issue.title),
    body: issue.body,
    labels: issue.labels,
    milestone: current?.number ?? null,
  });
  if (!created.ok) return created;
  const { number } = created.value;
  if (current === undefined || buildOrderOf(current.description).includes(number)) {
    return ok(number);
  }
  const put = issue.place === "first" ? putFirst : putLast;
  const described = await github.describeMilestone({
    repo,
    number: current.number,
    description: put(current.description, number),
  });
  if (!described.ok) console.error(`#${number} couldn't be put in ${current.title}'s build order`);
  return ok(number);
};
