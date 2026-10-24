import {
  type BuildChanged,
  type BuildChat,
  type BuildChatSent,
  type BuildOpened,
  BuildParametersChange,
  type BuildPlace,
  BuildSlug,
  type Builds,
  NewMessage,
  type ProviderList,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import { err, ok } from "../../lib/result.ts";
import type { Provider } from "../../providers/index.ts";
import type { WholeFilesUndoRefusal } from "../context-folder/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import {
  fileIn,
  type PlanningFiles,
  sharedFileError,
  workspaceIn,
} from "../planning-files/routes.ts";
import { readProjects } from "../projects/index.ts";
import type { Sessions } from "../sessions/index.ts";
import { readMessageWithAttachments, sessionError } from "../sessions/routes.ts";
import { getWorkspace } from "../workspaces/index.ts";
import { chatOf, chatSessionOf } from "./chat.ts";
import { type BuildRefusal, readBuild, readBuilds, saveBuild, viewOf } from "./index.ts";

// Fabrication's API (ADR 0037, #697): what the Fabrication app calls, never Courtyard's own
// workspace or session routes, so a standalone Fabrication could answer the same with its own
// storage. Courtyard backs it with a planning workspace's Builds, and a Build's chat with its
// sessions (#698).

const BUILDS: PlanningFiles = { one: "Build", many: "Builds" };

/**
 * A Build's chat, under `/api/fabrication`: a message may come with files attached, so the worker
 * gives it the larger body limit, as a session's messages have.
 */
export const FABRICATION_CHAT = "/workspaces/:id/builds/:slug/chat";

/** Why a Build wasn't read or saved, as the API answers it. */
const buildError = (c: Context, refusal: BuildRefusal) => {
  switch (refusal.kind) {
    case "workspace":
    case "code-workspace":
    case "not-found":
    case "storage":
      return sharedFileError(c, refusal, BUILDS);
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "parameters":
      return apiError(c, {
        status: 400,
        error: `Those parameters can't be worked out: ${refusal.problems.join("; ")}`,
      });
    case "incomplete":
      return apiError(c, {
        status: 400,
        error: "Give the Build a name, a template and its parameters.",
      });
    case "clash":
      return apiError(c, { status: 409, error: `There's already a Build called ${refusal.name}.` });
    case "unreadable":
      return apiError(c, {
        status: 409,
        error: `${refusal.path} can't be read as a Build: ${refusal.problem}`,
      });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "stale":
      return apiError(c, { status: 409, error: "That Build has changed since." });
  }
};

/** Why Undo of a Build's change wasn't done, from its note or Recent changes, as the API answers it. */
export const buildUndoError = (c: Context, refusal: WholeFilesUndoRefusal) =>
  refusal.kind === "changed-since"
    ? apiError(c, {
        status: 409,
        error: "That Build has changed since, so undoing this would lose the newer change.",
      })
    : sharedFileError(c, refusal, BUILDS);

/** Fabrication's routes under `/api/fabrication`. */
export const fabricationRoutes = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder"> & {
    now: () => number;
    /** What the Build's chat is: Courtyard's sessions, and the models they can answer with. */
    sessions: Pick<Sessions, "list" | "events" | "create" | "send">;
    providers: readonly Provider[];
  },
) => {
  const routes = new Hono();
  const { now, sessions, providers, ...where } = target;

  /** A Build as read, and where it is: its workspace, and the project whose step makes it. */
  const opened = async (c: Context) => {
    const named = fileIn(c, where, BuildSlug);
    if (named === undefined) return err(sharedFileError(c, { kind: "not-found" }, BUILDS));
    const read = await readBuild(named.workspace, named.slug);
    if (!read.ok) return err(buildError(c, read.error));
    const workspace = await getWorkspace(where.contextDir, named.workspace.workspaceId);
    if (!workspace.ok) return err(contextError(c, workspace.error));
    const projects = await readProjects(named.workspace);
    if (!projects.ok) return err(buildError(c, { kind: "storage" }));
    const project = projects.value.projects.find(({ project }) =>
      project.steps.some((step) => step.build === named.slug),
    )?.project;
    const place: BuildPlace = {
      workspace: { id: workspace.value.summary.id, name: workspace.value.summary.name },
      project: project === undefined ? null : { slug: project.slug, name: project.name },
    };
    return ok({ build: read.value, place, slug: named.slug });
  };

  // The models the Build's chat can answer with, for its Reply box.
  routes.get("/models", async (c) =>
    c.json({
      providers: await Promise.all(providers.map((provider) => provider.status())),
    } satisfies ProviderList),
  );

  // A workspace's Builds, by name, and the files that can't be read as one.
  routes.get("/workspaces/:id/builds", async (c) => {
    const workspace = workspaceIn(c, where);
    if (workspace === undefined) return sharedFileError(c, { kind: "not-found" }, BUILDS);
    const read = await readBuilds(workspace);
    if (!read.ok) return buildError(c, read.error);
    return c.json({
      builds: read.value.builds.map(({ summary }) => summary),
      problems: [...read.value.problems],
    } satisfies Builds);
  });

  // One Build with everything its engine derives, worked out now, and where it is.
  routes.get("/workspaces/:id/builds/:slug", async (c) => {
    const found = await opened(c);
    if (!found.ok) return found.error;
    const { build, place } = found.value;
    return c.json({ ...viewOf(build), place } satisfies BuildOpened);
  });

  // Its chat: the session it's in, as Fabrication shows it.
  routes.get("/workspaces/:id/builds/:slug/chat", async (c) => {
    const found = await opened(c);
    if (!found.ok) return found.error;
    const { place, slug } = found.value;
    const session = await chatSessionOf(sessions, {
      workspaceId: place.workspace.id,
      slug,
      project: place.project?.slug,
    });
    if (!session.ok) return sessionError(c, session.error);
    if (session.value === undefined) {
      return c.json({ session: null, answering: false, entries: [] } satisfies BuildChat);
    }
    const events = await sessions.events(session.value.id);
    if (!events.ok) return sessionError(c, events.error);
    return c.json(chatOf(session.value, events.value, slug) satisfies BuildChat);
  });

  // The owner's next message in its chat, with any photos: into its session, or a new one that
  // belongs to its project.
  routes.post(FABRICATION_CHAT, async (c) => {
    const found = await opened(c);
    if (!found.ok) return found.error;
    const { place, slug } = found.value;
    const sent = await readMessageWithAttachments(c, NewMessage);
    if (!sent.ok) return sent.error;
    const session = await chatSessionOf(sessions, {
      workspaceId: place.workspace.id,
      slug,
      project: place.project?.slug,
    });
    if (!session.ok) return sessionError(c, session.error);
    if (session.value !== undefined) {
      const next = await sessions.send({ rawId: session.value.id, ...sent.value });
      if (!next.ok) return sessionError(c, next.error);
      return c.json({ session: session.value.id } satisfies BuildChatSent, 202);
    }
    const started = await sessions.create({
      workspaceId: place.workspace.id,
      message: {
        ...sent.value.message,
        ...(place.project === null ? {} : { project: place.project.slug }),
      },
      attachments: sent.value.attachments,
    });
    if (!started.ok) return sessionError(c, started.error);
    return c.json({ session: started.value.id } satisfies BuildChatSent, 202);
  });

  // The owner's own change to a Build's parameters, as a merge patch, worked out again.
  routes.patch("/workspaces/:id/builds/:slug/parameters", async (c) => {
    const named = fileIn(c, where, BuildSlug);
    if (named === undefined) return sharedFileError(c, { kind: "not-found" }, BUILDS);
    const body = await readBody(c, BuildParametersChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await saveBuild(
      named.workspace,
      { slug: named.slug, parameters: body.value.parameters },
      { now: now() },
    );
    if (!saved.ok) return buildError(c, saved.error);
    return c.json({
      change: saved.value.change ?? null,
      build: viewOf(saved.value.build),
    } satisfies BuildChanged);
  });

  return routes;
};
