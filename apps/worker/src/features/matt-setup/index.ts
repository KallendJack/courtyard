import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type MattSetup,
  type MattSetupAnswer,
  makesLabels,
  opensPullRequest,
  recommendedChoices,
  type SetupCard,
  type SetupPaper,
  type SetupTracker,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import type { GitHub } from "../../integrations/github/index.ts";
import { readJsonFile, removeFolder, writeJsonFile, writeTextFileIn } from "../../lib/files.ts";
import { git, gitFailureReason, gitOrNothing } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import type { Code } from "../code/index.ts";
import { type Connections, makePaperFile } from "../connections/index.ts";
import type { MattSkills } from "../matt-skills/index.ts";
import { getWorkspace } from "../workspaces/index.ts";

/**
 * The setup card (#181, #323): what a code workspace's repository has of the house standard (Matt
 * Pocock's setup with the house answers: GitHub issues, the default triage labels, `GLOSSARY.md`
 * and `docs/adr/`), offered once as one card. Courtyard works the repository's own answers out
 * itself, as his setup's "explore" step does, for any repository: where its work lives (a backlog
 * or TODO file, or `.scratch/`), its glossary's name, and which instructions file it has. Each
 * line recommends the house standard, unless the repository says another tool or agent writes its
 * tracker. Set up, the labels are made through Courtyard's GitHub sign-in (only when its work lives
 * on GitHub), the open items of a tracker moved are filed as issues, and the files go on a branch
 * of their own, with a pull request; never on the owner's checkout. His setup skill isn't run as a
 * conversation.
 */

/** His setup skill, in Courtyard's pinned copy, whose templates the files are written from. */
const SETUP_SKILL = "setup-matt-pocock-skills";

/** The files his setup writes, by path. */
const ISSUE_TRACKER = "docs/agents/issue-tracker.md";
const TRIAGE_LABELS = "docs/agents/triage-labels.md";
const DOMAIN = "docs/agents/domain.md";
const FILES = [ISSUE_TRACKER, TRIAGE_LABELS, DOMAIN] as const;

/** The house glossary, and the name his templates give it. */
const GLOSSARY = "GLOSSARY.md";
const CONTEXT = "CONTEXT.md";
/** The glossary's old name where it's named as that file: not in a longer name, or another folder's. */
const NAMED_CONTEXT = /(?<![\w./-])CONTEXT\.md/g;

/** Where a repository may keep its own list of work, in the order they're looked for. */
const TRACKER_FILES = [
  "docs/backlog.md",
  "BACKLOG.md",
  "backlog.md",
  "docs/BACKLOG.md",
  "TODO.md",
  "docs/TODO.md",
  "todo.md",
] as const;
/** Local-markdown issues, as his setup's local tracker keeps them: one file per ticket. */
const SCRATCH = ".scratch/";

/** How a file is known to have the section already. */
const HAS_SECTION = /^## Agent skills\s*$/m;

/**
 * Claude's import of AGENTS.md (#642): Claude Code reads only a project's CLAUDE.md (ADR 0022), so
 * a CLAUDE.md of this line, or one with it, gives Claude the same rules Codex reads.
 */
const CLAUDE = "CLAUDE.md";
const POINTER = "@AGENTS.md";
/** How a CLAUDE.md is known to point at AGENTS.md already. */
const POINTS = /(?<![\w@])@(\.\/)?AGENTS\.md(?![\w.-])/;

/**
 * The house standard's labels: GitHub's two categories, and the five default triage labels, with
 * Courtyard's own colours and his meanings.
 */
const LABELS = [
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  { name: "enhancement", color: "a2eeef", description: "New feature or request" },
  { name: "needs-triage", color: "fbca04", description: "Maintainer needs to evaluate this issue" },
  { name: "needs-info", color: "d4c5f9", description: "Waiting on reporter for more information" },
  {
    name: "ready-for-agent",
    color: "0e8a16",
    description: "Fully specified, ready for an AFK agent",
  },
  { name: "ready-for-human", color: "c5def5", description: "Requires human implementation" },
  { name: "wontfix", color: "ffffff", description: "Will not be actioned" },
] as const;
/** A new repo's first milestone (#391). */
const FIRST_MILESTONE = "1 · Start";
/** A new repo's first idea's labels: something to build, that needs grilling first (#391). */
const FIRST_IDEA_LABELS = ["enhancement", "needs-triage"];

/** The label an item moved to GitHub issues carries: it was never triaged there. */
const MOVED_LABEL = "needs-triage";

/** Why the recommendation on a tracker another agent writes is Keep. */
const WRITTEN_BY_ANOTHER = "the repo says another agent writes this file";

/** Where the owner's answers are kept, in the data folder: each workspace's, by its id. */
const ANSWERS_FILE = "matt-setup.json";
const Answers = z.record(z.string(), z.enum(["allowed", "not-now"]));

/** Why the setup couldn't be done, in the owner's words. */
export type MattSetupProblem =
  | { readonly kind: "not-found" }
  | { readonly kind: "failed"; readonly reason: string };

/** What the check found: the card, and what setting it up needs. */
type Checked = {
  readonly card: SetupCard;
  readonly repoPath: string;
  readonly repo: string;
  readonly base: string;
  readonly tracking: string;
  readonly templates: string;
  /** Its rules are (or will be) in AGENTS.md, and its CLAUDE.md, if any, doesn't point there. */
  readonly pointClaude: boolean;
};

/** The owner's choices on a card, each line's answer or what it recommends. */
type Choices = {
  readonly moveTracker: boolean;
  readonly glossary: string;
  readonly makePaper: boolean;
};

export const createMattSetup = (options: {
  readonly dataDir: string;
  readonly contextDir: string;
  readonly matt: MattSkills | undefined;
  readonly code: Pick<Code, "freshDefault" | "onGitHub" | "commandEnv">;
  readonly github: Pick<
    GitHub,
    | "labels"
    | "createLabel"
    | "openPullRequest"
    | "createIssue"
    | "openIssues"
    | "createMilestone"
    | "describeMilestone"
  >;
  readonly connections: Pick<Connections, "canMakePaper" | "connectPaper">;
}) => {
  const answersFile = join(options.dataDir, ANSWERS_FILE);
  const answers = async () => {
    const read = await readJsonFile(answersFile, Answers);
    return read.ok ? (read.value ?? {}) : {};
  };
  const remember = async (workspaceId: WorkspaceId, answer: "allowed" | "not-now") =>
    writeJsonFile(answersFile, { ...(await answers()), [workspaceId]: answer });

  /**
   * What the workspace's repository is missing of the house standard, read from its default
   * branch on its remote, freshly fetched, and its labels on GitHub; `undefined` when there's
   * nothing to check: not a code workspace, Matt's skills not loaded, not on GitHub, or not signed
   * in.
   */
  const check = async (id: WorkspaceId): Promise<Checked | undefined> => {
    const workspace = await getWorkspace(options.contextDir, id);
    if (!workspace.ok || workspace.value.summary.mode !== "code") return undefined;
    const { repoPath } = workspace.value;
    const copy = await options.matt?.copy();
    const setupSkill = copy?.ok ? copy.value.skills.find((s) => s.name === SETUP_SKILL) : undefined;
    if (repoPath === null || setupSkill === undefined) return undefined;
    const repo = await options.code.onGitHub(repoPath);
    const labels = repo.ok ? await options.github.labels({ repo: repo.value }) : undefined;
    if (!repo.ok || labels === undefined || !labels.ok) return undefined;
    const fresh = await options.code.freshDefault(repoPath);
    if (!fresh.ok) return undefined;
    const at = onDefault(repoPath, fresh.value.tracking);

    const files: string[] = [];
    for (const path of FILES) if ((await at(path)) === undefined) files.push(path);
    const agents = await at("AGENTS.md");
    const claude = await at(CLAUDE);
    const instructions = [agents, claude].flatMap((text) => (text === undefined ? [] : [text]));
    // AGENTS.md, which every model reads, unless there's only a CLAUDE.md; never both.
    const sectionFile = agents === undefined && claude !== undefined ? CLAUDE : "AGENTS.md";
    const hasSection = instructions.some((text) => HAS_SECTION.test(text));
    const tracked = await at(ISSUE_TRACKER);
    // Where its work lives is its answer already once docs/agents/ says; else its own tracker.
    const tracker =
      tracked === undefined ? await ownTracker(repoPath, fresh.value.tracking, instructions) : null;
    const glossary =
      files.includes(DOMAIN) &&
      (await at(GLOSSARY)) === undefined &&
      (await at(CONTEXT)) !== undefined
        ? { path: CONTEXT }
        : null;
    // Labels matter only where its work lives on GitHub (or will): his GitHub tracker says so.
    const onGitHub =
      tracked === undefined || /^#\s*Issue tracker:\s*GitHub\b|\bgh issue\b/im.test(tracked);
    const lacking = onGitHub
      ? LABELS.map((label) => label.name).filter((name) => !labels.value.includes(name))
      : [];
    const card: SetupCard = {
      tracker,
      glossary,
      files,
      section: hasSection ? null : { path: sectionFile },
      labels: lacking,
      paper: null,
    };
    // A Paper file is offered with the rest, never on its own: it's optional.
    const paper =
      offersAnything(card) && (await options.connections.canMakePaper(id))
        ? { name: workspace.value.summary.name }
        : null;
    return {
      card: { ...card, paper },
      repoPath,
      repo: repo.value,
      base: fresh.value.branch,
      tracking: fresh.value.tracking,
      templates: setupSkill.folder,
      // Only where the rules are in AGENTS.md: a CLAUDE.md that holds them stays as it is.
      pointClaude: sectionFile === "AGENTS.md" && (claude === undefined || !POINTS.test(claude)),
    };
  };

  /**
   * Each open item of a tracker moved to GitHub issues, filed as one, unless it's an open issue
   * already (a Set up that failed part way, tried again); the files that point to them.
   */
  const moveTracker = async (
    checked: Checked,
    tracker: SetupTracker,
  ): Promise<Result<{ filed: number; files: Map<string, string> }, string>> => {
    const at = onDefault(checked.repoPath, checked.tracking);
    const open = await options.github.openIssues({
      repo: checked.repo,
      label: MOVED_LABEL,
      forBuild: false,
    });
    if (!open.ok) return err(problemWords(open.error));
    const already = new Map(open.value.map((issue) => [issue.title, issue.number]));
    const sources =
      tracker.path === SCRATCH
        ? await scratchTickets(checked.repoPath, checked.tracking)
        : [tracker.path];
    const files = new Map<string, string>();
    let filed = 0;
    for (const path of sources) {
      const text = await at(path);
      if (text === undefined) continue;
      const items = tracker.path === SCRATCH ? scratchItem(path, text) : openItems(text);
      const moved: Moved[] = [];
      for (const item of items) {
        const there = already.get(item.title);
        if (there !== undefined) {
          moved.push({ item, issue: there });
          continue;
        }
        const issue = await options.github.createIssue({
          repo: checked.repo,
          title: item.title,
          body: `${item.body ?? ""}\n\nMoved from \`${path}\` by Courtyard's setup.`.trim(),
          labels: [MOVED_LABEL],
          milestone: null,
        });
        if (!issue.ok) return err(problemWords(issue.error));
        moved.push({ item, issue: issue.value.number });
        filed += 1;
      }
      if (moved.length > 0) files.set(path, pointedTo(text, moved, tracker.path === SCRATCH));
    }
    return ok({ filed, files });
  };

  /**
   * The files setting up changes, as the owner chose: each new or changed file's text, and `null`
   * for one removed.
   */
  const changesFor = async (
    checked: Checked,
    choices: Choices,
    moved: ReadonlyMap<string, string>,
  ): Promise<Map<string, string | null>> => {
    const { card } = checked;
    const at = onDefault(checked.repoPath, checked.tracking);
    const changes = new Map<string, string | null>(moved);
    const now = async (path: string) => {
      const changed = changes.get(path);
      return changed === undefined ? at(path) : (changed ?? undefined);
    };
    if (card.glossary !== null && choices.glossary === GLOSSARY) {
      // The rename, and every Markdown file on the default branch that names it by its old name.
      const text = await at(card.glossary.path);
      changes.set(card.glossary.path, null);
      changes.set(GLOSSARY, `${(text ?? "").trimEnd()}\n`);
      const naming = await gitOrNothing(checked.repoPath, [
        "grep",
        "-l",
        "-z",
        "-P",
        NAMED_CONTEXT.source,
        checked.tracking,
        "--",
        "*.md",
      ]);
      for (const found of (naming ?? "").split("\0")) {
        const path = found.slice(checked.tracking.length + 1);
        if (path === "" || path === card.glossary.path) continue;
        const named = await now(path);
        if (named !== undefined) {
          changes.set(path, `${named.replace(NAMED_CONTEXT, GLOSSARY).trimEnd()}\n`);
        }
      }
    }
    const kept = card.tracker !== null && !choices.moveTracker ? card.tracker : null;
    for (const path of card.files) {
      changes.set(
        path,
        await mattFile(checked.templates, { path, kept, glossary: choices.glossary }),
      );
    }
    if (card.section !== null) {
      const section = agentSkills(kept, choices.glossary);
      const text = await now(card.section.path);
      changes.set(
        card.section.path,
        text === undefined || text.trim() === "" ? section : `${text.trimEnd()}\n\n${section}`,
      );
    }
    if (checked.pointClaude) {
      const text = (await now(CLAUDE))?.trim() ?? "";
      changes.set(CLAUDE, text === "" ? `${POINTER}\n` : `${POINTER}\n\n${text}\n`);
    }
    return changes;
  };

  /**
   * Makes the changes on a branch of their own, started from the default branch in a worktree in
   * the data folder, pushes it and opens its pull request; or says why it couldn't.
   */
  const openPullRequest = async (
    checked: Checked,
    changes: ReadonlyMap<string, string | null>,
    summary: readonly string[],
  ): Promise<Result<{ number: number; url: string } | null, string>> => {
    if (changes.size === 0) return ok(null);
    const branch = `courtyard/matt-setup-${randomBytes(4).toString("hex")}`;
    const worktree = join(options.dataDir, "worktrees", branch.replace("/", "-"));
    const env = await options.code.commandEnv();
    try {
      await git(checked.repoPath, [
        "worktree",
        "add",
        "--quiet",
        "--no-track",
        "-b",
        branch,
        worktree,
        checked.tracking,
      ]);
      for (const [path, text] of changes) {
        if (text === null) {
          await git(worktree, ["rm", "--quiet", "--", path]);
        } else if (!(await writeTextFileIn(join(worktree, path), text))) {
          return err(`${path} couldn't be written`);
        }
      }
      await git(worktree, ["add", "--all"]);
      await git(worktree, ["commit", "--quiet", "-m", "Set up Matt Pocock's skills"]);
      await git(worktree, ["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], {
        env,
        timeoutMs: 60_000,
      });
    } catch (error) {
      return err(gitFailureReason(error));
    } finally {
      await gitOrNothing(checked.repoPath, ["worktree", "remove", "--force", worktree]);
      await gitOrNothing(checked.repoPath, ["branch", "-D", branch]);
      await removeFolder(worktree);
    }
    const opened = await options.github.openPullRequest({
      repo: checked.repo,
      branch,
      base: checked.base,
      title: "Set up Matt Pocock's skills",
      body: [
        "Moves this repository to the house standard Matt Pocock's skills read, as the owner chose on Courtyard's setup card:",
        "",
        ...summary.map((line) => `- ${line}`),
        "",
        "Opened by Courtyard's setup card, once the owner set it up.",
      ].join("\n"),
    });
    return opened.ok ? ok(opened.value) : err(problemWords(opened.error));
  };

  return {
    /**
     * The house standard's files for a new repo (#391): Matt's files from his templates, its
     * AGENTS.md with the house rules and the Agent skills section, a CLAUDE.md pointing there
     * (#642), its glossary and its decisions folder, by path.
     */
    filesForNew: async (repo: {
      name: string;
      intro: string;
    }): Promise<Result<Map<string, string>, "no-matt-skills">> => {
      const copy = await options.matt?.copy();
      const setupSkill = copy?.ok
        ? copy.value.skills.find((s) => s.name === SETUP_SKILL)
        : undefined;
      if (setupSkill === undefined) return err("no-matt-skills");
      const files = new Map<string, string>();
      for (const path of FILES) {
        files.set(
          path,
          await mattFile(setupSkill.folder, { path, kept: null, glossary: GLOSSARY }),
        );
      }
      files.set("AGENTS.md", houseAgents(repo));
      files.set(CLAUDE, `${POINTER}\n`);
      files.set(GLOSSARY, houseGlossary(repo.name));
      files.set("docs/adr/README.md", HOUSE_DECISIONS);
      return ok(files);
    },

    /**
     * A new repo's GitHub side of the house standard (#391): the labels it hasn't got, its first
     * milestone, and what it's for filed there as its first idea, needing a grill, on the
     * milestone's Build order line, so its Next up offers Grill on it.
     */
    startNew: async (repo: {
      fullName: string;
      name: string;
      intro: string;
    }): Promise<Result<null, string>> => {
      const has = await options.github.labels({ repo: repo.fullName });
      if (!has.ok) return err(problemWords(has.error));
      for (const label of LABELS.filter((each) => !has.value.includes(each.name))) {
        const made = await options.github.createLabel({ repo: repo.fullName, ...label });
        if (!made.ok) return err(problemWords(made.error));
      }
      const milestone = await options.github.createMilestone({
        repo: repo.fullName,
        title: FIRST_MILESTONE,
        description: "",
      });
      if (!milestone.ok) return err(problemWords(milestone.error));
      const issue = await options.github.createIssue({
        repo: repo.fullName,
        title: repo.intro === "" ? "Pick the stack and what to build first" : repo.intro,
        body: `The first idea for ${repo.name}, as it was said when its repo was made. Grill it: what it's for, the stack it's built with, and what to build first.`,
        labels: FIRST_IDEA_LABELS,
        milestone: milestone.value,
      });
      if (!issue.ok) return err(problemWords(issue.error));
      const ordered = await options.github.describeMilestone({
        repo: repo.fullName,
        number: milestone.value,
        description: `Build order: #${issue.value.number}.`,
      });
      return ordered.ok ? ok(null) : err(problemWords(ordered.error));
    },

    /** The setup card for a workspace's page: what to offer, if anything. */
    offer: async (id: WorkspaceId): Promise<MattSetup> => {
      if ((await answers())[id] !== undefined) return { state: "none" };
      const checked = await check(id);
      return checked !== undefined && offersAnything(checked.card)
        ? { state: "offered", card: checked.card }
        : { state: "none" };
    },

    /**
     * The owner's answer: Not now, or Set up, which does what the card says, each line as the
     * owner chose or as it recommends.
     */
    answer: async (
      id: WorkspaceId,
      given: MattSetupAnswer,
    ): Promise<Result<MattSetup, MattSetupProblem>> => {
      if (given.answer === "not-now") {
        await remember(id, "not-now");
        return ok({ state: "none" });
      }
      const checked = await check(id);
      if (checked === undefined) return err({ kind: "not-found" });
      const { card } = checked;
      const recommended = recommendedChoices(card);
      const tracker = given.tracker ?? recommended.tracker;
      const choices: Choices = {
        moveTracker: card.tracker !== null && tracker === "move",
        glossary:
          card.glossary === null || (given.glossary ?? recommended.glossary) === "rename"
            ? GLOSSARY
            : card.glossary.path,
        makePaper: card.paper !== null && (given.paper ?? recommended.paper) === "create",
      };
      const labelsMade: string[] = [];
      if (makesLabels(card, tracker)) {
        for (const label of LABELS.filter((each) => card.labels.includes(each.name))) {
          const made = await options.github.createLabel({ repo: checked.repo, ...label });
          if (!made.ok) return err({ kind: "failed", reason: problemWords(made.error) });
          labelsMade.push(label.name);
        }
      }
      const moved =
        card.tracker !== null && choices.moveTracker
          ? await moveTracker(checked, card.tracker)
          : ok({ filed: 0, files: new Map<string, string>() });
      if (!moved.ok) return err({ kind: "failed", reason: moved.error });
      const changes = await changesFor(checked, choices, moved.value.files);
      const opened = await openPullRequest(
        checked,
        changes,
        summaryOf(checked, choices, moved.value.filed),
      );
      if (!opened.ok) return err({ kind: "failed", reason: opened.error });
      await remember(id, "allowed");
      const paper: SetupPaper =
        card.paper !== null && choices.makePaper
          ? await makePaperFile(options.connections, id, card.paper.name)
          : { kind: "skipped" };
      return ok({
        state: "opened",
        pullRequest: opened.value,
        labelsMade,
        issuesFiled: moved.value.filed,
        paper,
      });
    },
  };
};

/** Whether a card moves the repository anywhere: its Paper line alone doesn't. */
const offersAnything = (card: SetupCard) => opensPullRequest(card) || card.labels.length > 0;

/** A file's text on the default branch (`tracking`), or `undefined` when it isn't there. */
const onDefault = (repoPath: string, tracking: string) => (path: string) =>
  gitOrNothing(repoPath, ["show", `${tracking}:${path}`]);

/**
 * The repository's own tracker on its default branch, if it keeps one: a backlog or TODO file
 * with a list in it, else tickets under `.scratch/`. Keep is recommended over moving it when its
 * instructions say another tool or agent writes it.
 */
const ownTracker = async (
  repoPath: string,
  tracking: string,
  instructions: readonly string[],
): Promise<SetupTracker | null> => {
  const at = onDefault(repoPath, tracking);
  let path: string | undefined;
  for (const each of TRACKER_FILES) {
    const text = await at(each);
    if (text !== undefined && /^\s*[-*+] /m.test(text)) {
      path = each;
      break;
    }
  }
  if (path === undefined && (await scratchTickets(repoPath, tracking)).length > 0) path = SCRATCH;
  if (path === undefined) return null;
  return writtenByAnother(instructions, path)
    ? { path, recommended: "keep", why: WRITTEN_BY_ANOTHER }
    : { path, recommended: "move" };
};

/**
 * Whether the repository's instructions say another tool or agent writes its tracker: a line
 * that names the file and says something else writes or keeps it.
 */
const writtenByAnother = (instructions: readonly string[], path: string) => {
  const name = basename(path.replace(/\/$/, ""));
  return instructions
    .flatMap((text) => text.split("\n"))
    .some(
      (line) =>
        line.includes(name) &&
        /\b(agent|tool|bot|script|automation)s?\b/i.test(line) &&
        /\b(writes?|written|maintains?|maintained|updates?|generates?|generated|owns?|manages?)\b/i.test(
          line,
        ),
    );
};

/** The ticket files under `.scratch/`, as his local tracker keeps them, on the default branch. */
const scratchTickets = async (repoPath: string, tracking: string) => {
  const listed = await gitOrNothing(repoPath, [
    "ls-tree",
    "-r",
    "--name-only",
    tracking,
    "--",
    SCRATCH,
  ]);
  return (listed ?? "").split("\n").filter((path) => /\/issues\/[^/]+\.md$/.test(path));
};

/**
 * An open item of a tracker: its words, its title as an issue's (cut to a title's length), the
 * line it's on, and anything more about it.
 */
type Item = {
  readonly words: string;
  readonly title: string;
  readonly line: number;
  readonly body?: string;
};
/** An item moved, and the issue it's now. */
type Moved = { readonly item: Item; readonly issue: number };

/** A heading that says the items under it are done. */
const DONE = /^(done|closed|finished|shipped|completed)\b/i;

/**
 * A list file's open items: its unticked boxes, or with no boxes at all, its top-level list items;
 * never under a heading that says they're done, or one inside it.
 */
const openItems = (text: string): Item[] => {
  const boxes = /^\s*[-*+] \[[ xX]\] /m.test(text);
  const item = boxes ? /^\s*[-*+] \[ \] (.+)$/ : /^[-*+] (.+)$/;
  const items: Item[] = [];
  /** The level of the heading whose items are done, while under it. */
  let doneAt: number | undefined;
  for (const [line, each] of text.split("\n").entries()) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(each);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      if (doneAt !== undefined && level > doneAt) continue;
      doneAt = DONE.test(heading[2] ?? "") ? level : undefined;
      continue;
    }
    const words = item.exec(each)?.[1]?.trim();
    if (doneAt === undefined && words !== undefined && words !== "") {
      items.push({ words, title: words.slice(0, 200), line });
    }
  }
  return items;
};

/** A `.scratch/` ticket, unless its Status says it's resolved: titled by its first heading. */
const scratchItem = (path: string, text: string): Item[] => {
  if (/^Status:\s*(resolved|closed|done|wontfix)\b/im.test(text)) return [];
  const words = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? basename(path, ".md");
  return [{ words, title: words.slice(0, 200), line: -1, body: text.trim() }];
};

/**
 * A tracker's text once its items moved: each one's line names its issue, and a note at its top
 * (under its first heading) says where its work lives now. A `.scratch/` ticket gets a line at
 * its end.
 */
const pointedTo = (text: string, moved: readonly Moved[], scratch: boolean) => {
  if (scratch) {
    const issues = moved.map(({ issue }) => `#${issue}`).join(", ");
    return `${text.trimEnd()}\n\nMoved to GitHub issue ${issues}.\n`;
  }
  const lines = text.split("\n");
  for (const { item, issue } of moved) {
    const bullet = lines[item.line]?.match(/^\s*[-*+]/)?.[0] ?? "-";
    lines[item.line] = `${bullet} ${item.words}: moved to #${issue}`;
  }
  const note =
    "Work for this repo is in GitHub issues now: each open item here moved to one, named on its line.";
  const heading = lines.findIndex((line) => /^#\s/.test(line));
  lines.splice(heading + 1, 0, ...(heading === -1 ? [note, ""] : ["", note]));
  return `${lines.join("\n").trimEnd()}\n`;
};

/**
 * One of Matt's files under `docs/agents/`, from his template in `templates`, for where the work
 * lives (GitHub issues, unless a tracker was `kept`) and the glossary's name.
 */
const mattFile = async (
  templates: string,
  file: { path: string; kept: SetupTracker | null; glossary: string },
) => {
  const template = (name: string) => readFile(join(templates, name), "utf8");
  if (file.path === ISSUE_TRACKER) {
    if (file.kept === null) return template("issue-tracker-github.md");
    return file.kept.path === SCRATCH ? template("issue-tracker-local.md") : keptTracker(file.kept);
  }
  if (file.path === TRIAGE_LABELS) return template("triage-labels.md");
  return (await template("domain.md")).split(CONTEXT).join(file.glossary);
};

/**
 * A new repo's AGENTS.md (#391): its name, what it's for, the house rules (no stack yet, so the
 * first session picks it, and its pull request adds CI, #642), and the Agent skills section.
 */
const houseAgents = (repo: { name: string; intro: string }) =>
  [
    `# ${repo.name}`,
    "",
    ...(repo.intro === "" ? [] : [repo.intro, ""]),
    "## House rules",
    "",
    "- **No stack yet.** The first session (Grill on Next up) picks it with the owner and sets it up in one pull request.",
    "- **The first stack's pull request adds CI:** `.github/workflows/ci.yml`, running this repo's own check scripts (lint, typecheck, tests, and browser tests if there are any) on every pull request, each action pinned to a version (`actions/checkout@v7`).",
    "- **Every change works from an issue** in this repo's GitHub issues, in a milestone, with a category label (`bug` or `enhancement`) and one triage label. Its pull request closes it.",
    "- **The order of work is the milestones:** each one's description has a `Build order:` line.",
    "- **Anything the owner sees is designed in this repo's Paper file first,** when it has one: its pages are `1 · Live`, `2 · Agreed`, `3 · Drafts` and `4 · Archive`.",
    "- **Its words are in `GLOSSARY.md`,** and why it's built the way it is in `docs/adr/`.",
    "",
    agentSkills(null, GLOSSARY),
  ].join("\n");

/** A new repo's glossary (#391): empty until its words are settled. */
const houseGlossary = (name: string) =>
  [
    "# Glossary",
    "",
    `The words ${name} uses, each with what it means and the words to avoid for it. The domain-modeling skill adds them as they're settled.`,
    "",
  ].join("\n");

/** A new repo's decisions folder (#391), with what goes in it. */
const HOUSE_DECISIONS = [
  "# Decisions",
  "",
  "One file per decision, numbered (`0001-…md`): what was decided and why. The domain-modeling skill writes them.",
  "",
].join("\n");

/** `docs/agents/issue-tracker.md` for a tracker the owner kept: where the work lives (#323). */
const keptTracker = (tracker: SetupTracker) =>
  [
    `# Issue tracker: ${tracker.path}`,
    "",
    `Work for this repo lives in \`${tracker.path}\`, not in GitHub issues.`,
    "",
    `- **To see what's open, or fetch a ticket**: read \`${tracker.path}\`.`,
    tracker.recommended === "move"
      ? `- **To file an issue**: add it to \`${tracker.path}\`. To close one, mark it done there.`
      : `- **To file an issue**: this repo's instructions say another tool or agent writes \`${tracker.path}\`, so file work the way they say, not by editing it yourself.`,
    "",
  ].join("\n");

/** The Agent skills section, for where the work lives and the glossary's name. */
const agentSkills = (kept: SetupTracker | null, glossary: string) =>
  [
    "## Agent skills",
    "",
    "### Issue tracker",
    "",
    kept === null
      ? "GitHub Issues on this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`."
      : kept.path === SCRATCH
        ? "Local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`."
        : `Work lives in \`${kept.path}\`. See \`docs/agents/issue-tracker.md\`.`,
    "",
    "### Triage labels",
    "",
    "The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.",
    "",
    "### Domain docs",
    "",
    `Single-context: \`${glossary}\` and \`docs/adr/\` at the root. See \`docs/agents/domain.md\`.`,
    "",
  ].join("\n");

/** What setting up did, as its pull request lists it. */
const summaryOf = ({ card, pointClaude }: Checked, choices: Choices, filed: number) => [
  ...(card.tracker === null
    ? []
    : choices.moveTracker
      ? [
          `Moved \`${card.tracker.path}\` to GitHub issues: ${filed} open ${filed === 1 ? "item" : "items"} filed, each line pointing to its issue`,
        ]
      : [`Kept \`${card.tracker.path}\` as where work lives, recorded in \`${ISSUE_TRACKER}\``]),
  ...(card.glossary === null
    ? []
    : choices.glossary === GLOSSARY
      ? [`Renamed \`${card.glossary.path}\` to \`${GLOSSARY}\`, and the files that name it`]
      : [`Kept \`${card.glossary.path}\` as the glossary, named in \`${DOMAIN}\``]),
  ...card.files.map((path) => `\`${path}\``),
  ...(card.section === null ? [] : [`The Agent skills section in \`${card.section.path}\``]),
  ...(pointClaude
    ? [`\`${CLAUDE}\` pointing Claude at \`AGENTS.md\`, so it reads the same rules`]
    : []),
];

/** A GitHub problem in the owner's words. */
const problemWords = (problem: { kind: string; message?: string }) =>
  problem.kind === "github" && problem.message !== undefined
    ? problem.message
    : "GitHub couldn't be asked. Check Connections.";
