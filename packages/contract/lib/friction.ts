import { z } from "zod";
import { PreviewSize } from "./preview.ts";
import { MAX_MESSAGE_LENGTH } from "./session.ts";
import { WorkspaceId } from "./workspace-summary.ts";

// Something's off (#554): friction the owner reports from any screen, filed in Courtyard's own
// code workspace with what the screen showed.

/**
 * Where Something's off files a report: the code workspace on the repository the live copy runs
 * from, or `null` when no workspace is (a worker that isn't a live copy); and the version it runs,
 * as its short commit, when it's a live copy.
 */
export const FrictionPlace = z.object({
  workspace: z.object({ id: WorkspaceId, name: z.string() }).nullable(),
  version: z.string().nullable(),
});
export type FrictionPlace = z.infer<typeof FrictionPlace>;

/**
 * What the sheet filled in and the owner said, sent as a multipart form's message field with the
 * screen, when it could be taken, as its one attachment.
 */
export const FrictionReport = z.object({
  said: z.string().trim().min(1, "Say what's off first").max(MAX_MESSAGE_LENGTH),
  /** The page in a word or two ("Home", "Garage · Session"), and its path. */
  page: z.string().trim().min(1).max(200),
  path: z.string().max(2000),
  /** The screen it was on, by the sizes the boards are drawn at, and its size in CSS pixels. */
  size: z.object({
    device: PreviewSize,
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
  }),
  version: z.string().max(64).nullable(),
  /** The part of the screen the owner last touched, by its name ("Backup line"), when known. */
  part: z.string().trim().min(1).max(200).nullable(),
});
export type FrictionReport = z.infer<typeof FrictionReport>;
