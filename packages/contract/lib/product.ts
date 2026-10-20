import { z } from "zod";

/**
 * A `product` block's JSON (#245): one product named in an answer, which the web app draws with
 * Add to wanted. Its name as the owner would call it, and one line about it.
 */
export const ProductBlock = z.object({
  name: z.string().trim().min(1).max(100),
  about: z.string().trim().max(120).optional(),
});
export type ProductBlock = z.infer<typeof ProductBlock>;
