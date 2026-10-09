import { z } from "zod";

/**
 * A skill's name, as the Agent Skills format has it and its folder is named: lowercase letters and
 * digits, words joined by single hyphens, up to 64 characters (ADR 0016).
 */
export const SkillName = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<"SkillName">();
export type SkillName = z.infer<typeof SkillName>;

/**
 * Where a workspace's skill comes from, the more specific first (ADR 0016): the owner's skills for
 * this workspace, a code workspace's project, the owner's skills for every workspace, or Courtyard's
 * house skills.
 */
export const SkillSource = z.enum(["workspace", "project", "everywhere", "house"]);
export type SkillSource = z.infer<typeof SkillSource>;

/** Each source as the app names it. */
export const SKILL_SOURCE_NAMES: Record<SkillSource, string> = {
  workspace: "Yours",
  project: "Project",
  everywhere: "Yours, everywhere",
  house: "House",
};

/** Why a workspace's skill can't be used there. */
export const SkillProblem = z.discriminatedUnion("kind", [
  /** It has scripts, which wait for a code workspace's shell. */
  z.object({ kind: z.literal("needs-code-workspace") }),
  /** It fails the Agent Skills format check, for this reason, in the owner's words. */
  z.object({ kind: z.literal("broken"), reason: z.string() }),
]);
export type SkillProblem = z.infer<typeof SkillProblem>;

/** One skill a workspace gets, or one it would get but can't use, and why. */
export const SkillSummary = z.object({
  /** Its name; for a broken skill, its folder's name. */
  name: z.string(),
  /** What it's for; empty for a broken skill without one. */
  description: z.string(),
  source: SkillSource,
  /** Only the owner starts it, so a model is never offered it (`"start": "owner"`). */
  ownerOnly: z.boolean(),
  /** One of the owner's, or a project's, with a house skill's name, which it replaces here. */
  replacesHouse: z.boolean(),
  /** Why it can't be used here, when it can't. */
  problem: SkillProblem.optional(),
});
export type SkillSummary = z.infer<typeof SkillSummary>;

/** A workspace's skills: the ones it can use by name, then the ones it can't. */
export const SkillList = z.object({ skills: z.array(SkillSummary) });
export type SkillList = z.infer<typeof SkillList>;

/** A skill's name as the app shows it: "get-to-know" is "Get to know". */
export const skillTitle = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
