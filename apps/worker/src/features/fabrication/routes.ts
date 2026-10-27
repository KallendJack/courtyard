import {
  type BuildChanged,
  type BuildChat,
  type BuildChatSent,
  type BuildOpened,
  BuildParametersChange,
  BuildProgress,
  BuildSlug,
  BuildStockPick,
  type Builds,
  type BuildView,
  ChangeId,
  NewMessage,
  type ProviderList,
  ToolsChange,
  type ToolsHeard,
  ToolsSaid,
  type ToolsSaved,
  ToolsUndo,
  type YourTools,
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
import { chatOf, chatSessionOf, takenAt } from "./chat.ts";
import {
  type BuildRefusal,
  readBuild,
  readBuilds,
  saveBuild,
  undoChangeToBuild,
  viewOf,
} from "./index.ts";
import type { createPrints } from "./print.ts";
import { printRoutes } from "./print-routes.ts";
import { keepProgress } from "./progress.ts";
import { sizeRoutes } from "./sizes/routes.ts";
import { hearTools, saveTools, type ToolsRefusal, undoToolsSave, yourTools } from "./tools.ts";

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
    case "no-document":
      return apiError(c, { status: 400, error: `There's no document at ${refusal.path}.` });
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

/** Why the owner's tools weren't read or saved, as the API answers it. */
const toolsError = (c: Context, refusal: ToolsRefusal) => {
  switch (refusal.kind) {
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "twice":
      return apiError(c, {
        status: 400,
        error: `${refusal.name} is there twice: give each tool once.`,
      });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "gone":
      return apiError(c, {
        status: 409,
        error: `${refusal.workspace} has no Thing ${refusal.thing} to move any more: tick your tools again.`,
      });
    case "has-parts":
      return apiError(c, {
        status: 409,
        error: `${refusal.name} has parts, so it stays where it is: untick it, or add it as your own.`,
      });
    case "storage":
      return apiError(c, { status: 500, error: "Your tools couldn't be read or saved just now." });
  }
};

/** Why Undo of a save of the owner's tools wasn't done, as the API answers it. */
const toolsUndoError = (c: Context, refusal: WholeFilesUndoRefusal) => {
  switch (refusal.kind) {
    case "not-found":
    case "not-undoable":
      return apiError(c, { status: 404, error: "There's no such save of your tools to undo." });
    case "already-undone":
      return apiError(c, { status: 409, error: "That's undone already." });
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "Your tools have changed since, so undoing this would lose the newer change.",
      });
    case "storage":
      return apiError(c, { status: 500, error: "Your tools couldn't be read or saved just now." });
  }
};

/** Fabrication's routes under `/api/fabrication`. */
export const fabricationRoutes = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder"> & {
    now: () => number;
    /**
     * What the Build's chat is: Courtyard's sessions, and the models they can answer with, which
     * also tick Your tools from what the owner said.
     */
    sessions: Pick<Sessions, "list" | "events" | "create" | "send">;
    providers: readonly Provider[];
    /** How a printed part's solid and files are made (#702): the builds lock, and a time limit. */
    printing: Parameters<typeof createPrints>[0];
  },
) => {
  const routes = new Hono();
  const { now, sessions, providers, printing, ...where } = target;
  routes.route("/", sizeRoutes({ ...where, now }));

  // The owner's tools (#707): every Build's and every workspace's, with what to move.
  routes.get("/tools", async (c) => {
    const read = await yourTools(where.contextDir);
    if (!read.ok) return toolsError(c, read.error);
    return c.json(read.value satisfies YourTools);
  });

  // Your tools' Save: every tool the owner has now, as one change.
  routes.put("/tools", async (c) => {
    const body = await readBody(c, ToolsChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await saveTools(where, body.value.tools);
    if (!saved.ok) return toolsError(c, saved.error);
    const read = await yourTools(where.contextDir);
    if (!read.ok) return toolsError(c, read.error);
    return c.json({ change: saved.value.change ?? null, tools: read.value } satisfies ToolsSaved);
  });

  routes.post("/tools/undo", async (c) => {
    const body = await readBody(c, ToolsUndo);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const undone = await undoToolsSave(where, body.value.change);
    if (!undone.ok) return toolsUndoError(c, undone.error);
    return c.body(null, 204);
  });

  // "Or just say it": the tools a model heard, ticked for the owner to check, saving nothing.
  routes.post("/tools/heard", async (c) => {
    const body = await readBody(c, ToolsSaid);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const heard = await hearTools(providers, body.value.said);
    if (heard === undefined) {
      return apiError(c, {
        status: 503,
        error: "No model could listen just now: tick your tools instead.",
      });
    }
    return c.json(heard satisfies ToolsHeard);
  });

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
    const place: BuildOpened["place"] = {
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
    return c.json({ ...viewOf(build), place, progress: build.progress } satisfies BuildOpened);
  });

  // How far the owner has got with its steps (#699), kept so every device opens there.
  routes.put("/workspaces/:id/builds/:slug/progress", async (c) => {
    const named = fileIn(c, where, BuildSlug);
    if (named === undefined) return sharedFileError(c, { kind: "not-found" }, BUILDS);
    const body = await readBody(c, BuildProgress);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const kept = await keepProgress(named.workspace, named.slug, body.value);
    if (!kept.ok) {
      return kept.error.kind === "no-such-step"
        ? apiError(c, {
            status: 400,
            error: `${kept.error.name} has no step ${kept.error.step}.`,
          })
        : buildError(c, kept.error);
    }
    return c.json(kept.value satisfies BuildProgress);
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
    const { build, place, slug } = found.value;
    const read = await readMessageWithAttachments(c, NewMessage);
    if (!read.ok) return read.error;
    const sent = { ...read.value, attachments: takenAt(build, read.value.attachments) };
    const session = await chatSessionOf(sessions, {
      workspaceId: place.workspace.id,
      slug,
      project: place.project?.slug,
    });
    if (!session.ok) return sessionError(c, session.error);
    if (session.value !== undefined) {
      const next = await sessions.send({ rawId: session.value.id, ...sent });
      if (!next.ok) return sessionError(c, next.error);
      return c.json({ session: session.value.id } satisfies BuildChatSent, 202);
    }
    const started = await sessions.create({
      workspaceId: place.workspace.id,
      message: {
        ...sent.message,
        ...(place.project === null ? {} : { project: place.project.slug }),
      },
      attachments: sent.attachments,
    });
    if (!started.ok) return sessionError(c, started.error);
    return c.json({ session: started.value.id } satisfies BuildChatSent, 202);
  });

  // A printed part made, and its files (#702).
  printRoutes(routes, { opened, printing });

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

  // The owner's pick of one of a stock's options (#704): every part cut from it follows, worked
  // out again.
  routes.post("/workspaces/:id/builds/:slug/stock", async (c) => {
    const named = fileIn(c, where, BuildSlug);
    if (named === undefined) return sharedFileError(c, { kind: "not-found" }, BUILDS);
    const body = await readBody(c, BuildStockPick);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await saveBuild(
      named.workspace,
      { slug: named.slug, pick: body.value },
      { now: now() },
    );
    if (!saved.ok) return buildError(c, saved.error);
    return c.json({
      change: saved.value.change ?? null,
      build: viewOf(saved.value.build),
    } satisfies BuildChanged);
  });

  // Undo of one of its changes, from Fabrication: the Build as it is again.
  routes.post("/workspaces/:id/builds/:slug/changes/:change/undo", async (c) => {
    const named = fileIn(c, where, BuildSlug);
    const id = ChangeId.safeParse(c.req.param("change"));
    if (named === undefined || !id.success) {
      return sharedFileError(c, { kind: "not-found" }, BUILDS);
    }
    const undone = await undoChangeToBuild(named.workspace, { slug: named.slug, id: id.data });
    if (!undone.ok) return buildUndoError(c, undone.error);
    const read = await readBuild(named.workspace, named.slug);
    if (!read.ok) return buildError(c, read.error);
    return c.json(viewOf(read.value) satisfies BuildView);
  });

  return routes;
};
