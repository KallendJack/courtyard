import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  MOVES_MAX,
  Move,
  type MoveReview,
  type MovesMade,
  ProjectSlug,
  ThingFields,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import {
  readJsonFile,
  readTextFile,
  removeFile,
  writeJsonFile,
  writeTextFileIn,
} from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { MOVE_REVIEW_WRITING, MoveReviewAnswer, moveReviewMessage } from "../../prompts/index.ts";
import { firstWithRoom, modelsOnOffer, type Provider } from "../../providers/index.ts";
import { parseContextFile, plansLines, removeContextLine } from "../context-file/index.ts";
import type { ContextFolder } from "../context-folder/index.ts";
import { DOCS_FOLDER, documentPath, listDocuments, nameOf } from "../documents/index.ts";
import { planningChange, planningFolder, slugFor } from "../planning-files/index.ts";
import { projectPath, projectText, readProjects, readProjectText } from "../projects/index.ts";
import { editSteps } from "../projects/steps.ts";
import {
  historyDate,
  photoName,
  readThings,
  readThingText,
  THINGS_FOLDER,
  thingPath,
  thingText,
} from "../things/index.ts";
import { CONTEXT_FILE, getWorkspace, listWorkspaces } from "../workspaces/index.ts";

/**
 * The move review (#603, ADR 0032): once, a planning workspace's guides, Plans and Ideas lines and
 * wanted Things are proposed moves into what it keeps now, written by a model the first time the
 * workspace has any of them, kept in the data folder until the owner ticks them on Home. Each
 * ticked move is one change with Undo; nothing moves unticked, and once done it's never proposed
 * again.
 */

/** The folder in the data folder that keeps each workspace's review, a file each. */
const REVIEWS_FOLDER = "move-reviews";

/** How long the model may take over a review: it may write a guide or two again. */
const WRITING_TIMEOUT_MS = 5 * 60 * 1000;

/** How long after a review couldn't be written it's asked for again. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/** The folder in `docs` an archived document goes to, out of the list and out of the way. */
export const ARCHIVE_FOLDER = "archive";

/** A workspace's review as kept: its moves while they wait on the owner, or done. */
const KeptReview = z.discriminatedUnion("state", [
  z.object({ state: z.literal("proposed"), at: z.iso.datetime(), moves: z.array(Move).min(1) }),
  z.object({ state: z.literal("done"), at: z.iso.datetime() }),
]);
type KeptReview = z.infer<typeof KeptReview>;

/** Where a review reads, writes and asks. */
export type MoveReviewsTarget = {
  readonly contextDir: string;
  readonly dataDir: string;
  readonly contextFolder: ContextFolder;
  readonly providers: readonly Provider[];
  readonly now: () => number;
  /** Runs work nobody waits for: a review being written. */
  readonly background: (work: Promise<void>) => void;
};

/** A move the model answered, as Courtyard keeps it, or `undefined` for one that doesn't fit. */
const keptMove = (answered: MoveReviewAnswer["moves"][number]): Move | undefined => {
  const { project, upcoming } = answered;
  const parsed = Move.safeParse({
    title: answered.title,
    about: answered.about,
    ...(project === null
      ? {}
      : {
          project: {
            ...(project.slug === null ? {} : { slug: project.slug }),
            ...(project.name === null ? {} : { name: project.name }),
            ...(project.goal === null ? {} : { goal: project.goal }),
            steps: project.steps.map(({ who, text, detail }) => ({
              who,
              text,
              ...(detail === null ? {} : { detail }),
            })),
          },
        }),
    documents: answered.documents,
    archive: answered.archive,
    upcoming: upcoming.map(({ part, name, price, shop, link, why }) => ({
      part,
      name,
      ...(price === null ? {} : { price }),
      ...(shop === null ? {} : { shop }),
      ...(link === null ? {} : { link }),
      ...(why === null ? {} : { why }),
    })),
    remove: answered.remove,
  });
  return parsed.success ? parsed.data : undefined;
};

/** A move's files as a change: each path in the workspace's folder, its new text or `null` to remove it. */
type Writes = Map<string, string | null>;

/** Why a ticked move couldn't be made, in the owner's words. */
type MoveProblem = { readonly problem: string };

export const createMoveReviews = (target: MoveReviewsTarget) => {
  const fileOf = (workspaceId: WorkspaceId) =>
    join(target.dataDir, REVIEWS_FOLDER, `${workspaceId}.json`);
  const keptOf = async (workspaceId: WorkspaceId) => {
    const kept = await readJsonFile(fileOf(workspaceId), KeptReview);
    return kept.ok ? kept.value : undefined;
  };
  const keep = async (workspaceId: WorkspaceId, review: KeptReview) => {
    await mkdir(join(target.dataDir, REVIEWS_FOLDER), { recursive: true }).catch(() => undefined);
    return writeJsonFile(fileOf(workspaceId), review);
  };

  /** Each review being written now, by workspace, so one is written once at a time. */
  const writing = new Map<WorkspaceId, Promise<void>>();
  /** When writing each workspace's review last failed, so it isn't asked again straight away. */
  const failedAt = new Map<WorkspaceId, number>();

  /** The workspace as the review's model is given it, or `undefined` when it has nothing to move. */
  const toMove = async (workspaceId: WorkspaceId) => {
    const where = { contextDir: target.contextDir, workspaceId };
    const workspace = await getWorkspace(target.contextDir, workspaceId);
    if (!workspace.ok || workspace.value.summary.mode !== "planning") return undefined;
    const [listed, things, projects] = await Promise.all([
      listDocuments(where),
      readThings(where),
      readProjects(where),
    ]);
    if (!listed.ok || !things.ok || !projects.ok) return undefined;
    const markdown = workspace.value.contextMarkdown;
    const lines =
      markdown === null ? 0 : plansLines(markdown).length + parseContextFile(markdown).ideas.length;
    const wanted = things.value.things.some(({ summary }) => summary.status === "want");
    if (lines === 0 && listed.value.length === 0 && !wanted) return undefined;
    const documents = [];
    for (const { slug } of listed.value) {
      const text = await readTextFile(join(workspace.value.folder, documentPath(slug)));
      if (!text.ok) return undefined;
      if (text.value !== undefined) documents.push({ path: documentPath(slug), text: text.value });
    }
    return {
      name: workspace.value.summary.name,
      contextFile: markdown,
      documents,
      things: things.value,
      projects: projects.value,
    };
  };

  /**
   * Writes the workspace's review, unless it has one or has nothing to move: one question to the
   * first model with room, at its default effort. Moves that don't fit are left out; with none
   * left, the review is done.
   */
  const write = async (workspaceId: WorkspaceId) => {
    if ((await keptOf(workspaceId)) !== undefined) return;
    const workspace = await toMove(workspaceId);
    if (workspace === undefined) return;
    const chosen = firstWithRoom(await modelsOnOffer(target.providers));
    if (chosen === undefined) return;
    const answered = await chosen.provider.answerOnce({
      purpose: "move-review",
      model: chosen.model.id,
      instructions: MOVE_REVIEW_WRITING,
      message: moveReviewMessage({ now: target.now(), workspace }),
      schema: MoveReviewAnswer,
      signal: AbortSignal.timeout(WRITING_TIMEOUT_MS),
    });
    const parsed = answered.ok ? MoveReviewAnswer.safeParse(answered.value) : undefined;
    if (parsed === undefined || !parsed.success) {
      failedAt.set(workspaceId, target.now());
      return;
    }
    const moves = parsed.data.moves.flatMap((move) => keptMove(move) ?? []).slice(0, MOVES_MAX);
    const at = new Date(target.now()).toISOString();
    await keep(
      workspaceId,
      moves.length === 0 ? { state: "done", at } : { state: "proposed", at, moves },
    );
  };

  /** Starts writing the workspace's review, unless it's being written or failed lately. */
  const ask = (workspaceId: WorkspaceId) => {
    if (writing.has(workspaceId)) return writing.get(workspaceId) ?? Promise.resolve();
    const failed = failedAt.get(workspaceId);
    if (failed !== undefined && target.now() - failed < RETRY_AFTER_MS) return Promise.resolve();
    const work = write(workspaceId)
      .catch(() => {
        failedAt.set(workspaceId, target.now());
      })
      .finally(() => writing.delete(workspaceId));
    writing.set(workspaceId, work);
    return work;
  };

  /**
   * Makes one move as one change: checks everything it names is still there, then writes and
   * removes its files. Refused, in the owner's words, when something it names has gone.
   */
  const make = async (workspaceId: WorkspaceId, move: Move) => {
    const where = { ...target, workspaceId };
    const paths: string[] = [];
    const made = await target.contextFolder.change(
      async (): Promise<Result<null, MoveProblem>> => {
        const folder = await planningFolder(where);
        if (!folder.ok) return err({ problem: "The workspace can't be read just now." });
        const inFolder = (path: string) => join(folder.value, path);
        const read = async (path: string) => {
          const text = await readTextFile(inFolder(path));
          return text.ok ? text.value : undefined;
        };
        const writes: Writes = new Map();
        const today = historyDate(target.now());

        if (move.project !== undefined) {
          const { slug, name, goal, steps: added } = move.project;
          const text = slug === undefined ? undefined : await read(projectPath(slug));
          const was = text === undefined ? undefined : readProjectText(text);
          const steps = editSteps(was?.ok ? was.value.steps : [], { addSteps: added }, today);
          if (!steps.ok) return err({ problem: "These steps don't fit the project." });
          if (slug !== undefined) {
            if (!was?.ok) return err({ problem: `The project ${slug} isn't there any more.` });
            writes.set(projectPath(slug), projectText({ ...was.value, steps: steps.value.steps }));
          } else if (name !== undefined) {
            const named = slugFor(name, { slug: ProjectSlug, kind: "project" });
            if (named === undefined || (await read(projectPath(named))) !== undefined) {
              return err({ problem: `There's a project called ${name} already.` });
            }
            writes.set(
              projectPath(named),
              projectText({
                fields: { name, ...(goal === undefined ? {} : { goal }), status: "active" },
                steps: steps.value.steps,
                decisions: [],
                history: [{ date: today, text: `Started from ${move.title}` }],
              }),
            );
          }
        }

        for (const { slug, text } of move.documents) {
          if ((await read(documentPath(slug))) === undefined) {
            return err({ problem: `The document ${slug} isn't there any more.` });
          }
          if (nameOf(text) === undefined) {
            return err({
              problem: `The new ${slug} has no name: its first line isn't a # heading.`,
            });
          }
          writes.set(documentPath(slug), `${text.trimEnd()}\n`);
        }

        for (const slug of move.archive) {
          const text = await read(documentPath(slug));
          const archived = `${DOCS_FOLDER}/${ARCHIVE_FOLDER}/${slug}.md`;
          if (text === undefined) {
            return err({ problem: `The document ${slug} isn't there any more.` });
          }
          if ((await read(archived)) !== undefined) {
            return err({ problem: `The archive has a ${slug} already.` });
          }
          writes.set(archived, text);
          writes.set(documentPath(slug), null);
        }

        for (const { part, ...upcoming } of move.upcoming) {
          const text = await read(thingPath(part));
          const was = text === undefined ? undefined : readThingText(text);
          if (was === undefined || !was.ok) {
            return err({ problem: `The part ${part} isn't there any more.` });
          }
          const fields = ThingFields.safeParse({
            ...was.value.fields,
            status: was.value.fields.status === "have" ? "replace" : was.value.fields.status,
            upcoming: upcoming.name,
            upcomingPrice: upcoming.price,
            upcomingShop: upcoming.shop,
            upcomingLink: upcoming.link,
            upcomingWhy: upcoming.why,
          });
          if (!fields.success) return err({ problem: `${upcoming.name} doesn't fit as upcoming.` });
          writes.set(
            thingPath(part),
            thingText(fields.data, [
              ...was.value.history,
              { date: today, text: `Picked ${upcoming.name} as upcoming` },
            ]),
          );
        }

        for (const slug of move.remove.documents) {
          if (writes.has(documentPath(slug))) continue;
          if ((await read(documentPath(slug))) === undefined) {
            return err({ problem: `The document ${slug} isn't there any more.` });
          }
          writes.set(documentPath(slug), null);
        }
        for (const slug of move.remove.things) {
          const text = await read(thingPath(slug));
          const was = text === undefined ? undefined : readThingText(text);
          if (was === undefined || !was.ok) {
            return err({ problem: `The Thing ${slug} isn't there any more.` });
          }
          writes.set(thingPath(slug), null);
          if (was.value.fields.photo !== undefined) {
            writes.set(`${THINGS_FOLDER}/${photoName(slug)}`, null);
          }
        }
        if (move.remove.lines.length > 0) {
          let markdown = await read(CONTEXT_FILE);
          for (const line of move.remove.lines) {
            const without =
              markdown === undefined
                ? undefined
                : (removeContextLine(markdown, { place: "workspace", section: "plans", line }) ??
                  removeContextLine(markdown, { place: "workspace", section: "ideas", line }));
            if (without === undefined) {
              return err({ problem: `"${line}" isn't in the context file any more.` });
            }
            markdown = without;
          }
          if (markdown !== undefined) writes.set(CONTEXT_FILE, markdown);
        }

        for (const [path, text] of writes) {
          const done =
            text === null
              ? await removeFile(inFolder(path))
              : await writeTextFileIn(inFolder(path), text);
          if (!done) return err({ problem: "The workspace's files couldn't be written just now." });
          paths.push(path);
        }
        return ok(null);
      },
      () => planningChange(where, { kind: "move", title: `Move: ${move.title}`, paths }),
    );
    return made;
  };

  return {
    /**
     * The workspace's review while it waits on the owner, for Home, or `null`. With none kept yet,
     * one is asked for, nobody waiting, for Home's next look.
     */
    shown: async (workspaceId: WorkspaceId): Promise<MoveReview | null> => {
      const kept = await keptOf(workspaceId);
      if (kept === undefined) {
        target.background(ask(workspaceId));
        return null;
      }
      return kept.state === "done"
        ? null
        : { moves: kept.moves.map(({ title, about }, id) => ({ id, title, about })) };
    },

    /** Asks for each planning workspace's review that hasn't got one: at start, and now and then. */
    writeDue: async () => {
      const workspaces = await listWorkspaces(target.contextDir);
      if (!workspaces.ok) return;
      for (const { id, mode } of workspaces.value) {
        if (mode === "planning") await ask(id);
      }
    },

    /** Waits for the reviews being written now: for tests, which write one then look. */
    settled: async () => {
      await Promise.all(writing.values());
    },

    /**
     * Makes the moves the owner ticked, by number, in order, each one change; the rest are left as
     * they are. The review is done, unless a move couldn't be made: those wait on the owner again.
     */
    move: async (
      workspaceId: WorkspaceId,
      ticked: readonly number[],
    ): Promise<Result<MovesMade, "no-review" | "storage">> => {
      const kept = await keptOf(workspaceId);
      if (kept === undefined || kept.state !== "proposed") return err("no-review");
      const moved: MovesMade["moved"] = [];
      const left: MovesMade["left"] = [];
      const leftMoves: Move[] = [];
      for (const [id, move] of kept.moves.entries()) {
        if (!ticked.includes(id)) continue;
        const made = await make(workspaceId, move);
        if (made.ok) moved.push({ title: move.title });
        else {
          left.push({ title: move.title, problem: made.error.problem });
          leftMoves.push(move);
        }
      }
      const at = new Date(target.now()).toISOString();
      const done = await keep(
        workspaceId,
        leftMoves.length === 0
          ? { state: "done", at }
          : { state: "proposed", at, moves: leftMoves },
      );
      return done.ok ? ok({ moved, left }) : err("storage");
    },
  };
};

export type MoveReviews = ReturnType<typeof createMoveReviews>;
