import { z } from "zod";
import { SkillName, SkillSource } from "./skill-name.ts";

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

/** What every skill a workspace lists says of it. */
const SkillAbout = {
  /** What it's for; empty for a broken skill without one. */
  description: z.string(),
  source: SkillSource,
  /** Only the owner starts it, so a model is never offered it (`"start": "owner"`). */
  ownerOnly: z.boolean(),
};

/** A skill a workspace's models can use. */
export const UsableSkillSummary = z.object({
  kind: z.literal("usable"),
  name: SkillName,
  ...SkillAbout,
  /** One of the owner's, or a project's, with a house skill's name, which it replaces here. */
  replacesHouse: z.boolean(),
});
export type UsableSkillSummary = z.infer<typeof UsableSkillSummary>;

/** One skill a workspace gets, or one it would get but can't use, and why. */
export const SkillSummary = z.discriminatedUnion("kind", [
  UsableSkillSummary,
  z.object({
    kind: z.literal("unusable"),
    /** Its name; for a broken skill, its folder's name, which may not be a skill's name. */
    name: z.string(),
    ...SkillAbout,
    problem: SkillProblem,
  }),
]);
export type SkillSummary = z.infer<typeof SkillSummary>;

/** A workspace's skills: the ones it can use by name, then the ones it can't. */
export const SkillList = z.object({ skills: z.array(SkillSummary) });
export type SkillList = z.infer<typeof SkillList>;

/** A skill's name as the app shows it: "get-to-know" is "Get to know". */
export const skillTitle = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
