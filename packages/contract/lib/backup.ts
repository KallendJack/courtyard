import { z } from "zod";

/** Whether the context folder's backup has every change (ADR 0014). */
export const ContextBackup = z.discriminatedUnion("kind", [
  /** Git can't use the context folder, so changes are made but not kept as changes at all. */
  z.object({ kind: z.literal("not-kept"), reason: z.string() }),
  /** No remote is set, so changes are only kept on the worker machine. */
  z.object({ kind: z.literal("not-set-up") }),
  z.object({ kind: z.literal("up-to-date") }),
  /** Changes since `since` aren't in the backup yet, because of `reason`. */
  z.object({
    kind: z.literal("behind"),
    since: z.iso.datetime({ offset: true }),
    reason: z.string(),
  }),
]);
export type ContextBackup = z.infer<typeof ContextBackup>;
