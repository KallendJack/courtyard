import {
  type BuildIssue,
  type NextUpIssue,
  SESSION_TITLE_MAX_LENGTH,
  type SessionSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import type { Code } from "../code/index.ts";
import type { FoundIssue, GitHub, GitHubProblem } from "../github/index.ts";
import { buildIssueMessage } from "../prompts/index.ts";
import { err, ok, type Result } from "../result.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { getWorkspace, type WorkspaceError } from "../workspaces/index.ts";

/**
 * A code workspace's Next up (#301): its repository's `ready-for-agent` issues nobody has claimed,
 * in milestone order, read through Courtyard's GitHub sign-in (#99) only when a page asks, and
 * kept a little while. Build (#298) starts a code session on the first, with the issue as its
 * first message, and claims the issue on GitHub as AGENTS.md says a builder does.
 */

/** The label an issue ready for a model to build carries (Matt Pocock's triage labels). */
export const READY_LABEL = "ready-for-agent";

/** How long a repository's Next up is kept before GitHub is asked again. */
const KEEP_MS = 2 * 60 * 1000;

/** Why a workspace's Next up couldn't be read, or an issue built. */
export type NextUpProblem =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  | { readonly kind: "not-code" }
  /** Its repository's remote isn't on GitHub. */
  | { readonly kind: "not-on-github" }
  | { readonly kind: "github"; readonly problem: GitHubProblem }
  /** The issue isn't one Next up offers: not ready, closed, or not there at all. */
  | { readonly kind: "no-such-issue" }
  /** Someone claimed the issue since the page showed it. */
  | { readonly kind: "claimed" }
  | { readonly kind: "session"; readonly error: SessionError };

/** A claim on an issue, as AGENTS.md's claim rule words it: a comment starting "Building this". */
const CLAIM = /^\s*building this\b/im;
/** A claim released: a comment starting "Stopped" (AGENTS.md, claim rule). */
const RELEASED = /^\s*stopped\b/im;

/** Whether an issue's comments, oldest first, leave it claimed: a claim not released since. */
const claimedIn = (comments: readonly string[]) => {
  const claim = comments.findLastIndex((comment) => CLAIM.test(comment));
  return claim !== -1 && !comments.slice(claim + 1).some((comment) => RELEASED.test(comment));
};

/**
 * The claim Build posts on the issue (AGENTS.md, claim rule): who, the session's branch, and why,
 * which is always that it's next in order, as Build is on Next up's first issue.
 */
const claimComment = (branch: string) =>
  `Building this: Courtyard session (${branch}), next in order`;

/** Whether a pull request's title or description closes issue `number` when it merges. */
const closes = (number: number, text: string) =>
  new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+#${number}\\b`, "i").test(text);

/**
 * Where a milestone comes in the order of work (docs/agents/roadmap.md): by the number its title
 * leads with, then those with none (Later), then issues in no milestone.
 */
const milestoneRank = (milestone: string | null): readonly [number, number] => {
  if (milestone === null) return [2, 0];
  const leading = /^\s*(\d+)/.exec(milestone)?.[1];
  return leading === undefined ? [1, 0] : [0, Number(leading)];
};

/**
 * The issue numbers a milestone's description lists on its `Build order: #A → #B → #C` line
 * (docs/agents/roadmap.md), in that order: the line ends at a full stop or the line's end.
 */
const buildOrderOf = (description: string | null): readonly number[] => {
  const line = /build order:(.*?)(?:\.(?=\s|$)|$)/im.exec(description ?? "")?.[1] ?? "";
  return [...line.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
};

/** Where an issue comes in its milestone: its place on the Build order line, else after them all. */
const placeInMilestone = (issue: FoundIssue) => {
  const place = buildOrderOf(issue.milestoneDescription).indexOf(issue.number);
  return place === -1 ? Number.POSITIVE_INFINITY : place;
};

/**
 * Issues in the order Next up offers them: by milestone, then as its Build order line lists them
 * (#336), then by number.
 */
const inOrder = (a: FoundIssue, b: FoundIssue) => {
  const [rankA, numberA] = milestoneRank(a.milestone);
  const [rankB, numberB] = milestoneRank(b.milestone);
  const placeA = placeInMilestone(a);
  const placeB = placeInMilestone(b);
  return (
    rankA - rankB ||
    numberA - numberB ||
    (a.milestone ?? "").localeCompare(b.milestone ?? "") ||
    (placeA === placeB ? 0 : placeA < placeB ? -1 : 1) ||
    a.number - b.number
  );
};

/** A session's title from its issue, kept to a title's length. */
const titleFor = (issue: NextUpIssue) => {
  const title = `Build #${issue.number}: ${issue.title}`;
  return title.length <= SESSION_TITLE_MAX_LENGTH
    ? title
    : `${title.slice(0, SESSION_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
};

export const createNextUp = (options: {
  contextDir: string;
  code: Pick<Code, "onGitHub">;
  github: Pick<GitHub, "openIssues" | "openPullRequestTexts" | "commentOnIssue">;
  sessions: Pick<Sessions, "create" | "list">;
  now: () => number;
}) => {
  const { code, github, sessions, now } = options;
  /** Each repository's Next up as last read, and when. */
  const kept = new Map<string, { readonly at: number; readonly issues: NextUpIssue[] }>();

  /** A code workspace's id and its repository on GitHub, or why it has no Next up. */
  const repoOf = async (
    rawId: string,
  ): Promise<Result<{ workspaceId: WorkspaceId; repo: string }, NextUpProblem>> => {
    const workspace = await getWorkspace(options.contextDir, rawId);
    if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
    const { summary, repoPath } = workspace.value;
    if (summary.mode !== "code" || repoPath === null) return err({ kind: "not-code" });
    const repo = await code.onGitHub(repoPath);
    return repo.ok
      ? ok({ workspaceId: summary.id, repo: repo.value })
      : err({ kind: "not-on-github" });
  };

  /** The repository's ready issues nobody has claimed, in order, asked of GitHub now. */
  const read = async (repo: string): Promise<Result<NextUpIssue[], NextUpProblem>> => {
    const [issues, pulls] = await Promise.all([
      github.openIssues({ repo, label: READY_LABEL }),
      github.openPullRequestTexts({ repo }),
    ]);
    if (!issues.ok) return err({ kind: "github", problem: issues.error });
    if (!pulls.ok) return err({ kind: "github", problem: pulls.error });
    const texts = pulls.value.map((pull) => `${pull.title}\n${pull.body}`);
    const unclaimed = issues.value
      .filter(
        (issue) => !claimedIn(issue.comments) && !texts.some((text) => closes(issue.number, text)),
      )
      .sort(inOrder)
      .map(({ number, title, url, milestone }) => ({ number, title, url, milestone }));
    kept.set(repo, { at: now(), issues: unclaimed });
    return ok(unclaimed);
  };

  return {
    /** A code workspace's Next up, kept a couple of minutes between asks of GitHub. */
    list: async (rawId: string): Promise<Result<NextUpIssue[], NextUpProblem>> => {
      const found = await repoOf(rawId);
      if (!found.ok) return found;
      const last = kept.get(found.value.repo);
      if (last !== undefined && now() - last.at < KEEP_MS) return ok(last.issues);
      return read(found.value.repo);
    },

    /**
     * Build (#298): a new code session on `build.model` whose first message is the issue, once
     * GitHub says nobody has claimed it meanwhile; then the claim on the issue, naming the
     * session's branch. A claim GitHub refuses is only logged: the session is building it already.
     */
    build: async (
      rawId: string,
      number: number,
      build: BuildIssue,
    ): Promise<Result<SessionSummary, NextUpProblem>> => {
      const found = await repoOf(rawId);
      if (!found.ok) return found;
      const { workspaceId, repo } = found.value;
      const fresh = await read(repo);
      if (!fresh.ok) return fresh;
      const issue = fresh.value.find((each) => each.number === number);
      if (issue === undefined) {
        const any = await github.openIssues({ repo, label: READY_LABEL });
        const there = any.ok && any.value.some((each) => each.number === number);
        return err({ kind: there ? "claimed" : "no-such-issue" });
      }
      const created = await sessions.create({
        workspaceId,
        message: {
          text: buildIssueMessage(issue),
          model: build.model,
          ...(build.effort === undefined ? {} : { effort: build.effort }),
        },
        title: titleFor(issue),
      });
      if (!created.ok) return err({ kind: "session", error: created.error });
      const listed = await sessions.list(workspaceId);
      const branch = listed.ok
        ? listed.value.find((session) => session.id === created.value.id)?.branch
        : undefined;
      if (branch !== undefined) {
        const claimed = await github.commentOnIssue({
          repo,
          number,
          body: claimComment(branch),
        });
        if (!claimed.ok) console.error(`#${number} couldn't be claimed on GitHub`, claimed.error);
      }
      kept.delete(repo);
      return created;
    },
  };
};

export type NextUp = ReturnType<typeof createNextUp>;
