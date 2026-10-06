import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type LiveStatus, LiveUpdateResult, type LiveVersion } from "@courtyard/contract";
import { hasCode } from "../files.ts";
import { err, ok, type Result } from "../result.ts";

/** How often the worker asks the live copy's remote whether main has moved on. */
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
/** An update still "running" after this long has stopped without saying how it went. */
const UPDATE_GIVES_UP_MS = 20 * 60 * 1000;

/**
 * The scheduled task that runs scripts/live/update.ps1, which install-task.ps1 registers next to
 * the worker's own task.
 */
const UPDATE_TASK = "Courtyard update";

/** What starts an update: the scheduled task to run. */
export type UpdateCommand = { readonly task: string };

/** Why an update couldn't start. */
export type LiveError =
  | { readonly kind: "off" }
  | { readonly kind: "running" }
  | { readonly kind: "storage"; readonly message: string };

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

/** Runs git in the live copy, returning what it prints, or nothing if it fails. */
const gitIn =
  (folder: string) =>
  async (...args: string[]): Promise<string | undefined> => {
    try {
      return (await run("git", args, { cwd: folder })).stdout.trim();
    } catch {
      return undefined;
    }
  };

/** Updating the live copy from the app, or "off" when this worker isn't running from one. */
export const createLive = (options: {
  /** The live copy this worker runs from, if it does. */
  liveCopy: string | null;
  dataDir: string;
  now: () => number;
  startUpdate: (command: UpdateCommand) => void | Promise<void>;
}): Live => {
  const { liveCopy, dataDir, now } = options;
  if (liveCopy === null) {
    return {
      status: async () => ({ kind: "off" }),
      update: async () => err({ kind: "off" }),
    };
  }

  const git = gitIn(liveCopy);
  const resultFile = join(dataDir, "live-update.json");
  let lastCheck: { at: number; newest: string | undefined } | undefined;

  const versionOf = async (ref: string): Promise<LiveVersion | null> => {
    const [commit, title] = await Promise.all([
      git("rev-parse", ref),
      git("log", "-1", "--format=%h %s", ref),
    ]);
    return commit && title ? { commit, title } : null;
  };

  /** Main's newest commit, asking the remote at most every few hours. */
  const newestOnMain = async () => {
    if (lastCheck === undefined || now() - lastCheck.at >= CHECK_EVERY_MS) {
      const fetched = await git("fetch", "--quiet", "origin", "main");
      lastCheck = {
        at: now(),
        newest: fetched === undefined ? undefined : await git("rev-parse", "origin/main"),
      };
    }
    return lastCheck.newest;
  };

  const lastUpdate = async (): Promise<LiveUpdateResult | null> => {
    let text: string;
    try {
      text = await readFile(resultFile, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    const parsed = LiveUpdateResult.safeParse(JSON.parse(text.replace(/^﻿/, "")));
    if (!parsed.success) return null;
    const result = parsed.data;
    const stuck =
      result.outcome === "running" && now() - Date.parse(result.startedAt) > UPDATE_GIVES_UP_MS;
    return stuck
      ? {
          ...result,
          outcome: "failed",
          message:
            "The update stopped without saying how it went. See live-update.log in the data folder.",
        }
      : result;
  };

  const readLastUpdate = async (): Promise<Result<LiveUpdateResult | null, LiveError>> => {
    try {
      return ok(await lastUpdate());
    } catch {
      return err({ kind: "storage", message: "live-update.json can't be read." });
    }
  };

  return {
    status: async () => {
      const [running, newestCommit, last] = await Promise.all([
        versionOf("HEAD"),
        newestOnMain(),
        readLastUpdate(),
      ]);
      const newest = newestCommit === undefined ? null : await versionOf(newestCommit);
      if (running === null) return { kind: "off" };
      return {
        kind: "live",
        running,
        newest,
        newerOnMain: newest !== null && newest.commit !== running.commit,
        lastUpdate: last.ok ? last.value : null,
      };
    },
    update: async () => {
      const last = await readLastUpdate();
      if (!last.ok) return last;
      if (last.value?.outcome === "running") return err({ kind: "running" });
      try {
        await options.startUpdate({ task: UPDATE_TASK });
      } catch {
        return err({
          kind: "storage",
          message: `The update couldn't be started. Run install-task.ps1 again to set up the '${UPDATE_TASK}' task.`,
        });
      }
      return ok(null);
    },
  };
};
