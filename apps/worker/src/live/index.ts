import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { type LiveStatus, LiveUpdateResult, type LiveVersion } from "@courtyard/contract";
import { readTextFile } from "../files.ts";
import { gitOrNothing } from "../git.ts";
import { err, ok, type Result } from "../result.ts";

/** How often the worker asks the live copy's remote whether main has moved on. */
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
/** After the remote couldn't be reached, how soon to ask again. */
const RECHECK_AFTER_FAILURE_MS = 5 * 60 * 1000;
/**
 * An update still "running" after this long ended without saying how it went. Longer than the
 * update task's own 30-minute limit (install-task.ps1), so a slow update is never cut short.
 */
const UPDATE_GIVES_UP_MS = 35 * 60 * 1000;

/** What starts an update: the scheduled task that runs scripts/live/update.ps1. */
export type UpdateCommand = { readonly task: string };

/** Why an update couldn't start. */
export type LiveError =
  | { readonly kind: "off" }
  | { readonly kind: "running" }
  | { readonly kind: "not-started"; readonly message: string };

export type Live = {
  /** What the live copy runs, whether main is newer, and how the last update went. */
  status(): Promise<LiveStatus>;
  /** Starts an update on its own; how it went shows in a later status. */
  update(): Promise<Result<null, LiveError>>;
};

const run = promisify(execFile);

/**
 * Asks Task Scheduler to run the update task. Task Scheduler starts it, not the worker, so it
 * carries on while the worker it updates shuts down (ADR 0011). Windows PowerShell started
 * straight from the worker, with no console of its own, quits before it begins.
 */
export const runUpdateTask = async (command: UpdateCommand) => {
  await run("schtasks.exe", ["/run", "/tn", command.task], { windowsHide: true });
};

/** Updating the live copy from the app, or "off" when this worker isn't running from one. */
export const createLive = (options: {
  /** The live copy this worker runs from, if it does. */
  liveCopy: string | null;
  /** The scheduled task that updates it. */
  updateTask: string;
  dataDir: string;
  now: () => number;
  startUpdate: (command: UpdateCommand) => void | Promise<void>;
}): Live => {
  const { liveCopy, updateTask, dataDir, now } = options;
  if (liveCopy === null) {
    return {
      status: async () => ({ kind: "off" }),
      update: async () => err({ kind: "off" }),
    };
  }

  const git = (...args: string[]) => gitOrNothing(liveCopy, args);
  const resultFile = join(dataDir, "live-update.json");
  /** The last answer from the remote, and when to ask again. */
  let check: { readonly newest: Promise<string | undefined>; readonly until: number } | undefined;

  const versionOf = async (ref: string): Promise<LiveVersion | null> => {
    const [commit, title] = await Promise.all([
      git("rev-parse", ref),
      git("log", "-1", "--format=%h %s", ref),
    ]);
    return commit && title ? { commit, title } : null;
  };

  const fetchNewest = async () => {
    const fetched = await git("fetch", "--quiet", "origin", "main");
    return fetched === undefined ? undefined : git("rev-parse", "origin/main");
  };

  /**
   * Main's newest commit, asking the remote at most every few hours, or again in a few minutes
   * when it couldn't be reached. Pages loading at once share one question.
   */
  const newestOnMain = () => {
    if (check === undefined || now() >= check.until) {
      const newest = fetchNewest();
      const asked = now();
      check = { newest, until: asked + RECHECK_AFTER_FAILURE_MS };
      void newest.then((commit) => {
        if (commit !== undefined && check?.newest === newest) {
          check = { newest, until: asked + CHECK_EVERY_MS };
        }
      });
    }
    return check.newest;
  };

  const lastUpdate = async (): Promise<Result<LiveUpdateResult | null, LiveError>> => {
    const text = await readTextFile(resultFile);
    if (!text.ok) return err({ kind: "not-started", message: "live-update.json can't be read." });
    if (text.value === undefined) return ok(null);
    let json: unknown;
    try {
      json = JSON.parse(text.value.replace(/^﻿/, ""));
    } catch {
      // Half written, or edited by hand: no result to show, and nothing to stop an update.
      return ok(null);
    }
    const parsed = LiveUpdateResult.safeParse(json);
    if (!parsed.success) return ok(null);
    const result = parsed.data;
    const gaveUpAt = Date.parse(result.startedAt) + UPDATE_GIVES_UP_MS;
    if (result.outcome !== "running" || now() < gaveUpAt) return ok(result);
    return ok({
      ...result,
      outcome: "failed",
      message:
        "The update ended without saying how it went. See live-update.log in the data folder.",
      finishedAt: new Date(gaveUpAt).toISOString(),
    });
  };

  return {
    status: async () => {
      const [running, newestCommit, last] = await Promise.all([
        versionOf("HEAD"),
        newestOnMain(),
        lastUpdate(),
      ]);
      if (running === null) return { kind: "off" };
      const newest = newestCommit === undefined ? null : await versionOf(newestCommit);
      return {
        kind: "live",
        running,
        newest,
        newerOnMain: newest !== null && newest.commit !== running.commit,
        lastUpdate: last.ok ? last.value : null,
      };
    },
    update: async () => {
      const last = await lastUpdate();
      if (!last.ok) return last;
      if (last.value?.outcome === "running") return err({ kind: "running" });
      try {
        await options.startUpdate({ task: updateTask });
      } catch {
        return err({
          kind: "not-started",
          message: `The update couldn't be started. Run install-task.ps1 again to set up the '${updateTask}' task.`,
        });
      }
      return ok(null);
    },
  };
};
