import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MattSetup, MattSetupAnswer, MattSetupPiece, WorkspaceId } from "@courtyard/contract";
import { z } from "zod";
import type { Code } from "../code/index.ts";
import { readJsonFile, removeFolder, writeJsonFile, writeTextFileIn } from "../files.ts";
import { git, gitFailureReason, gitOrNothing } from "../git.ts";
import type { GitHub } from "../github/index.ts";
import type { MattSkills } from "../matt-skills/index.ts";
import { err, ok, type Result } from "../result.ts";
import { getWorkspace } from "../workspaces/index.ts";

/**
 * The setup check (#181): what a code workspace's repository is missing of what Matt Pocock's
 * setup skill writes for the house answers (GitHub issues, the default triage labels, one
 * glossary and `docs/adr/`), offered once as one approval. Allowed, the labels are made through
 * Courtyard's GitHub sign-in and the files go on a branch of their own, with a pull request; never
 * on the owner's checkout. His setup skill isn't run as a conversation: its answers never change.
 */

/** His setup skill, in Courtyard's pinned copy, whose templates the files are written from. */
const SETUP_SKILL = "setup-matt-pocock-skills";

/** Each file his setup writes for the house answers, and the template in his skill it's from. */
const FILES = [
  { path: "docs/agents/issue-tracker.md", template: "issue-tracker-github.md" },
  { path: "docs/agents/triage-labels.md", template: "triage-labels.md" },
  { path: "docs/agents/domain.md", template: "domain.md" },
] as const;

/** The section his setup adds for the house answers, as Courtyard's own AGENTS.md has it. */
const AGENT_SKILLS = [
  "## Agent skills",
  "",
  "### Issue tracker",
  "",
  "GitHub Issues on this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.",
  "",
  "### Triage labels",
  "",
  "The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.",
  "",
  "### Domain docs",
  "",
  "Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.",
  "",
].join("\n");

/** How a file is known to have the section already. */
const HAS_SECTION = /^## Agent skills\s*$/m;

/** The five default triage labels, with Courtyard's own colours and his meanings. */
const LABELS = [
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

/** Where the owner's answers are kept, in the data folder: each workspace's, by its id. */
const ANSWERS_FILE = "matt-setup.json";
const Answers = z.record(z.string(), z.enum(["allowed", "not-now"]));

/** Why the setup couldn't be done, in the owner's words. */
export type MattSetupProblem =
  | { readonly kind: "not-found" }
  | { readonly kind: "failed"; readonly reason: string };

/** What the check found: what's missing, and what it needs to add it. */
type Checked = {
  readonly missing: readonly MattSetupPiece[];
  readonly repoPath: string;
  readonly repo: string;
  readonly base: string;
  readonly tracking: string;
  readonly templates: string;
  /** The text of the file the section goes in, as it is on the default branch, if it's there. */
  readonly sectionFileText: string | undefined;
};

export const createMattSetup = (options: {
  readonly dataDir: string;
  readonly contextDir: string;
  readonly matt: MattSkills | undefined;
  readonly code: Pick<Code, "freshDefault" | "onGitHub" | "commandEnv">;
  readonly github: Pick<GitHub, "labels" | "createLabel" | "openPullRequest">;
}) => {
  const answersFile = join(options.dataDir, ANSWERS_FILE);
  const answers = async () => {
    const read = await readJsonFile(answersFile, Answers);
    return read.ok ? (read.value ?? {}) : {};
  };
  const remember = async (workspaceId: WorkspaceId, answer: "allowed" | "not-now") =>
    writeJsonFile(answersFile, { ...(await answers()), [workspaceId]: answer });

  /** A file's text on the default branch, or `undefined` when it isn't there. */
  const onDefault = (checked: { repoPath: string; tracking: string }, path: string) =>
    gitOrNothing(checked.repoPath, ["show", `${checked.tracking}:${path}`]);

  /**
   * What the workspace's repository is missing, read from its default branch on its remote,
   * freshly fetched, and its labels on GitHub; `undefined` when there's nothing to check: not a
   * code workspace, Matt's skills not loaded, not on GitHub, or not signed in.
   */
  const check = async (id: string): Promise<Checked | undefined> => {
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
    const at = { repoPath, tracking: fresh.value.tracking };
    const missing: MattSetupPiece[] = [];
    for (const { path } of FILES) {
      if ((await onDefault(at, path)) === undefined) missing.push({ kind: "file", path });
    }
    const agents = await onDefault(at, "AGENTS.md");
    const claude = await onDefault(at, "CLAUDE.md");
    const hasSection = [agents, claude].some(
      (text) => text !== undefined && HAS_SECTION.test(text),
    );
    // AGENTS.md, which every model reads, unless there's only a CLAUDE.md.
    const sectionFile = agents === undefined && claude !== undefined ? "CLAUDE.md" : "AGENTS.md";
    if (!hasSection) missing.push({ kind: "section", path: sectionFile });
    const lacking = LABELS.map((label) => label.name).filter(
      (name) => !labels.value.includes(name),
    );
    if (lacking.length > 0) missing.push({ kind: "labels", names: lacking });
    return {
      missing,
      repoPath,
      repo: repo.value,
      base: fresh.value.branch,
      tracking: fresh.value.tracking,
      templates: setupSkill.folder,
      sectionFileText: sectionFile === "AGENTS.md" ? agents : claude,
    };
  };

  /**
   * Adds the missing files on a branch of their own, started from the default branch in a
   * worktree in the data folder, pushes it and opens its pull request; or says why it couldn't.
   */
  const openPullRequest = async (
    checked: Checked,
  ): Promise<Result<{ number: number; url: string } | null, string>> => {
    const files = checked.missing.flatMap((piece) => (piece.kind === "labels" ? [] : [piece]));
    if (files.length === 0) return ok(null);
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
      for (const piece of files) {
        const text =
          piece.kind === "file"
            ? await readFile(join(checked.templates, templateOf(piece.path)), "utf8")
            : withSection(checked.sectionFileText);
        if (!(await writeTextFileIn(join(worktree, piece.path), text))) {
          return err(`${piece.path} couldn't be written`);
        }
      }
      await git(worktree, ["add", "--", ...files.map((piece) => piece.path)]);
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
        "Adds what Matt Pocock's skills read in this repository, as his `setup-matt-pocock-skills` writes it for GitHub issues, the default triage labels and one glossary with `docs/adr/`:",
        "",
        ...files.map((piece) =>
          piece.kind === "file"
            ? `- \`${piece.path}\``
            : `- The Agent skills section in \`${piece.path}\``,
        ),
        "",
        "Opened by Courtyard's setup check, once the owner allowed it.",
      ].join("\n"),
    });
    return opened.ok ? ok(opened.value) : err(problemWords(opened.error));
  };

  return {
    /** The setup check for a workspace's page: what to offer, if anything. */
    offer: async (id: WorkspaceId): Promise<MattSetup> => {
      if ((await answers())[id] !== undefined) return { state: "none" };
      const checked = await check(id);
      return checked === undefined || checked.missing.length === 0
        ? { state: "none" }
        : { state: "offered", missing: [...checked.missing] };
    },

    /** The owner's answer: Not now, or Allow, which adds what's missing. */
    answer: async (
      id: WorkspaceId,
      given: MattSetupAnswer["answer"],
    ): Promise<Result<MattSetup, MattSetupProblem>> => {
      if (given === "not-now") {
        await remember(id, "not-now");
        return ok({ state: "none" });
      }
      const checked = await check(id);
      if (checked === undefined) return err({ kind: "not-found" });
      const labelsMade: string[] = [];
      for (const piece of checked.missing) {
        if (piece.kind !== "labels") continue;
        for (const label of LABELS.filter((each) => piece.names.includes(each.name))) {
          const made = await options.github.createLabel({ repo: checked.repo, ...label });
          if (!made.ok) return err({ kind: "failed", reason: problemWords(made.error) });
          labelsMade.push(label.name);
        }
      }
      const opened = await openPullRequest(checked);
      if (!opened.ok) return err({ kind: "failed", reason: opened.error });
      await remember(id, "allowed");
      return ok({ state: "opened", pullRequest: opened.value, labelsMade });
    },
  };
};

export type MattSetupCheck = ReturnType<typeof createMattSetup>;

/** The template in his setup skill a file is written from. */
const templateOf = (path: string) => FILES.find((file) => file.path === path)?.template ?? "";

/** The file the section goes in, with the section at its end (or on its own, for a new file). */
const withSection = (text: string | undefined) =>
  text === undefined || text.trim() === "" ? AGENT_SKILLS : `${text.trimEnd()}\n\n${AGENT_SKILLS}`;

/** A GitHub problem in the owner's words. */
const problemWords = (problem: { kind: string; message?: string }) =>
  problem.kind === "github" && problem.message !== undefined
    ? problem.message
    : "GitHub couldn't be asked. Check Connections.";
