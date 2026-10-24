import { z } from "zod";
import { ChangeId } from "../change-id.ts";

// Builds (ADR 0036, 0037, #697): a design worked out by code, which Fabrication owns and a planning
// workspace hosts, a JSON file each in its `builds` folder. The file holds only what's chosen, its
// template and parameters; everything else (parts, cut plan, buy list, steps, findings) is derived
// by `packages/fabrication` on read, never stored.

/** A Build's file name without `.json`: its name's letters and digits, words joined by dashes. */
export const BuildSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80)
  .brand<"BuildSlug">();
export type BuildSlug = z.infer<typeof BuildSlug>;

/** What a Build is made from: the templates `packages/fabrication` derives. */
export const BuildTemplate = z.enum(["framed-bench"]);
export type BuildTemplate = z.infer<typeof BuildTemplate>;

/** The longest a Build's name gets. */
export const BUILD_NAME_MAX_CHARACTERS = 120;

export const BuildName = z
  .string()
  .trim()
  .min(1, "Give the Build a name.")
  .max(
    BUILD_NAME_MAX_CHARACTERS,
    `Keep the Build's name to ${BUILD_NAME_MAX_CHARACTERS} characters.`,
  )
  .refine((text) => !/[\r\n]/.test(text), "Keep the Build's name to one line.");

/** A template's parameters as JSON, which its engine checks (`BenchParameters` for a bench). */
export const BuildParameters = z.record(z.string(), z.unknown());
export type BuildParameters = z.infer<typeof BuildParameters>;

/** A Build's file, `builds/<slug>.json`: its name, its template and the parameters chosen. */
export const BuildFile = z.strictObject({
  name: BuildName,
  template: BuildTemplate,
  parameters: BuildParameters,
});
export type BuildFile = z.infer<typeof BuildFile>;

/** A Build as a list shows it, and where its file is. */
export const BuildSummary = z.object({
  slug: BuildSlug,
  name: z.string(),
  template: BuildTemplate,
  /** Its path in the workspace's folder: `builds/<slug>.json`. */
  path: z.string(),
  updatedAt: z.iso.datetime(),
});
export type BuildSummary = z.infer<typeof BuildSummary>;

/** A workspace's Builds, and the files that can't be read as one (with what's wrong). */
export const Builds = z.object({
  builds: z.array(BuildSummary),
  problems: z.array(z.object({ path: z.string(), problem: z.string() })),
});
export type Builds = z.infer<typeof Builds>;

/**
 * A Build with everything derived: its parameters as chosen, and `derived`, the engine's `Build`
 * (`packages/fabrication`'s `build.ts`) worked out from them just now.
 */
export const BuildView = BuildSummary.extend({
  parameters: BuildParameters,
  derived: z.record(z.string(), z.unknown()),
});
export type BuildView = z.infer<typeof BuildView>;

/**
 * A change to a Build's parameters, as a JSON merge patch (RFC 7386): what's given replaces what's
 * there, an object merges into the one there, and `null` takes a value out.
 */
export const BuildParametersChange = z.object({ parameters: BuildParameters });
export type BuildParametersChange = z.infer<typeof BuildParametersChange>;

/** A Build changed: the change it was committed as (`null` when git couldn't keep it), and it now. */
export const BuildChanged = z.object({ change: z.nullable(ChangeId), build: BuildView });
export type BuildChanged = z.infer<typeof BuildChanged>;

/**
 * What one Build save did, for its note: started it or changed it, by its file's name and its name
 * then, and each parameter changed ("height: 900 → 850").
 */
export const BuildSave = z.object({
  action: z.enum(["add", "change"]),
  build: z.object({ slug: BuildSlug, name: z.string() }),
  changes: z.array(z.string()),
});
export type BuildSave = z.infer<typeof BuildSave>;

/**
 * A change to a Build as Recent changes lists it: what it did (removed only by undoing its start),
 * its name, and its file's name while it's still there.
 */
export const BuildChange = z.object({
  did: z.enum(["added", "changed", "removed"]),
  name: z.string(),
  slug: BuildSlug.nullable(),
});
export type BuildChange = z.infer<typeof BuildChange>;
