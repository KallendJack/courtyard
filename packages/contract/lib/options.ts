import { z } from "zod";
import { PROJECT_FIELD_MAX_CHARACTERS } from "./projects.ts";
import { ThingSlug, ThingUpcoming } from "./things.ts";

/**
 * An `options` block's JSON (#602, #603, ADR 0032): real options side by side, which the web app
 * draws with Pick on each. For replacing one of the owner's Things, `part` names it by its file, as
 * the model's list of Things gives it (`things/pedals.md`), and a pick becomes its upcoming one:
 * each option is kept as an upcoming part is, linked to the page it was found on. For a decision
 * on a project, `about` says what's being decided ("Desk"), and in a session that belongs to the
 * project a pick records its decision, with the options and why. A block may have both. The first
 * option is the one the model would pick.
 */
export const OptionsBlock = z
  .object({
    part: z.string().trim().min(1).max(200).optional(),
    about: z.string().trim().min(1).max(PROJECT_FIELD_MAX_CHARACTERS).optional(),
    options: z.array(ThingUpcoming).min(1).max(4),
  })
  .refine((block) => block.part !== undefined || block.about !== undefined)
  .refine(
    (block) => block.part === undefined || block.options.every(({ link }) => link !== undefined),
  );
export type OptionsBlock = z.infer<typeof OptionsBlock>;

/** The Thing an options block is for, by its file (`things/pedals.md`) or its file's name. */
export const optionsPart = (part: string): ThingSlug | undefined => {
  const name = part
    .trim()
    .replace(/^things\//, "")
    .replace(/\.md$/, "");
  const slug = ThingSlug.safeParse(name);
  return slug.success ? slug.data : undefined;
};
