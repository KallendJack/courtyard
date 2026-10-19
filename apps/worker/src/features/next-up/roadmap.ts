import type { RoadmapIssue, RoadmapMilestone, RoadmapState } from "@courtyard/contract";
import type {
  FoundMilestoneIssue,
  FoundRoadmapMilestone,
} from "../../integrations/github/index.ts";
import { buildOrderOf, claimedIn, closes, GRILL_LABELS, milestoneRank } from "./index.ts";

/**
 * A code workspace's Roadmap (#532): every open milestone in the roadmap's order, each issue in
 * its Build order with one plain state, worked out here the way Next up works out what it offers.
 */

/** The labels of an issue a model or the owner can build as it is (Matt Pocock's triage labels). */
const BUILDABLE_LABELS = ["ready-for-agent", "ready-for-human"];

/** Where an issue stands, from its labels, its claims and the open pull requests' texts. */
const stateOf = (issue: FoundMilestoneIssue, pulls: readonly string[]): RoadmapState => {
  if (issue.closed) return { kind: "done" };
  if (claimedIn(issue.comments) || pulls.some((text) => closes(issue.number, text))) {
    return { kind: "building" };
  }
  const grill = issue.labels.some((label) => GRILL_LABELS.some((each) => each === label));
  if (grill || !issue.labels.some((label) => BUILDABLE_LABELS.includes(label))) {
    return { kind: "to-grill" };
  }
  const [after] = issue.blockedBy;
  return after === undefined ? { kind: "ready" } : { kind: "blocked", after };
};

/** A heading line in Markdown. */
const HEADING = /^\s{0,3}#{1,6}\s/;

/** An issue's summary: its description's first paragraph that isn't a heading, on one line. */
const summaryOf = (body: string) =>
  (
    body
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.trim())
      .find((paragraph) => paragraph !== "" && !HEADING.test(paragraph)) ?? ""
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join(" ");

/** The Paper boards an issue's description names, quoted, in its Boards section (AGENTS.md). */
const boardsOf = (body: string) => {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s{0,3}#{1,6}\s+boards\b/i.test(line));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING.test(line));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  return [
    ...new Set(
      [...section.matchAll(/["“]([^"”\n]+)["”]/g)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1].trim()],
      ),
    ),
  ];
};

/** A milestone's issues in its Build order line's order, the rest by number, done ones last. */
const issuesOf = (milestone: FoundRoadmapMilestone, pulls: readonly string[]): RoadmapIssue[] => {
  const order = buildOrderOf(milestone.description);
  const place = (number: number) => {
    const at = order.indexOf(number);
    return at === -1 ? order.length : at;
  };
  return [...milestone.issues]
    .sort(
      (a, b) =>
        Number(a.closed) - Number(b.closed) ||
        place(a.number) - place(b.number) ||
        a.number - b.number,
    )
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      state: stateOf(issue, pulls),
      summary: summaryOf(issue.body),
      boards: boardsOf(issue.body),
    }));
};

/**
 * The Roadmap from a repository's open milestones and its open pull requests' titles and
 * descriptions: the milestones in the roadmap's order (docs/agents/roadmap.md), Later last.
 */
export const roadmapOf = (
  milestones: readonly FoundRoadmapMilestone[],
  pulls: readonly string[],
): RoadmapMilestone[] =>
  [...milestones]
    .sort((a, b) => {
      const [rankA, numberA] = milestoneRank(a.title);
      const [rankB, numberB] = milestoneRank(b.title);
      return rankA - rankB || numberA - numberB || a.title.localeCompare(b.title);
    })
    .map((milestone) => ({ title: milestone.title, issues: issuesOf(milestone, pulls) }));
