import { z } from "zod";
import { ThingSlug, ThingUpcoming } from "./things.ts";

/**
 * An `options` block's JSON (#602, ADR 0032): real options for replacing one of the owner's
 * Things, side by side, which the web app draws with Pick on each, a pick becoming that Thing's
 * upcoming replacement. The Thing by its file, as the model's list of Things gives it
 * (`things/pedals.md`), and each option as an upcoming part is kept, its link the page found on
 * the web, the one the model would pick first.
 */
export const OptionsBlock = z.object({
  part: z.string().trim().min(1).max(200),
  options: z
    .array(ThingUpcoming.extend({ link: ThingUpcoming.shape.link.unwrap() }))
    .min(1)
    .max(4),
});
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
