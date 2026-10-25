import { BuildParameters, BuildTemplate } from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";
import { sameFileText } from "../context-folder/index.ts";
import { slugOfPath } from "../documents/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import {
  type BuildEdit,
  type BuildRefusal,
  type BuildSaved,
  type ReadBuild,
  readBuild,
  readBuilds,
  saveBuild,
} from "./index.ts";

/** A Build with the label a model knows it by (`B1`), in list order. */
export type LabelledBuild = { readonly label: string; readonly build: ReadBuild };

/** Labels for a workspace's Builds, `B1` first, in list order. */
export const labelledBuilds = (builds: readonly ReadBuild[]): LabelledBuild[] =>
  builds.map((build, index) => ({ label: `B${index + 1}`, build }));

/** A label as a model might write it: `B2`, `[B2]` or `b2`. */
const asLabel = (raw: string) =>
  raw
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .toUpperCase();

/** What a model sends the Build tool, checked like anything else a model sends. */
const BuildRequest = z.strictObject({
  build: z.string().optional(),
  name: z.string().optional(),
  template: BuildTemplate.optional(),
  parameters: BuildParameters.optional(),
  project: z.string().optional(),
  /** The project's step that makes it, by its ID (#710). */
  step: z.string().optional(),
  /** The documents it supersedes, by their paths (#786). */
  supersedes: z.array(z.string()).optional(),
});

/** An input left as `null` is one not given, as some models send them. */
const withoutNulls = (raw: unknown) =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null))
    : raw;

/** Why the Build tool didn't save. */
export type BuildToolRefusal =
  | Exclude<BuildRefusal, { kind: "stale" } | { kind: "unchanged" }>
  | { readonly kind: "malformed" }
  /** A project named with no step, or a step with no project. */
  | { readonly kind: "no-step" }
  /** No Build has that label (or it's gone since). */
  | { readonly kind: "unknown-label"; readonly label: string }
  /** The Build changed since the model was shown it: the Builds now, labelled afresh. */
  | { readonly kind: "stale"; readonly label: string; readonly builds: readonly LabelledBuild[] }
  /** The owner stopped the turn, so nothing more is saved. */
  | { readonly kind: "stopped" };

/**
 * What the Build tool did: saved the Build, or changed nothing, so the model reads its numbers as
 * they are (#697); the Build as it is now; and the project step it's to belong to, if the model
 * named one.
 */
export type BuildToolDone = (
  | { readonly kind: "saved"; readonly saved: BuildSaved }
  | { readonly kind: "unchanged" }
) & {
  readonly build: ReadBuild;
  readonly label: string;
  readonly step?: { readonly project: string; readonly id: string };
};

/**
 * One turn's Build tool (docs/ai-conduct.md, Builds): starts or changes a Build by the label the
 * model was shown, or, given only its label or a change of nothing, gives it as it is. It keeps
 * each Build's file as the model was shown it, or last saved it, so a change to one that's
 * changed since is refused, with the Builds as they are now.
 */
export const createTurnBuilds = (
  target: PlanningFilesTarget & {
    /** The Builds as the turn's instructions listed them. */
    readonly shown: readonly ReadBuild[];
    readonly now: number;
  },
) => {
  let labels = new Map<string, ReadBuild["summary"]["slug"]>();
  const seen = new Map<string, string>();
  const show = (builds: readonly ReadBuild[]) => {
    labels = new Map(labelledBuilds(builds).map(({ label, build }) => [label, build.summary.slug]));
    for (const { summary, text } of builds) seen.set(summary.slug, text);
  };
  show(target.shown);
  const labelOf = (slug: string) => [...labels].find(([, of]) => of === slug)?.[0];

  return async (raw: unknown): Promise<Result<BuildToolDone, BuildToolRefusal>> => {
    const request = BuildRequest.safeParse(withoutNulls(raw));
    if (!request.success) return err({ kind: "malformed" });
    const sent = request.data;
    const label =
      sent.build === undefined || sent.build.trim() === "" ? undefined : asLabel(sent.build);
    const slug = label === undefined ? undefined : labels.get(label);
    if (label !== undefined && slug === undefined) return err({ kind: "unknown-label", label });
    if ((sent.project === undefined) !== (sent.step === undefined)) return err({ kind: "no-step" });
    const step =
      sent.project === undefined || sent.step === undefined
        ? {}
        : { step: { project: sent.project, id: sent.step } };
    /**
     * The Build as it is now, for a call that changes nothing, so the model can give its numbers
     * without working any out (#697): it's been shown it afresh.
     */
    const asItIs = async (): Promise<Result<BuildToolDone, BuildToolRefusal>> => {
      if (label === undefined || slug === undefined) return err({ kind: "storage" });
      const read = await readBuild(target, slug);
      if (!read.ok) {
        const { error } = read;
        return err(
          error.kind === "stale" || error.kind === "unchanged" ? { kind: "storage" } : error,
        );
      }
      seen.set(slug, read.value.text);
      return ok({ kind: "unchanged", build: read.value, label, ...step });
    };
    const paths = sent.supersedes?.map((path) => ({ path, slug: slugOfPath(path) }));
    const notADocument = paths?.find(({ slug }) => slug === undefined);
    if (notADocument !== undefined) {
      return err({ kind: "no-document", path: notADocument.path.trim() });
    }
    const supersedes = paths?.flatMap(({ slug }) => (slug === undefined ? [] : [slug]));
    // Only its label (and a step to give it to) reads it, with nothing to write.
    if (
      slug !== undefined &&
      sent.name === undefined &&
      sent.parameters === undefined &&
      supersedes === undefined
    ) {
      return asItIs();
    }

    const edit: BuildEdit = {
      ...(slug === undefined
        ? {
            ...(sent.name === undefined ? {} : { name: sent.name }),
            ...(sent.template === undefined ? {} : { template: sent.template }),
            ...(sent.parameters === undefined ? {} : { parameters: sent.parameters }),
          }
        : {
            slug,
            ...(sent.name === undefined ? {} : { name: sent.name }),
            ...(sent.parameters === undefined ? {} : { parameters: sent.parameters }),
          }),
      ...(supersedes === undefined ? {} : { supersedes }),
    };
    const saved = await saveBuild(target, edit, {
      now: target.now,
      check: (now) =>
        sameFileText(now.text, seen.get(now.summary.slug) ?? null) ? undefined : { kind: "stale" },
    });
    if (!saved.ok) {
      if (saved.error.kind === "unchanged") return asItIs();
      if (saved.error.kind !== "stale") return err(saved.error);
      const now = await readBuilds(target);
      if (!now.ok || label === undefined) return err({ kind: "storage" });
      show(now.value.builds);
      return err({ kind: "stale", label, builds: labelledBuilds(now.value.builds) });
    }
    const savedSlug = saved.value.build.summary.slug;
    seen.set(savedSlug, saved.value.build.text);
    if (labelOf(savedSlug) === undefined) labels.set(`B${labels.size + 1}`, savedSlug);
    return ok({
      kind: "saved",
      saved: saved.value,
      build: saved.value.build,
      label: labelOf(savedSlug) ?? "",
      ...step,
    });
  };
};
