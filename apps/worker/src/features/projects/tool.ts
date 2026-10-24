import {
  BuildSlug,
  type Project,
  type ProjectDecision,
  type ProjectSlug,
  ProjectStatus,
  type ProjectStep,
  StepKind,
} from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";
import { sameFileText } from "../context-folder/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import {
  type ProjectEdit,
  type ProjectRefusal,
  type ProjectSaved,
  type ReadProject,
  readProjects,
  saveProject,
} from "./index.ts";

/** A project with the label a model knows it by (`P1`), in list order. */
export type LabelledProject = { readonly label: string; readonly project: Project };

/** Labels for a workspace's projects, `P1` first, in list order. */
export const labelledProjects = (projects: readonly ReadProject[]): LabelledProject[] =>
  projects.map(({ project }, index) => ({ label: `P${index + 1}`, project }));

/** A label as a model might write it: `P2`, `[P2]` or `p2`. */
const asLabel = (raw: string) =>
  raw
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .toUpperCase();

/** A step as a model sends one to add. */
const StepSent = z.object({
  kind: StepKind,
  text: z.string(),
  detail: z.string().optional(),
});

/** What a model sends the project tool, checked like anything else a model sends. */
const ProjectRequest = z.strictObject({
  project: z.string().optional(),
  name: z.string().optional(),
  goal: z.string().optional(),
  status: ProjectStatus.optional(),
  add_steps: z.array(StepSent).optional(),
  step: z.number().int().optional(),
  step_kind: StepKind.optional(),
  step_text: z.string().optional(),
  step_detail: z.string().optional(),
  /**
   * The Build the numbered step makes, by its file's name: given by the Build tool (#697), or an
   * empty text to clear it, as for a Build since removed.
   */
  step_build: z.union([BuildSlug, z.literal("")]).optional(),
  done: z.boolean().optional(),
  remove_step: z.boolean().optional(),
  decision_about: z.string().optional(),
  decision_options: z.array(z.string()).optional(),
  decision_pick: z.string().optional(),
  decision_why: z.string().optional(),
  history: z.string().optional(),
  session: z.boolean().optional(),
});

/** An input left as `null` is one not given, as some models send them. */
const withoutNulls = (raw: unknown) =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null))
    : raw;

/** Why the project tool didn't save. */
export type ProjectToolRefusal =
  | Exclude<ProjectRefusal, { kind: "stale" }>
  | { readonly kind: "malformed" }
  /** A decision with no subject or no pick. */
  | { readonly kind: "decision-incomplete" }
  /** A step's change, done or removal with no step numbered. */
  | { readonly kind: "no-step" }
  /** No project has that label (or it's gone since). */
  | { readonly kind: "unknown-label"; readonly label: string }
  /** The project changed since the model was shown it: the projects now, labelled afresh. */
  | {
      readonly kind: "stale";
      readonly label: string;
      readonly projects: readonly LabelledProject[];
    }
  /** The owner stopped the turn, so nothing more is saved. */
  | { readonly kind: "stopped" };

/** What the project tool did: saved a project (and maybe attached the session), or only attached it. */
export type ProjectToolDone =
  | {
      readonly kind: "saved";
      readonly saved: ProjectSaved;
      readonly label: string;
      readonly attached: boolean;
    }
  | { readonly kind: "attached"; readonly label: string; readonly name: string };

/**
 * One turn's project tool (docs/ai-conduct.md, Projects): starts or changes a project by the label
 * the model was shown, and attaches the session to one. It keeps each project's file as the model
 * was shown it, or last saved it, so a change to one that's changed since is refused, with the
 * projects as they are now, labelled afresh.
 */
export const createTurnProjects = (
  target: PlanningFilesTarget & {
    /** The projects as the turn's instructions listed them. */
    readonly shown: readonly ReadProject[];
    readonly now: number;
    /** Makes the session belong to the project (#603). */
    readonly attach: (slug: ProjectSlug) => Promise<boolean>;
  },
) => {
  let labels = new Map<string, ProjectSlug>();
  const seen = new Map<ProjectSlug, string>();
  const show = (projects: readonly ReadProject[]) => {
    labels = new Map(labelledProjects(projects).map(({ label, project }) => [label, project.slug]));
    for (const { project, text } of projects) seen.set(project.slug, text);
  };
  show(target.shown);
  const labelOf = (slug: ProjectSlug) => [...labels].find(([, of]) => of === slug)?.[0];

  return async (raw: unknown): Promise<Result<ProjectToolDone, ProjectToolRefusal>> => {
    const request = ProjectRequest.safeParse(withoutNulls(raw));
    if (!request.success) return err({ kind: "malformed" });
    const sent = request.data;
    const label =
      sent.project === undefined || sent.project.trim() === "" ? undefined : asLabel(sent.project);
    const slug = label === undefined ? undefined : labels.get(label);
    if (label !== undefined && slug === undefined) return err({ kind: "unknown-label", label });

    const stepChange =
      sent.step_kind !== undefined ||
      sent.step_text !== undefined ||
      sent.step_detail !== undefined ||
      sent.step_build !== undefined ||
      sent.done === true ||
      sent.remove_step === true;
    if (stepChange && sent.step === undefined) return err({ kind: "no-step" });
    const deciding =
      sent.decision_about !== undefined ||
      sent.decision_pick !== undefined ||
      sent.decision_why !== undefined ||
      sent.decision_options !== undefined;
    if (deciding && (sent.decision_about === undefined || sent.decision_pick === undefined)) {
      return err({ kind: "decision-incomplete" });
    }
    const fields = {
      ...(sent.name === undefined ? {} : { name: sent.name }),
      ...(sent.goal === undefined ? {} : { goal: sent.goal.trim() === "" ? null : sent.goal }),
      ...(sent.status === undefined ? {} : { status: sent.status }),
    };
    const decision: ProjectDecision | undefined =
      sent.decision_about === undefined || sent.decision_pick === undefined
        ? undefined
        : {
            about: sent.decision_about,
            pick: sent.decision_pick,
            ...(sent.decision_why === undefined || sent.decision_why.trim() === ""
              ? {}
              : { why: sent.decision_why }),
            options: (sent.decision_options ?? [])
              .map((option) => option.replaceAll(";", ",").trim())
              .filter((option) => option !== ""),
          };
    const addSteps = (sent.add_steps ?? []).map(
      ({ kind, text, detail }): ProjectStep => ({
        kind,
        text,
        ...(detail === undefined || detail.trim() === "" ? {} : { detail }),
      }),
    );
    const edit: ProjectEdit = {
      ...(slug === undefined ? {} : { slug }),
      ...(Object.keys(fields).length === 0 ? {} : { fields }),
      ...(sent.step === undefined
        ? {}
        : {
            step: {
              number: sent.step,
              ...(sent.step_kind === undefined ? {} : { kind: sent.step_kind }),
              ...(sent.step_text === undefined ? {} : { text: sent.step_text }),
              ...(sent.step_detail === undefined
                ? {}
                : { detail: sent.step_detail.trim() === "" ? null : sent.step_detail }),
              ...(sent.step_build === undefined
                ? {}
                : { build: sent.step_build === "" ? null : sent.step_build }),
              ...(sent.done ? { done: true } : {}),
              ...(sent.remove_step ? { remove: true } : {}),
            },
          }),
      ...(addSteps.length === 0 ? {} : { addSteps }),
      ...(decision === undefined ? {} : { decision }),
      ...(sent.history === undefined ? {} : { history: sent.history }),
    };

    // Only attaching the session changes no file.
    const changes = Object.keys(edit).some((key) => key !== "slug");
    if (!changes && slug !== undefined && label !== undefined && sent.session) {
      if (!(await target.attach(slug))) return err({ kind: "storage" });
      const name = target.shown.find(({ project }) => project.slug === slug)?.project.name;
      return ok({ kind: "attached", label, name: name ?? slug });
    }
    if (slug === undefined && sent.name === undefined) return err({ kind: "incomplete" });

    const saved = await saveProject(target, edit, {
      now: target.now,
      check: (now) =>
        sameFileText(now.text, seen.get(now.project.slug) ?? null) ? undefined : { kind: "stale" },
    });
    if (!saved.ok) {
      if (saved.error.kind !== "stale") return err(saved.error);
      const now = await readProjects(target);
      if (!now.ok || label === undefined) return err({ kind: "storage" });
      show(now.value.projects);
      return err({ kind: "stale", label, projects: labelledProjects(now.value.projects) });
    }
    const savedSlug = saved.value.save.project.slug;
    seen.set(savedSlug, saved.value.text);
    if (labelOf(savedSlug) === undefined) labels.set(`P${labels.size + 1}`, savedSlug);
    const attached = sent.session === true && (await target.attach(savedSlug));
    return ok({ kind: "saved", saved: saved.value, label: labelOf(savedSlug) ?? "", attached });
  };
};
