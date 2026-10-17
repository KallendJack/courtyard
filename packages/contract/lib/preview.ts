import { z } from "zod";
import { TaskId } from "./tasks.ts";

// A code session's preview (#183): one of its tasks serving a web page, reached through a port of
// the worker's own, behind the owner's login, only while the task runs.

/**
 * The sizes a preview is looked at in: the Fold's cover screen, the Fold unfolded, and a desktop,
 * as the browser tests size them. The model's screenshots take one by name.
 */
export const PREVIEW_SIZES = {
  cover: { width: 400, height: 640 },
  unfolded: { width: 950, height: 712 },
  desktop: { width: 1440, height: 900 },
} as const;

/** One of the sizes, by name. */
export const PreviewSize = z.enum(["cover", "unfolded", "desktop"]);
export type PreviewSize = z.infer<typeof PreviewSize>;

/** The longest preview command the owner can start. */
export const PREVIEW_COMMAND_MAX_LENGTH = 500;

/** A code session's preview, as its page shows it. */
export const Preview = z.discriminatedUnion("kind", [
  /** One of its tasks serves a page, reached on the worker's own `port`, on the worker's address. */
  z.object({
    kind: z.literal("serving"),
    task: TaskId,
    port: z.number().int().min(1).max(65535),
  }),
  /** The task Start preview started runs, and hasn't said where it serves yet. */
  z.object({ kind: z.literal("starting"), task: TaskId }),
  /** A task serves a page, but every preview port is in use by other previews. */
  z.object({ kind: z.literal("full"), task: TaskId }),
  /**
   * None serves. Start preview runs `command` as a task: the workspace's, once the owner has
   * confirmed it (`confirmed`), else the one Courtyard filled in from the repository's scripts, or
   * `null` when it found none.
   */
  z.object({
    kind: z.literal("none"),
    command: z.string().nullable(),
    confirmed: z.boolean(),
  }),
]);
export type Preview = z.infer<typeof Preview>;

/** Start preview: the command the owner confirmed, which the workspace keeps from then on. */
export const StartPreview = z.object({
  command: z.string().trim().min(1).max(PREVIEW_COMMAND_MAX_LENGTH),
});
export type StartPreview = z.infer<typeof StartPreview>;
