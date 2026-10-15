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
import type { Code } from "../code/index.ts";
import type { Connections } from "../connections/index.ts";
import { readJsonFile, removeFolder, writeJsonFile, writeTextFileIn } from "../files.ts";
import { git, gitFailureReason, gitOrNothing } from "../git.ts";
import type { GitHub } from "../github/index.ts";
import type { MattSkills } from "../matt-skills/index.ts";
import { err, ok, type Result } from "../result.ts";
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
    "labels" | "createLabel" | "openPullRequest" | "createIssue" | "openIssues"
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
    const claude = await at("CLAUDE.md");
    const instructions = [agents, claude].flatMap((text) => (text === undefined ? [] : [text]));
    // AGENTS.md, which every model reads, unless there's only a CLAUDE.md; never both.
    const sectionFile = agents === undefined && claude !== undefined ? "CLAUDE.md" : "AGENTS.md";
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
    const template = (name: string) => readFile(join(checked.templates, name), "utf8");
    const kept = card.tracker !== null && !choices.moveTracker ? card.tracker : null;
    for (const path of card.files) {
      const text =
        path === ISSUE_TRACKER
          ? kept === null
            ? await template("issue-tracker-github.md")
            : kept.path === SCRATCH
              ? await template("issue-tracker-local.md")
              : keptTracker(kept)
          : path === TRIAGE_LABELS
            ? await template("triage-labels.md")
            : (await template("domain.md")).split(CONTEXT).join(choices.glossary);
      changes.set(path, text);
    }
    if (card.section !== null) {
      const section = agentSkills(kept, choices.glossary);
      const text = await now(card.section.path);
      changes.set(
        card.section.path,
        text === undefined || text.trim() === "" ? section : `${text.trimEnd()}\n\n${section}`,
      );
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
        summaryOf(card, choices, moved.value.filed),
      );
      if (!opened.ok) return err({ kind: "failed", reason: opened.error });
      await remember(id, "allowed");
      let paper: SetupPaper = { kind: "skipped" };
      if (card.paper !== null && choices.makePaper) {
        const made = await options.connections.connectPaper(id, {
          kind: "new",
          name: card.paper.name,
        });
        paper = made.ok
          ? { kind: "made", name: card.paper.name }
          : {
              kind: "failed",
              reason:
                made.error.kind === "paper" ? made.error.message : "Paper couldn't be reached.",
            };
      }
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

export type MattSetupCheck = ReturnType<typeof createMattSetup>;

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
const summaryOf = (card: SetupCard, choices: Choices, filed: number) => [
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
];

/** A GitHub problem in the owner's words. */
const problemWords = (problem: { kind: string; message?: string }) =>
  problem.kind === "github" && problem.message !== undefined
    ? problem.message
    : "GitHub couldn't be asked. Check Connections.";
