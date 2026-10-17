import {
  type BuildIssue,
  buildable,
  type NextUpIssue,
  SESSION_TITLE_MAX_LENGTH,
  type SessionSummary,
  SkillName,
  type WorkspaceId,
} from "@courtyard/contract";
import type { FoundIssue, GitHub, GitHubProblem } from "../../integrations/github/index.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { buildIssueMessage, grillIssueMessage } from "../../prompts/index.ts";
import type { Code } from "../code/index.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { getWorkspace, type WorkspaceError } from "../workspaces/index.ts";

/**
 * A code workspace's Next up (#301): its repository's `ready-for-agent` issues nobody has claimed,
 * and every issue that needs grilling first (#463), in milestone order; a milestone's Build order
 * line only orders the issues it names first, it doesn't decide which show. Read through Courtyard's GitHub sign-in (#99) only when a page asks, and
 * kept a little while. Build (#298) starts a code session on the first, with the issue as its
 * first message, and claims the issue on GitHub as AGENTS.md says a builder does. Every session
 * started on an issue has its claim posted and released here, as `sessions/` asks (#324).
 */

/** The label an issue ready for a model to build carries (Matt Pocock's triage labels). */
export const READY_LABEL = "ready-for-agent";

/**
 * The labels of an issue that needs grilling before it's built (Matt Pocock's triage labels):
 * Next up offers Grill for every one (#363, #463).
 */
const GRILL_LABELS = ["needs-triage", "needs-info"] as const;

/** The skill a Grill starts: Matt Pocock's grilling in a code workspace, else the house one. */
const GRILLING = SkillName.parse("grilling");

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
  /** The issue is blocked by an open one (#377): it's built once that closes. */
  | { readonly kind: "blocked"; readonly after: string }
  /** The issue isn't one Next up offers Grill on: ready, closed, or not to grill. */
  | { readonly kind: "nothing-to-grill" }
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
 * The claim posted on an issue for a session (AGENTS.md, claim rule): who, the session's branch,
 * and why: "next in order" for Build, which is on Next up's first issue, else "the owner asked".
 */
const claimComment = (branch: string, why: string) =>
  `Building this: Courtyard session (${branch}), ${why}`;

/**
 * The code files an issue names in its description or comments (#423), by path or name, each
 * once: a word ending in one of the usual kinds of code (`apps/web/src/components/kept.tsx`,
 * `kept.tsx`). Documents aren't counted: nearly every change touches the glossary and the
 * architecture, and two changes to them merge without a fight.
 */
const filesNamedIn = (texts: readonly string[]) => [
  ...new Set(
    texts.flatMap((text) =>
      [
        ...text.matchAll(
          /(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:tsx?|jsx?|mjs|cjs|css|json|ya?ml|html|sh))(?=$|[\s`'"),.:;!?])/gim,
        ),
      ].flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
    ),
  ),
];

/** The issues a message names, as `#<number>`, each once. */
const issuesNamedIn = (text: string) => [
  ...new Set([...text.matchAll(/#(\d+)\b/g)].map((match) => Number(match[1]))),
];

/** Whether a pull request's title or description closes issue `number` when it merges. */
const closes = (number: number, text: string) =>
  new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+#${number}\\b`, "i").test(text);

/**
 * Where a milestone comes in the order of work (docs/agents/roadmap.md): by the number its title
 * leads with, then those with none (Later), then issues in no milestone.
 */
export const milestoneRank = (milestone: string | null): readonly [number, number] => {
  if (milestone === null) return [2, 0];
  const leading = /^\s*(\d+)/.exec(milestone)?.[1];
  return leading === undefined ? [1, 0] : [0, Number(leading)];
};

/**
 * The issue numbers a milestone's description lists on its `Build order: #A → #B → #C` line
 * (docs/agents/roadmap.md), in that order: the line ends at a full stop or the line's end.
 */
export const buildOrderOf = (description: string | null): readonly number[] => {
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

/** A session's title from what it does (Build, Grill) and its issue, kept to a title's length. */
const titleFor = (does: "Build" | "Grill", issue: NextUpIssue) => {
  const title = `${does} #${issue.number}: ${issue.title}`;
  return title.length <= SESSION_TITLE_MAX_LENGTH
    ? title
    : `${title.slice(0, SESSION_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
};

export const createNextUp = (options: {
  contextDir: string;
  code: Pick<Code, "onGitHub">;
  github: Pick<GitHub, "openIssues" | "openPullRequestTexts" | "commentOnIssue">;
  sessions: Pick<Sessions, "create">;
  now: () => number;
}) => {
  const { code, github, sessions, now } = options;
  /** Each repository's Next up as last read, and when. */
  const kept = new Map<string, { readonly at: number; readonly issues: NextUpIssue[] }>();
  /** The files each ready issue names (#423), by repository then number, as last read. */
  const named = new Map<string, ReadonlyMap<number, readonly string[]>>();

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

  /**
   * The repository's ready issues nobody has claimed, and every one that needs grilling first
   * (#363, #463), in order, asked of GitHub now. Only a ready one's comments are asked for: a
   * grill claims nothing.
   */
  const read = async (repo: string): Promise<Result<NextUpIssue[], NextUpProblem>> => {
    const [issues, pulls, ...unready] = await Promise.all([
      github.openIssues({ repo, label: READY_LABEL, forBuild: true }),
      github.openPullRequestTexts({ repo }),
      ...GRILL_LABELS.map((label) => github.openIssues({ repo, label, forBuild: false })),
    ]);
    if (!issues.ok) return err({ kind: "github", problem: issues.error });
    if (!pulls.ok) return err({ kind: "github", problem: pulls.error });
    const texts = pulls.value.map((pull) => `${pull.title}\n${pull.body}`);
    const ready = issues.value.filter(
      (issue) => !claimedIn(issue.comments) && !texts.some((text) => closes(issue.number, text)),
    );
    const toGrill: FoundIssue[] = [];
    for (const found of unready) {
      if (!found.ok) return err({ kind: "github", problem: found.error });
      toGrill.push(
        ...found.value.filter(
          (issue) => ![...issues.value, ...toGrill].some((each) => each.number === issue.number),
        ),
      );
    }
    const offered = [
      ...ready.map((issue) => ({ issue, ready: true })),
      ...toGrill.map((issue) => ({ issue, ready: false })),
    ]
      .sort((a, b) => inOrder(a.issue, b.issue))
      .map(({ issue: { number, title, url, milestone, blockedBy }, ready }) => ({
        number,
        title,
        url,
        milestone,
        ready,
        after: ready ? (blockedBy[0] ?? null) : null,
      }));
    kept.set(repo, { at: now(), issues: offered });
    named.set(
      repo,
      new Map(ready.map((issue) => [issue.number, filesNamedIn([issue.body, ...issue.comments])])),
    );
    return ok(offered);
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
     * The files each of a code workspace's ready issues names (#423), as Next up last read them,
     * so the Lead can hold back one a running builder would clash with.
     */
    filesNamed: async (rawId: string): Promise<ReadonlyMap<number, readonly string[]>> => {
      const found = await repoOf(rawId);
      return (found.ok ? named.get(found.value.repo) : undefined) ?? new Map();
    },

    /** A code workspace's Next up asked of GitHub now, as the Lead reads it each time round (#347). */
    fresh: async (rawId: string): Promise<Result<NextUpIssue[], NextUpProblem>> => {
      const found = await repoOf(rawId);
      return found.ok ? read(found.value.repo) : found;
    },

    /**
     * Build (#298): a new code session on `build.model` whose first message is the issue, once
     * GitHub says nobody has claimed it meanwhile, started on the issue, so it's claimed for it.
     */
    build: async (
      rawId: string,
      number: number,
      /**
       * The model, whether the workspace's Lead starts it as one of its builders (#347), and until
       * when it allows all from the start, with the Lead's Allow all for builders (#428).
       */
      build: BuildIssue & { readonly byLead?: boolean; readonly allowAllUntil?: string },
    ): Promise<Result<SessionSummary, NextUpProblem>> => {
      const found = await repoOf(rawId);
      if (!found.ok) return found;
      const { workspaceId, repo } = found.value;
      const fresh = await read(repo);
      if (!fresh.ok) return fresh;
      const issue = fresh.value.find((each) => each.number === number && each.ready);
      if (issue !== undefined && issue.after !== null) {
        return err({ kind: "blocked", after: issue.after });
      }
      if (issue === undefined) {
        const any = await github.openIssues({ repo, label: READY_LABEL, forBuild: false });
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
        title: titleFor("Build", issue),
        issue: number,
        ...(build.byLead === true ? { lead: "builder" as const } : {}),
        ...(build.allowAllUntil === undefined ? {} : { allowAllUntil: build.allowAllUntil }),
      });
      return created.ok ? created : err({ kind: "session", error: created.error });
    },

    /**
     * The issue a session's first message names (#324), when it names just one and Next up
     * offers it to build now: ready, and nobody has claimed it.
     */
    named: async (rawId: string, text: string): Promise<number | undefined> => {
      const [number, ...more] = issuesNamedIn(text);
      if (number === undefined || more.length > 0) return undefined;
      const found = await repoOf(rawId);
      if (!found.ok) return undefined;
      const fresh = await read(found.value.repo);
      return fresh.ok && fresh.value.some((each) => each.number === number && buildable(each))
        ? number
        : undefined;
    },

    /**
     * Claims an issue for a session (AGENTS.md, claim rule; #324), naming its branch. One GitHub
     * refuses is only logged: the session is building it already.
     */
    claim: async (rawId: string, number: number, claim: { branch: string; why: string }) => {
      const found = await repoOf(rawId);
      if (!found.ok) return;
      const { repo } = found.value;
      const body = claimComment(claim.branch, claim.why);
      const claimed = await github.commentOnIssue({ repo, number, body });
      if (!claimed.ok) console.error(`#${number} couldn't be claimed on GitHub`, claimed.error);
      kept.delete(repo);
    },

    /**
     * Releases a session's claim on an issue (AGENTS.md, claim rule; #324): a comment starting
     * "Stopped", saying why, so Next up offers it again. One GitHub refuses is only logged.
     */
    release: async (rawId: string, number: number, why: string) => {
      const found = await repoOf(rawId);
      if (!found.ok) return;
      const { repo } = found.value;
      const released = await github.commentOnIssue({ repo, number, body: `Stopped: ${why}` });
      if (!released.ok) console.error(`#${number}'s claim couldn't be released`, released.error);
      kept.delete(repo);
    },

    /**
     * Grill (#363): a new code session on `grill.model` with the grilling skill, whose first
     * message is an issue that needs grilling first. It claims nothing, and takes
     * no place among the code sessions running.
     */
    grill: async (
      rawId: string,
      number: number,
      grill: BuildIssue,
    ): Promise<Result<SessionSummary, NextUpProblem>> => {
      const found = await repoOf(rawId);
      if (!found.ok) return found;
      const fresh = await read(found.value.repo);
      if (!fresh.ok) return fresh;
      const issue = fresh.value.find((each) => each.number === number && !each.ready);
      if (issue === undefined) return err({ kind: "nothing-to-grill" });
      const created = await sessions.create({
        workspaceId: found.value.workspaceId,
        message: {
          text: grillIssueMessage(issue),
          model: grill.model,
          skill: GRILLING,
          ...(grill.effort === undefined ? {} : { effort: grill.effort }),
        },
        title: titleFor("Grill", issue),
        placeless: true,
      });
      return created.ok ? created : err({ kind: "session", error: created.error });
    },
  };
};

export type NextUp = ReturnType<typeof createNextUp>;
