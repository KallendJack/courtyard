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
