import { join } from "node:path";
import type { FreshStartSummary, RunningTurn, SessionSummary } from "@courtyard/contract";
import type { ContextFolder } from "../context-folder/index.ts";
import { listFolder } from "../files.ts";
import { err, ok, type Result } from "../result.ts";
import type { Sessions } from "../sessions/index.ts";
import type { Tidying } from "../tidy/index.ts";
import { countWorkspaces, getWorkspace } from "../workspaces/index.ts";

/**
 * Fresh start (spec stories 105-107): clears everything from trying Courtyard out, so it starts as
 * on its first run. The context folder is cleared by one change, so its history keeps every file;
 * the sessions move to a dated folder in the data folder; tidies waiting for review are dropped.
 * The owner's login, sign-ins and the usage limits remembered stay.
 */

export type FreshStartTarget = {
  readonly contextDir: string;
  readonly dataDir: string;
  readonly contextFolder: ContextFolder;
  readonly sessions: Sessions;
  readonly tidying: Tidying;
  readonly now: () => number;
};

/** Why a fresh start didn't happen, or didn't finish. */
export type FreshStartError =
  /** A turn is running in this session. Nothing was cleared. */
  | { readonly kind: "running"; readonly session: RunningTurn }
  /** Another fresh start is under way. */
  | { readonly kind: "underway" }
  /** Git can't keep a change right now, so nothing was cleared. */
  | { readonly kind: "not-kept" }
  | { readonly kind: "storage"; readonly message: string };

/** Why the context folder wasn't cleared, leaving everything as it was. */
type NotCleared = Extract<FreshStartError, { kind: "not-kept" | "storage" }>;

/** Where, in the data folder, the sessions of each fresh start go. */
const FRESH_STARTS_FOLDER = "fresh-starts";

/** A day as the worker machine's calendar has it: `2026-10-08`. */
const dayOf = (now: number) => {
  const date = new Date(now);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

const SESSIONS_UNREADABLE = "The sessions in Courtyard's data folder can't be read or moved.";

/** A running session as the page names it: its title and its workspace's name. */
const named = async (contextDir: string, session: SessionSummary): Promise<RunningTurn> => {
  const workspace = await getWorkspace(contextDir, session.workspaceId);
  return {
    id: session.id,
    title: session.title,
    workspaceId: session.workspaceId,
    workspaceName: workspace.ok ? workspace.value.summary.name : session.workspaceId,
  };
};

export const createFreshStart = (target: FreshStartTarget) => {
  /**
   * The folder, from the data folder's top, that a fresh start now moves the sessions to: the
   * day's, then `-2`, `-3` and so on for more the same day.
   */
  const folderNow = async (): Promise<Result<string, string>> => {
    const day = dayOf(target.now());
    const taken = await listFolder(join(target.dataDir, FRESH_STARTS_FOLDER));
    if (!taken.ok) return err(SESSIONS_UNREADABLE);
    for (let count = 1; ; count += 1) {
      const name = count === 1 ? day : `${day}-${count}`;
      if (!taken.value.includes(name)) return ok(`${FRESH_STARTS_FOLDER}/${name}`);
    }
  };

  return {
    /** What a fresh start would clear now, and whether a running turn stops it. */
    summary: async (): Promise<Result<FreshStartSummary, string>> => {
      const [workspaces, sessions, busy, folder] = await Promise.all([
        countWorkspaces(target.contextDir),
        target.sessions.count(),
        target.sessions.busy(),
        folderNow(),
      ]);
      if (!workspaces.ok) return err("The context folder can't be read.");
      if (!sessions.ok || !busy.ok) return err(SESSIONS_UNREADABLE);
      if (!folder.ok) return folder;
      return ok({
        workspaces: workspaces.value,
        sessions: sessions.value,
        tidies: target.tidying.waiting(),
        running: busy.value === undefined ? null : await named(target.contextDir, busy.value),
        folder: folder.value,
      });
    },

    /** Starts fresh, unless a turn is running. */
    start: async (): Promise<Result<null, FreshStartError>> => {
      const done = await target.sessions.setAside({
        // Where the sessions go is settled here, once nothing else can start fresh.
        clear: async (): Promise<Result<{ moveTo: string }, NotCleared>> => {
          const folder = await folderNow();
          if (!folder.ok) return err({ kind: "storage", message: folder.error });
          const cleared = await target.contextFolder.freshStart();
          if (!cleared.ok) {
            return cleared.error.kind === "not-kept"
              ? err({ kind: "not-kept" })
              : err({
                  kind: "storage",
                  message: "The context folder couldn't be cleared, so nothing was.",
                });
          }
          target.tidying.dropAll();
          return ok({ moveTo: join(target.dataDir, folder.value) });
        },
      });
      if (done.ok) return ok(null);
      const refusal = done.error;
      switch (refusal.kind) {
        case "running":
          return err({ kind: "running", session: await named(target.contextDir, refusal.session) });
        case "starting-fresh":
          return err({ kind: "underway" });
        case "unreadable":
          return err({ kind: "storage", message: SESSIONS_UNREADABLE });
        case "not-moved":
          return err({
            kind: "storage",
            message:
              "The workspaces and owner context are cleared, but the sessions couldn't be moved. Start fresh again to move them.",
          });
        case "not-kept":
        case "storage":
          return err(refusal);
      }
    },
  };
};

export type FreshStart = ReturnType<typeof createFreshStart>;
