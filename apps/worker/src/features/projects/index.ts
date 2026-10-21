import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChangeId,
  PROJECT_LINE_MAX_CHARACTERS,
  type Project,
  type ProjectChange,
  ProjectDecision,
  ProjectFields,
  type ProjectSave,
  ProjectSlug,
  ProjectStep,
  StepKind,
} from "@courtyard/contract";
import { listFolder, readTextFile, writeTextFileIn } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { undoWholeFiles, type WholeFile } from "../context-folder/index.ts";
import {
  type PlanningFilesTarget,
  type PlanningFolderRefusal,
  pathInWorkspace,
  planningChange,
  planningFolder,
  slugFor,
} from "../planning-files/index.ts";

/**
 * A planning workspace's projects (#603, ADR 0032): what the owner carries over days and sessions,
 * a Markdown file each in its `projects` folder. Its name, goal and status in front matter, then
 * its steps (each one the owner can do, one that needs a pro, or one decided), its decisions (the
 * options weighed, the pick and why) and a dated history. Every write is one change through the
 * context folder, so Recent changes lists it with Undo.
 */

/** The folder in a workspace's folder that holds its projects. */
export const PROJECTS_FOLDER = "projects";

/** A project's path in its workspace's folder. */
export const projectPath = (slug: ProjectSlug) => `${PROJECTS_FOLDER}/${slug}.md`;

const fileOf = (folder: string, slug: ProjectSlug) => join(folder, PROJECTS_FOLDER, `${slug}.md`);

/** One line of a project's history: its date (`2026-10-20`), when it has one, and what happened. */
export type ProjectHistoryLine = { readonly date: string | null; readonly text: string };

/** A project's file, read: its fields, steps, decisions and history, oldest first. */
export type ProjectFile = {
  readonly fields: ProjectFields;
  readonly steps: readonly ProjectStep[];
  readonly decisions: readonly ProjectDecision[];
  readonly history: readonly ProjectHistoryLine[];
};

const FRONT_KEYS = ["name", "goal", "status"] as const;
const SECTIONS = { steps: "Steps", decisions: "Decisions", history: "History" } as const;
const SECTION_KEYS = ["steps", "decisions", "history"] as const;
const STEP_LINE = /^[-*][ \t]+\[([^\]]+)\][ \t]*(.*)$/;
const HISTORY_LINE = /^(?:[-*][ \t]+)?(?:(\d{4}-\d{2}-\d{2}):[ \t]*)?(.*)$/;
const DECISION_LINE = /^[-*][ \t]+(pick|why|options):[ \t]*(.*)$/i;
/** Between a step's words and its detail, as its file writes it. */
const DETAIL = " · ";

/** A step as its file writes it: `- [needs a pro] Sockets by the desk · an electrician`. */
const stepLine = ({ kind, text, detail }: ProjectStep) =>
  `- [${kind}] ${text}${detail === undefined ? "" : `${DETAIL}${detail}`}`;

/** A project's file read, or what's wrong with it. */
export const readProjectText = (text: string): Result<ProjectFile, string> => {
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    return err("It doesn't start with its name and status between --- lines.");
  }
  const raw: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const [, key = "", value = ""] = /^([^:]+):(.*)$/.exec(line) ?? [];
    const field = FRONT_KEYS.find((name) => name === key.trim().toLowerCase());
    if (field === undefined) return err(`It has a line Courtyard doesn't know: "${line.trim()}".`);
    const unquoted = value.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (unquoted !== "") raw[field] = unquoted;
  }
  const fields = ProjectFields.safeParse(raw);
  if (!fields.success) {
    const [issue] = fields.error.issues;
    const name = String(issue?.path[0] ?? "a field");
    return err(
      raw[name] === undefined
        ? `It has no ${name}.`
        : name === "status"
          ? "Its status isn't active or done."
          : `Its ${name} doesn't fit: ${issue?.message ?? "it can't be read"}`,
    );
  }
  const steps: ProjectStep[] = [];
  const decisions: ProjectDecision[] = [];
  const history: ProjectHistoryLine[] = [];
  let section: keyof typeof SECTIONS | undefined;
  let decision: Record<string, unknown> | undefined;
  const endDecision = (): string | undefined => {
    if (decision === undefined) return undefined;
    const read = ProjectDecision.safeParse(decision);
    decision = undefined;
    if (!read.success) return `A decision doesn't fit: ${read.error.issues[0]?.message ?? ""}`;
    decisions.push(read.data);
    return undefined;
  };
  for (const line of lines.slice(end + 1)) {
    const said = line.trim();
    if (said === "") continue;
    const heading = /^##[ \t]+(.+)$/.exec(said);
    if (heading !== null) {
      const ended = endDecision();
      if (ended !== undefined) return err(ended);
      section = SECTION_KEYS.find(
        (key) => SECTIONS[key].toLowerCase() === heading[1]?.trim().toLowerCase(),
      );
      if (section === undefined) return err(`It has a section Courtyard doesn't know: "${said}".`);
      continue;
    }
    if (section === "steps") {
      const [, kind = "", rest = ""] = STEP_LINE.exec(said) ?? [];
      const at = rest.indexOf(DETAIL);
      const step = ProjectStep.safeParse({
        kind: StepKind.safeParse(kind.trim().toLowerCase()).data,
        text: at === -1 ? rest : rest.slice(0, at),
        ...(at === -1 ? {} : { detail: rest.slice(at + DETAIL.length) }),
      });
      if (!step.success) {
        return err(
          `A step isn't "- [you can do this]", "- [needs a pro]" or "- [decided]" and its words: "${said}".`,
        );
      }
      steps.push(step.data);
    } else if (section === "decisions") {
      const about = /^###[ \t]+(.+)$/.exec(said);
      if (about !== null) {
        const ended = endDecision();
        if (ended !== undefined) return err(ended);
        decision = { about: about[1], options: [] };
        continue;
      }
      const [, key = "", value = ""] = DECISION_LINE.exec(said) ?? [];
      if (decision === undefined || key === "") {
        return err(`A decision's line isn't its pick, why or options: "${said}".`);
      }
      decision[key.toLowerCase()] =
        key.toLowerCase() === "options"
          ? value
              .split(";")
              .map((option) => option.trim())
              .filter((option) => option !== "")
          : value.trim();
    } else if (section === "history") {
      const [, date, text = ""] = HISTORY_LINE.exec(said) ?? [];
      history.push({ date: date ?? null, text: text.trim() });
    } else {
      return err(`It has words before its first section: "${said}".`);
    }
  }
  const ended = endDecision();
  if (ended !== undefined) return err(ended);
  return ok({ fields: fields.data, steps, decisions, history });
};

/** A project's file, written from its parts. */
export const projectText = (project: ProjectFile) => {
  const { fields, steps, decisions, history } = project;
  const front = FRONT_KEYS.flatMap((key) => {
    const value = fields[key];
    return value === undefined ? [] : [`${key}: ${value}`];
  });
  const sections = [
    ...(steps.length === 0 ? [] : [`## ${SECTIONS.steps}\n\n${steps.map(stepLine).join("\n")}`]),
    ...(decisions.length === 0
      ? []
      : [
          `## ${SECTIONS.decisions}\n\n${decisions
            .map(({ about, pick, why, options }) =>
              [
                `### ${about}`,
                "",
                `- Pick: ${pick}`,
                ...(why === undefined ? [] : [`- Why: ${why}`]),
                ...(options.length === 0 ? [] : [`- Options: ${options.join("; ")}`]),
              ].join("\n"),
            )
            .join("\n\n")}`,
        ]),
    ...(history.length === 0
      ? []
      : [
          `## ${SECTIONS.history}\n\n${history
            .map(({ date, text }) => `- ${date === null ? "" : `${date}: `}${text}`)
            .join("\n")}`,
        ]),
  ];
  return `---\n${front.join("\n")}\n---\n${sections.map((section) => `\n${section}\n`).join("")}`;
};

/** Why a project wasn't read or saved. */
export type ProjectRefusal =
  | PlanningFolderRefusal
  /** A field doesn't fit: too long, more than one line, and so on. */
  | { readonly kind: "invalid"; readonly problem: string }
  /** A new project needs a name. */
  | { readonly kind: "incomplete" }
  /** Another project already has its file name. */
  | { readonly kind: "clash"; readonly name: string; readonly slug: ProjectSlug }
  | { readonly kind: "not-found"; readonly slug: ProjectSlug }
  /** Its file isn't a project as written (a hand edit, say), so it can't be changed here. */
  | { readonly kind: "unreadable"; readonly path: string; readonly problem: string }
  /** No step has that number. */
  | { readonly kind: "no-such-step"; readonly number: number; readonly steps: number }
  /** It would change nothing. */
  | { readonly kind: "unchanged"; readonly name: string }
  /** It has changed since the model was shown it. */
  | { readonly kind: "stale" }
  | { readonly kind: "storage" };

/** A project as read from its file, and its file's text. */
export type ReadProject = { readonly project: Project; readonly text: string };

/** A workspace's projects as read, and the files that aren't projects as written. */
export type ReadProjects = {
  readonly projects: readonly ReadProject[];
  readonly problems: readonly { readonly path: string; readonly problem: string }[];
};

/** Projects in order: those being carried on first, then those done, each by name. */
const inOrder = (projects: readonly ReadProject[]) =>
  [...projects].sort(
    (a, b) =>
      Number(a.project.status === "done") - Number(b.project.status === "done") ||
      a.project.name.localeCompare(b.project.name, "en-GB", { sensitivity: "base" }) ||
      a.project.slug.localeCompare(b.project.slug),
  );

const readProjectsIn = async (folder: string): Promise<Result<ReadProjects, ProjectRefusal>> => {
  const names = await listFolder(join(folder, PROJECTS_FOLDER));
  if (!names.ok) return err({ kind: "storage" });
  const projects: ReadProject[] = [];
  const problems: { path: string; problem: string }[] = [];
  for (const name of names.value.sort()) {
    if (!name.endsWith(".md")) continue;
    const path = `${PROJECTS_FOLDER}/${name}`;
    const slug = ProjectSlug.safeParse(name.replace(/\.md$/, ""));
    if (!slug.success) {
      problems.push({ path, problem: "Its file name isn't lowercase letters, digits and dashes." });
      continue;
    }
    const text = await readTextFile(fileOf(folder, slug.data));
    if (!text.ok) return err({ kind: "storage" });
    if (text.value === undefined) continue;
    const read = readProjectText(text.value);
    if (!read.ok) {
      problems.push({ path, problem: read.error });
      continue;
    }
    let updatedAt: string;
    try {
      updatedAt = (await stat(fileOf(folder, slug.data))).mtime.toISOString();
    } catch {
      return err({ kind: "storage" });
    }
    const { fields, steps, decisions } = read.value;
    projects.push({
      project: {
        ...fields,
        slug: slug.data,
        path,
        steps: [...steps],
        decisions: [...decisions],
        updatedAt,
      },
      text: text.value,
    });
  }
  return ok({ projects: inOrder(projects), problems });
};

/** A planning workspace's projects, those being carried on first, and the files that aren't projects. */
export const readProjects = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
): Promise<Result<ReadProjects, ProjectRefusal>> => {
  const folder = await planningFolder(target);
  return folder.ok ? readProjectsIn(folder.value) : folder;
};

/** Today as a project's history dates it: `2026-10-20`, on the worker machine's clock. */
const historyDate = (now: number) => new Date(now).toLocaleDateString("en-CA");

/**
 * A change to one project: a new one, or one that's there, by its file's name. Each part is
 * optional; what's given is changed, in this order: its fields, its numbered step, the steps
 * added, the decision, then a history line.
 */
export type ProjectEdit = {
  /** The project changed; left out to start one. */
  readonly slug?: ProjectSlug;
  readonly fields?: {
    readonly name?: string;
    /** Its goal, or `null` to clear it. */
    readonly goal?: string | null;
    readonly status?: ProjectFields["status"];
  };
  /** One of its steps, by its number as its file lists them (1 is the first). */
  readonly step?: {
    readonly number: number;
    readonly kind?: ProjectStep["kind"];
    readonly text?: string;
    /** Its detail, or `null` to clear it. */
    readonly detail?: string | null;
    /** The owner has done it: it leaves the steps, its history saying so. */
    readonly done?: boolean;
    readonly remove?: boolean;
  };
  /** Steps to add, after its others. */
  readonly addSteps?: readonly ProjectStep[];
  /**
   * A decision made: kept with its options, pick and why, and a decided step. The numbered step
   * becomes it when `step` names one (with nothing else to change), else it's a new decided step
   * after those decided already.
   */
  readonly decision?: ProjectDecision;
  /** A line for its history, dated today. */
  readonly history?: string;
};

/** A saved project, the change it was committed as (if git kept it), and its file's text now. */
export type ProjectSaved = {
  readonly save: ProjectSave;
  readonly change: ChangeId | undefined;
  readonly text: string;
  readonly project: Project;
};

/** A step as a note names it: its words and what it asks. */
const stepWords = ({ kind, text }: ProjectStep) => `${text} (${kind})`;

/**
 * Starts or changes one project, as one change. `check` is given the project as it is now, and
 * refuses the change by returning a refusal (one the model hasn't seen as it is, say).
 */
export const saveProject = async (
  target: PlanningFilesTarget,
  edit: ProjectEdit,
  options: { now: number; check?: (now: ReadProject) => ProjectRefusal | undefined },
): Promise<Result<ProjectSaved, ProjectRefusal>> => {
  let title = "";
  let path = "";
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<Omit<ProjectSaved, "change">, ProjectRefusal>> => {
      const folder = await planningFolder(target);
      if (!folder.ok) return folder;
      const read = await readProjectsIn(folder.value);
      if (!read.ok) return read;
      const { projects, problems } = read.value;
      const editing = edit.slug;
      const current =
        editing === undefined
          ? undefined
          : projects.find(({ project }) => project.slug === editing);
      if (editing !== undefined && current === undefined) {
        const problem = problems.find((one) => one.path === projectPath(editing));
        return problem === undefined
          ? err({ kind: "not-found", slug: editing })
          : err({ kind: "unreadable", ...problem });
      }
      if (current !== undefined) {
        const refused = options.check?.(current);
        if (refused !== undefined) return err(refused);
      }
      const was = current === undefined ? undefined : readProjectText(current.text);
      if (was !== undefined && !was.ok) return err({ kind: "storage" });
      const today = historyDate(options.now);
      const changes: string[] = [];
      const history = [...(was?.value.history ?? [])];
      const steps = [...(was?.value.steps ?? [])];
      const decisions = [...(was?.value.decisions ?? [])];

      const merged: Record<string, string | undefined> = { ...was?.value.fields };
      const { name, goal, status } = edit.fields ?? {};
      if (name !== undefined) merged.name = name;
      if (goal !== undefined) merged.goal = goal ?? undefined;
      if (status !== undefined) merged.status = status;
      if (current === undefined) merged.status ??= "active";
      if (merged.name === undefined) return err({ kind: "incomplete" });
      const fields = ProjectFields.safeParse(merged);
      if (!fields.success) {
        return err({ kind: "invalid", problem: fields.error.issues[0]?.message ?? "" });
      }
      const before = was?.value.fields;
      if (current === undefined) {
        // Its note says it was started; its history keeps the day.
        history.push({ date: today, text: "Started" });
      } else {
        if (before?.name !== fields.data.name) changes.push(`Renamed from ${before?.name ?? ""}`);
        if (before?.goal !== fields.data.goal) {
          changes.push(fields.data.goal === undefined ? "No goal" : `Goal: ${fields.data.goal}`);
        }
        if (before?.status !== fields.data.status) {
          const line = fields.data.status === "done" ? "Finished" : "Carried on again";
          changes.push(line);
          history.push({ date: today, text: line });
        }
      }

      const { step } = edit;
      /** The numbered step becomes the decision's, when it's there only for that. */
      const decides =
        step !== undefined &&
        edit.decision !== undefined &&
        step.kind === undefined &&
        step.text === undefined &&
        step.detail === undefined &&
        !step.done &&
        !step.remove;
      if (step !== undefined) {
        const at = step.number - 1;
        const there = steps[at];
        if (!Number.isInteger(step.number) || there === undefined) {
          return err({ kind: "no-such-step", number: step.number, steps: steps.length });
        }
        if (step.done || step.remove) {
          steps.splice(at, 1);
          const line = `${step.done ? "Done" : "Removed step"}: ${there.text}`;
          changes.push(line);
          if (step.done) history.push({ date: today, text: line });
        } else if (!decides) {
          const changed = ProjectStep.safeParse({
            kind: step.kind ?? there.kind,
            text: step.text ?? there.text,
            ...(step.detail === null
              ? {}
              : (step.detail ?? there.detail) === undefined
                ? {}
                : { detail: step.detail ?? there.detail }),
          });
          if (!changed.success) {
            return err({ kind: "invalid", problem: changed.error.issues[0]?.message ?? "" });
          }
          steps[at] = changed.data;
          changes.push(`Step: ${stepWords(changed.data)}`);
        }
      }
      for (const added of edit.addSteps ?? []) {
        const checked = ProjectStep.safeParse(added);
        if (!checked.success) {
          return err({ kind: "invalid", problem: checked.error.issues[0]?.message ?? "" });
        }
        steps.push(checked.data);
        changes.push(`Step: ${stepWords(checked.data)}`);
      }
      if (edit.decision !== undefined) {
        const decision = ProjectDecision.safeParse(edit.decision);
        if (!decision.success) {
          return err({ kind: "invalid", problem: decision.error.issues[0]?.message ?? "" });
        }
        const { about, pick } = decision.data;
        // A decision about the same thing again replaces the last.
        const same = decisions.findIndex((one) => one.about.toLowerCase() === about.toLowerCase());
        if (same === -1) decisions.push(decision.data);
        else decisions[same] = decision.data;
        const decided = ProjectStep.safeParse({
          kind: "decided",
          text: `${about}: ${pick}`.replaceAll(DETAIL, ", "),
        });
        if (!decided.success) {
          return err({ kind: "invalid", problem: decided.error.issues[0]?.message ?? "" });
        }
        const sameStep = steps.findIndex(
          (one) =>
            one.kind === "decided" && one.text.toLowerCase().startsWith(`${about.toLowerCase()}:`),
        );
        if (decides && step !== undefined) steps[step.number - 1] = decided.data;
        else if (sameStep !== -1) steps[sameStep] = decided.data;
        else {
          // Decided steps are settled, so they lead the list, in the order they were made.
          const after = steps.findIndex((one) => one.kind !== "decided");
          steps.splice(after === -1 ? steps.length : after, 0, decided.data);
        }
        const line = `Decided ${about}: ${pick}`;
        changes.push(line);
        history.push({ date: today, text: line });
      }
      const line = edit.history?.replace(/\s+/g, " ").trim();
      if (edit.history !== undefined) {
        if (line === undefined || line === "") {
          return err({ kind: "invalid", problem: "Give the history line some text." });
        }
        if (line.length > PROJECT_LINE_MAX_CHARACTERS) {
          return err({
            kind: "invalid",
            problem: `Keep a history line to ${PROJECT_LINE_MAX_CHARACTERS} characters.`,
          });
        }
        history.push({ date: today, text: line });
        changes.push(line);
      }

      const slug =
        current?.project.slug ?? slugFor(fields.data.name, { slug: ProjectSlug, kind: "project" });
      if (slug === undefined) {
        return err({ kind: "invalid", problem: "Its name needs a letter or a digit." });
      }
      if (current === undefined) {
        const there = projects.find(({ project }) => project.slug === slug);
        const unreadable = problems.some((one) => one.path === projectPath(slug));
        if (there !== undefined || unreadable) {
          return err({ kind: "clash", name: there?.project.name ?? fields.data.name, slug });
        }
      }
      const text = projectText({ fields: fields.data, steps, decisions, history });
      if (current !== undefined && text === current.text.replace(/\r\n/g, "\n")) {
        return err({ kind: "unchanged", name: fields.data.name });
      }
      if (!(await writeTextFileIn(fileOf(folder.value, slug), text))) {
        return err({ kind: "storage" });
      }
      path = projectPath(slug);
      title = `${current === undefined ? "Start" : "Change"} project: ${fields.data.name}`;
      return ok({
        save: {
          action: current === undefined ? "add" : "change",
          project: { slug, name: fields.data.name },
          changes,
        },
        text,
        project: {
          ...fields.data,
          slug,
          path,
          steps,
          decisions,
          updatedAt: new Date(options.now).toISOString(),
        },
      });
    },
    () => planningChange(target, { kind: "project", title, paths: [path] }),
  );
  return saved.ok ? ok({ ...saved.value.value, change: saved.value.id }) : saved;
};

/**
 * Undoes a change to a project (started or changed), as a change of its own: its file goes back
 * as it was, unless it's changed since.
 */
export const undoProjectChange = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder" | "sessionId">,
  id: ChangeId,
) => undoWholeFiles(target, { id, kinds: ["project"] });

/** The project a path in the workspace's folder names (`projects/<slug>.md`), if it names one. */
const slugOfPath = (path: string): ProjectSlug | undefined => {
  const [, name] = /^projects\/([^/]+)\.md$/.exec(path) ?? [];
  const slug = ProjectSlug.safeParse(name);
  return slug.success ? slug.data : undefined;
};

/** Whether a change's files are a project's (rather than a document's or a Thing's). */
export const isProjectChange = (files: readonly Pick<WholeFile, "path">[]) =>
  files.some(({ path }) => pathInWorkspace(path).startsWith(`${PROJECTS_FOLDER}/`));

/**
 * What a change did to a project, from the whole files it wrote or removed, for Recent changes:
 * and the path of the project's file it left, if any.
 */
export const projectChangeOf = (
  files: readonly WholeFile[],
): { project: ProjectChange; path: string | null } => {
  const file = files.find((one) => slugOfPath(pathInWorkspace(one.path)));
  const slug = file && (slugOfPath(pathInWorkspace(file.path)) ?? null);
  const nameIn = (text: string | null) => {
    const read = text === null ? undefined : readProjectText(text);
    return read?.ok ? read.value.fields.name : undefined;
  };
  const name = nameIn(file?.after ?? null) ?? nameIn(file?.before ?? null) ?? slug ?? "a project";
  const did = file?.before === null ? "added" : file?.after === null ? "removed" : "changed";
  return {
    project: { did, name, slug: did === "removed" ? null : (slug ?? null) },
    path: did === "removed" || file === undefined ? null : file.path,
  };
};
