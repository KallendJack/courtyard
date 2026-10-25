import { z } from "zod";
import { ProjectSlug } from "../projects.ts";
import { ModelRef, SessionId } from "../session.ts";
import { WorkspaceId } from "../workspace.ts";
import { BuildView } from "./builds.ts";

// What the Fabrication app's Build page reads (#698, ADR 0037): the Build where it is, and its
// chat. Fabrication owns these shapes; Courtyard answers them from a planning workspace and its
// sessions, and a standalone Fabrication could answer them from its own.

/** Where a Build is: its workspace, and the project whose step makes it, if one does. */
export const BuildPlace = z.object({
  workspace: z.object({ id: WorkspaceId, name: z.string() }),
  project: z.object({ slug: ProjectSlug, name: z.string() }).nullable(),
});
export type BuildPlace = z.infer<typeof BuildPlace>;

/** The most steps, and lines in a step, progress keeps: far more than any Build has. */
const MOST_STEPS = 200;

/**
 * How far the owner has got with a Build's steps (#699): the step reached, and the lines ticked in
 * each step by their place in it (0 is the first), so every device and a new session open where
 * they left off. A Build not started is at step 1 with nothing ticked.
 */
export const BuildProgress = z.object({
  step: z.number().int().min(1).max(MOST_STEPS),
  ticked: z
    .array(
      z.object({
        step: z.number().int().min(1).max(MOST_STEPS),
        lines: z.array(z.number().int().min(0).max(MOST_STEPS)).max(MOST_STEPS),
      }),
    )
    .max(MOST_STEPS),
});
export type BuildProgress = z.infer<typeof BuildProgress>;

/** A Build as Fabrication opens it: everything derived, where it is, and how far it's got. */
export const BuildOpened = BuildView.extend({ place: BuildPlace, progress: BuildProgress });
export type BuildOpened = z.infer<typeof BuildOpened>;

/**
 * One thing in a Build's chat, by its event number: what the owner said, the model's answer, or
 * a change to the Build saved in it ("Changed: height, castors"), struck through once undone.
 */
export const BuildChatEntry = z.discriminatedUnion("from", [
  z.object({ seq: z.number().int().positive(), from: z.literal("owner"), text: z.string() }),
  z.object({ seq: z.number().int().positive(), from: z.literal("model"), text: z.string() }),
  z.object({
    seq: z.number().int().positive(),
    from: z.literal("build"),
    did: z.enum(["started", "changed"]),
    /** For a change, each parameter changed by its name ("height"), in the order saved. */
    changed: z.array(z.string()),
    undone: z.boolean(),
  }),
]);
export type BuildChatEntry = z.infer<typeof BuildChatEntry>;

/**
 * A Build's chat: the session it's in (none until the owner first says something), whether an
 * answer is coming, what's been said, and the model the session last used, which the Reply box
 * follows.
 */
export const BuildChat = z.object({
  session: SessionId.nullable(),
  answering: z.boolean(),
  entries: z.array(BuildChatEntry),
  model: ModelRef.optional(),
});
export type BuildChat = z.infer<typeof BuildChat>;

/** A message sent in a Build's chat (a `NewMessage`): the session it went to, started if need be. */
export const BuildChatSent = z.object({ session: SessionId });
export type BuildChatSent = z.infer<typeof BuildChatSent>;
