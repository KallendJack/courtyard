import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type BuildSlug,
  type ChangeId,
  PROJECT_LINE_MAX_CHARACTERS,
  type Project,
  type ProjectChange,
  ProjectDecision,
  ProjectFields,
  type ProjectSave,
  ProjectSlug,
  type StepId,
  type StepWho,
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
 * its steps (each with its ID, who does it, done or not and what it needs, #710), its decisions
 * (the options weighed, the pick and why) and a dated history. Every write is one change through
 * the context folder, so Recent changes lists it with Undo.
 */

/** The folder in a workspace's folder that holds its projects. */
export const PROJECTS_FOLDER = "projects";

/** A project's path in its workspace's folder. */
export const projectPath = (slug: ProjectSlug) => `${PROJECTS_FOLDER}/${slug}.md`;

const fileOf = (folder: string, slug: ProjectSlug) => join(folder, PROJECTS_FOLDER, `${slug}.md`);

import { projectText, readProjectText } from "./file.ts";
import { editSteps } from "./steps.ts";

export { type ProjectFile, type ProjectHistoryLine, projectText, readProjectText } from "./file.ts";

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
  /** No step has that ID: the IDs it has. */
  | { readonly kind: "no-such-step"; readonly id: string; readonly ids: readonly StepId[] }
  /** The step has no such need: the needs it has. */
  | { readonly kind: "no-such-need"; readonly need: string; readonly needs: readonly string[] }
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
  /** One of its steps, by its ID (#710). */
  readonly step?: {
    readonly id: string;
    readonly text?: string;
    /** Its detail, or `null` to clear it. */
    readonly detail?: string | null;
    readonly who?: StepWho;
    /** The Build it makes (#697), or `null` to clear it. */
    readonly build?: BuildSlug | null;
    /** What it needs to know first, in place of what it needed; an answer kept for the same need. */
    readonly needs?: readonly string[];
    /** One of its needs, by its words, now known: what was found. */
    readonly known?: { readonly need: string; readonly known: string };
    /** Done (dated today, its history saying so), or not done after all. */
    readonly done?: boolean;
    readonly remove?: boolean;
    /** Moved before another step, by its ID, or to the end with `null`. */
    readonly before?: string | null;
  };
  /** Steps to add, each its words, detail, who and needs. */
  readonly addSteps?: readonly NewStep[];
  /** The step to add them before, by its ID; left out, after its others. */
  readonly addBefore?: string;
  /** A decision made: kept with its options, pick and why, under Decisions (#710: never a step). */
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

/** A step to add: its words, its detail, who does it and what it needs to know first. */
export type NewStep = {
  readonly text: string;
  readonly detail?: string | undefined;
  readonly who: StepWho;
  readonly needs?: readonly string[];
};

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

      const edited = editSteps(was?.value.steps ?? [], edit, today);
      if (!edited.ok) return edited;
      const { steps } = edited.value;
      changes.push(...edited.value.changes);
      history.push(...edited.value.history);
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
