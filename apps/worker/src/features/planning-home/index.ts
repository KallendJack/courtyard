import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type HomeView,
  HomeViewId,
  type PinnedPart,
  type PlanningHome,
  type ThingSlug,
  type ThingSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";

/**
 * A planning workspace's Home (#208): the views it can show, each filled from the workspace's
 * Things, which one shows, and its photo. Decided here, once, for every screen.
 */

/** A Thing's photo view's id. */
const pictureOf = (slug: ThingSlug) => HomeViewId.parse(`picture:${slug}`);

/** Whether a Thing needs something: to get, to replace, or a next step. */
const needsSomething = (thing: ThingSummary) =>
  thing.status !== "have" || thing.needs !== undefined;

/** The latest of some times, as ISO strings compare. */
const latest = (times: readonly string[]) =>
  times.reduce((last, time) => (time > last ? time : last), "");

const partOn = (part: ThingSummary): PinnedPart => ({
  thing: part.slug,
  name: part.name,
  status: part.status,
  ...(part.needs === undefined ? {} : { needs: part.needs }),
  pin: part.pin,
  flagged: needsSomething(part),
});

/** Each Thing that isn't a part, with its parts, in list order. */
const withParts = (things: readonly ThingSummary[]) => {
  const slugs = new Set(things.map(({ slug }) => slug));
  return things
    .filter(({ partOf }) => partOf === undefined || !slugs.has(partOf))
    .map((top) => ({ top, parts: things.filter(({ partOf }) => partOf === top.slug) }));
};

/**
 * Home's views from a workspace's Things and its saved floor plans, in list order: each Thing with
 * a photo and parts, broken down into every part, those that need something first; then each
 * room's plan, newest first. The wanted list is the Things tab's (#565).
 */
export const homeViews = (
  things: readonly ThingSummary[],
  plans: readonly HomeView[] = [],
): HomeView[] => {
  const pictures = withParts(things).flatMap(({ top, parts }): HomeView[] =>
    top.photo && parts.length > 0
      ? [
          {
            kind: "picture",
            id: pictureOf(top.slug),
            title: top.name,
            changedAt: latest([top, ...parts].map(({ updatedAt }) => updatedAt)),
            thing: top.slug,
            parts: [
              ...parts.filter(needsSomething),
              ...parts.filter((one) => !needsSomething(one)),
            ].map(partOn),
          },
        ]
      : [],
  );
  return [...pictures, ...plans];
};

/** The workspace's photo: its main Thing's, the one with a photo and the most parts. */
const mainPhoto = (things: readonly ThingSummary[]) =>
  withParts(things)
    .filter(({ top }) => top.photo)
    .reduce<{ top: ThingSummary; parts: readonly ThingSummary[] } | undefined>(
      (main, one) => (main === undefined || one.parts.length > main.parts.length ? one : main),
      undefined,
    )?.top.slug ?? null;

/** Home without its question and projects: its views, the one showing, and its photo. */
export const homeOf = (
  things: readonly ThingSummary[],
  pick: HomeViewId | undefined,
  /** Its saved floor plans' views (#257). */
  plans: readonly HomeView[] = [],
): Omit<PlanningHome, "question" | "projects"> => {
  const views = homeViews(things, plans);
  const picked = views.find(({ id }) => id === pick);
  const lastChanged = views.reduce<HomeView | undefined>(
    (last, view) => (last === undefined || view.changedAt > last.changedAt ? view : last),
    undefined,
  );
  return {
    views,
    showing: (picked ?? lastChanged)?.id ?? null,
    picked: picked !== undefined,
    photo: mainPhoto(things),
  };
};

const KeptPick = z.object({ view: HomeViewId });

/**
 * The owner's pick of each planning workspace's view, kept in the data folder (it's Courtyard's
 * own state, not the workspace's): `planning-home/<workspace>.json`.
 */
export const createHomePicks = (options: { dataDir: string }) => {
  const folder = join(options.dataDir, "planning-home");
  const fileOf = (workspaceId: WorkspaceId) => join(folder, `${workspaceId}.json`);
  return {
    /** The view the owner last picked, if any. */
    of: async (workspaceId: WorkspaceId): Promise<HomeViewId | undefined> => {
      const kept = await readJsonFile(fileOf(workspaceId), KeptPick);
      return kept.ok ? kept.value?.view : undefined;
    },
    /** Keeps the owner's pick. */
    pick: async (workspaceId: WorkspaceId, view: HomeViewId): Promise<Result<null, "storage">> => {
      try {
        await mkdir(folder, { recursive: true });
      } catch {
        return err("storage");
      }
      const written = await writeJsonFile(fileOf(workspaceId), { view });
      return written.ok ? ok(null) : err("storage");
    },
  };
};

export type HomePicks = ReturnType<typeof createHomePicks>;
