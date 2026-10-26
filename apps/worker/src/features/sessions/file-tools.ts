import type { ChangeId, ProjectSlug, SessionEvent, SessionId } from "@courtyard/contract";
import { err } from "../../lib/result.ts";
import { BUILD_TOOL_NAME, buildReply } from "../../prompts/builds.ts";
import { THING_TOOL_NAME, thingReply } from "../../prompts/index.ts";
import { PROJECT_TOOL_NAME, projectReply } from "../../prompts/projects.ts";
import { SIZE_TOOL_NAME, sizeReply } from "../../prompts/sizes.ts";
import type { photosOf, ToolReply } from "../../providers/index.ts";
import type { ReadBuilds } from "../fabrication/index.ts";
import { createTurnSizes, type OwnerMessages } from "../fabrication/sizes/tool.ts";
import type { ReadSizes } from "../fabrication/sizes/index.ts";
import { createTurnBuilds } from "../fabrication/tool.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import type { ReadProjects } from "../projects/index.ts";
import { createTurnProjects } from "../projects/tool.ts";
import { createTurnThings, type ReadThings } from "../things/index.ts";
import { savingTool } from "./saving-tools.ts";

/** An event before it's numbered and timed. */
type WithoutNumbering<E> = E extends unknown ? Omit<E, "seq" | "at"> : never;

/** A file the model saved, as its session records it. */
type FileSaved = WithoutNumbering<
  Extract<SessionEvent, { type: "thing-saved" | "project-saved" | "build-saved" | "size-saved" }>
>;

/**
 * What the owner said in a session, by event number, for the size tool to tie a measurement to
 * (#708): their messages and what they added while a turn ran, never the worker's own.
 */
export const ownerMessagesIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) =>
    (event.type === "owner-message" &&
      event.checksFailed === undefined &&
      event.conflicted === undefined) ||
    (event.type === "message-added" && event.task === undefined)
      ? [{ seq: event.seq, text: event.text }]
      : [],
  );

/**
 * One turn's tools for a planning workspace's files (ADRs 0020, 0036, 0037): its Things, projects,
 * Builds and sizes, each through `savingTool`, every save recorded in the session as it's made. A
 * Build given to a project's step is given through the project tool, its own change and note.
 */
export const fileSavingTools = (turn: {
  readonly target: PlanningFilesTarget & { readonly sessionId: SessionId };
  readonly shown: {
    readonly things: ReadThings;
    readonly projects: ReadProjects;
    readonly builds: ReadBuilds;
    readonly sizes: ReadSizes;
  };
  readonly photos: ReturnType<typeof photosOf>;
  readonly ownerMessages: OwnerMessages;
  readonly now: number;
  readonly stopped: () => boolean;
  readonly record: (event: FileSaved) => Promise<void>;
  /** The session belongs to the project from now on (#603). */
  readonly attach: (project: ProjectSlug) => Promise<boolean>;
}) => {
  const { target, shown, stopped, now } = turn;
  const withChange = (change: ChangeId | undefined) => (change === undefined ? {} : { change });
  const things = savingTool({
    stopped,
    run: createTurnThings({ ...target, shown: shown.things.things, photos: turn.photos, now }),
    record: ({ save, change }) => turn.record({ type: "thing-saved", save, ...withChange(change) }),
    reply: thingReply,
    stoppedReply: () => thingReply(err({ kind: "stopped" }), true),
  });
  const turnProjects = createTurnProjects({
    ...target,
    shown: shown.projects.projects,
    now,
    attach: turn.attach,
  });
  const projectSaved = async (input: unknown) => {
    const done = await turnProjects(input);
    if (done.ok && done.value.kind === "saved") {
      const { save, change } = done.value.saved;
      await turn.record({ type: "project-saved", save, ...withChange(change) });
    }
    return done;
  };
  const projects = savingTool({
    stopped,
    run: projectSaved,
    record: async () => undefined,
    reply: projectReply,
    stoppedReply: () => projectReply(err({ kind: "stopped" }), true),
  });
  /** How giving a Build to its project's step went, for the Build tool's reply. */
  let stepReply: ToolReply | undefined;
  const builds = savingTool({
    stopped,
    run: createTurnBuilds({ ...target, shown: shown.builds.builds, now }),
    // One that changed nothing (its numbers read) has no save, and may still give its step.
    record: async ({ step, build, ...done }) => {
      if (done.kind === "saved") {
        const { save, change } = done.saved;
        await turn.record({ type: "build-saved", save, ...withChange(change) });
      }
      stepReply = undefined;
      if (step === undefined) return;
      const given = { step: step.id, step_build: build.summary.slug };
      stepReply = projectReply(await projectSaved({ project: step.project, ...given }), true);
    },
    reply: (done, retrying) => buildReply(done, { retrying, step: stepReply }),
    stoppedReply: () => buildReply(err({ kind: "stopped" }), { retrying: true }),
  });
  const sizes = savingTool({
    stopped,
    run: createTurnSizes({
      ...target,
      shown: { sizes: shown.sizes.sizes, things: shown.things.things },
      ownerMessages: turn.ownerMessages,
      now,
    }),
    record: async (done) => {
      if (done.kind !== "saved") return;
      const { save, change } = done.saved;
      await turn.record({ type: "size-saved", save, ...withChange(change) });
    },
    reply: sizeReply,
    stoppedReply: () => sizeReply(err({ kind: "stopped" }), true),
  });
  return {
    [THING_TOOL_NAME]: things,
    [PROJECT_TOOL_NAME]: projects,
    [BUILD_TOOL_NAME]: builds,
    [SIZE_TOOL_NAME]: sizes,
  } as const;
};
