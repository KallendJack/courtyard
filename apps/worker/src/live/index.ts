import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type LiveStatus,
  type LiveUpdateRequest,
  LiveUpdateResult,
  type LiveVersion,
  type MainBuild,
  type SessionSummary,
  type UpdateWaiting,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, readTextFile, removeFile, writeJsonFile } from "../files.ts";
import { commitTitle, gitOrNothing } from "../git.ts";
import { err, ok, type Result } from "../result.ts";

/**
 * How long an answer from the live copy's remote is reused. The worker only asks when a page asks
 * for the live status, so a merge on GitHub shows the next time a page asks after this; one made
 * from the app drops it (`forget`), so it shows at once (#387).
 */
const ANSWER_REUSED_FOR_MS = 60 * 1000;
/**
 * After the remote couldn't be reached, how soon to ask again: longer than an answer is reused,
 * so a worker that's offline doesn't try a fetch every time the home page opens.
 */
const RECHECK_AFTER_FAILURE_MS = 5 * 60 * 1000;
/**
 * How long an answer about main's build is reused while it runs (#249). A page showing it asks
 * every 10 seconds (#337), so GitHub is asked about that often, and only while someone looks.
 */
const BUILD_RUNNING_REUSED_FOR_MS = 8 * 1000;
/** How many of main's earlier builds say how long each job usually takes (#337). */
const EARLIER_BUILDS = 10;
/** How long an answer about main's build is reused once it has finished, or couldn't be had. */
const BUILD_REUSED_FOR_MS = 60 * 1000;
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

/**
 * The Update waiting to run (#186), kept in the data folder so it outlives a crash: waiting, or
 * dropped because main's build on `commit` failed meanwhile, with that build's log.
 */
const WaitingFile = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("waiting"), since: z.iso.datetime() }),
  z.object({ kind: z.literal("dropped"), commit: z.string(), details: z.string() }),
]);
type WaitingFile = z.infer<typeof WaitingFile>;

/** The worker started an update itself (#186), at this time: the turns it cuts off carry on. */
const RestartFile = z.object({ at: z.iso.datetime() });

/** A session with a turn running, and whether it waits on the owner's OK (#186). */
export type MidTurn = { readonly session: SessionSummary; readonly needsYou: boolean };

export type Live = {
  /** What the live copy runs, whether main is newer, how the last update went, and what waits. */
  status(): Promise<LiveStatus>;
  /**
   * Update (#186): at once when main's build has passed and no session is mid-turn, or with
   * `now`; otherwise it waits, and `watch` runs it once both are clear. Says whether it waits.
   */
  update(request?: LiveUpdateRequest): Promise<Result<{ waits: boolean }, LiveError>>;
  /** Drops the Update waiting (#186), if one is. */
  cancel(): Promise<void>;
  /** For the worker's repeating jobs (#186): runs the waiting Update once it can, or drops it. */
  watch(): Promise<void>;
  /** Whether an Update waits to run (#186): meanwhile nothing new starts on its own. */
  holding(): boolean;
  /**
   * Whether this worker's start follows an update the worker started itself (#186), so the turns
   * it cut off carry on. Asked once, as the worker starts.
   */
  restartedByUpdate(): Promise<boolean>;
  /** Drops the answers reused from the remote and GitHub, once main has moved on (#387). */
  forget(): void;
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
  /** The sessions with a turn running now (#186), which a waiting Update waits for. */
  midTurn?: () => Promise<readonly MidTurn[]>;
  /** An Update no longer waits without having run (#186): what held meanwhile can go. */
  released?: () => void;
  /**
   * Main's build on `commit` (#249), with main's commits before it, newest first, to judge how
   * long each job takes (#337); `null` when GitHub can't be asked.
   */
  buildOf?: (find: { commit: string; earlier: readonly string[] }) => Promise<MainBuild | null>;
}): Live => {
  const { liveCopy, updateTask, dataDir, now } = options;
  if (liveCopy === null) {
    return {
      status: async () => ({ kind: "off" }),
      update: async () => err({ kind: "off" }),
      cancel: async () => {},
      watch: async () => {},
      holding: () => false,
      restartedByUpdate: async () => false,
      forget: () => {},
    };
  }

  const git = (...args: string[]) => gitOrNothing(liveCopy, args);
  const resultFile = join(dataDir, "live-update.json");
  const waitingFile = join(dataDir, "live-update-waiting.json");
  const restartFile = join(dataDir, "live-update-restart.json");
  /** The Update waiting, as last read or written; read from its file as the worker starts. */
  let waiting: WaitingFile | undefined;
  const loaded = readJsonFile(waitingFile, WaitingFile).then((read) => {
    waiting = read.ok ? read.value : undefined;
  });
  const keepWaiting = async (now: WaitingFile | undefined) => {
    const was = waiting?.kind === "waiting";
    waiting = now;
    if (now === undefined) {
      await removeFile(waitingFile);
    } else {
      await mkdir(dataDir, { recursive: true });
      const written = await writeJsonFile(waitingFile, now);
      if (!written.ok) console.error("The waiting Update couldn't be kept in the data folder");
    }
    if (was && now?.kind !== "waiting") options.released?.();
  };
  /** The last answer from the remote, and when to ask again. */
  let check: { readonly newest: Promise<string | undefined>; readonly until: number } | undefined;

  const versionOf = async (ref: string): Promise<LiveVersion | null> => {
    const [commit, read] = await Promise.all([
      git("rev-parse", ref),
      git("log", "-1", "--format=%h%x1f%s%x1f%b", ref),
    ]);
    if (!commit || !read) return null;
    const [short = "", subject = "", body = ""] = read.split("\x1f");
    return { commit, title: commitTitle({ short, subject, body }) };
  };

  const fetchNewest = async () => {
    const fetched = await git("fetch", "--quiet", "origin", "main");
    return fetched === undefined ? undefined : git("rev-parse", "origin/main");
  };

  /**
   * Main's newest commit, asking the remote at most once a minute, or again in a few minutes
   * when it couldn't be reached. Pages loading at once share one question.
   */
  const newestOnMain = () => {
    if (check === undefined || now() >= check.until) {
      const newest = fetchNewest();
      const asked = now();
      check = { newest, until: asked + RECHECK_AFTER_FAILURE_MS };
      void newest.then((commit) => {
        if (commit !== undefined && check?.newest === newest) {
          check = { newest, until: asked + ANSWER_REUSED_FOR_MS };
        }
      });
    }
    return check.newest;
  };

  /** The last answer about main's build, for which commit, and when to ask again. */
  let build:
    | { readonly commit: string; readonly answer: Promise<MainBuild | null>; until: number }
    | undefined;

  /**
   * Main's build on `commit`, asking GitHub at most every 10 seconds while it runs, and once a
   * minute otherwise. Pages asking at once share one question.
   */
  const buildOn = (commit: string) => {
    const { buildOf } = options;
    if (buildOf === undefined) return Promise.resolve(null);
    if (build === undefined || build.commit !== commit || now() >= build.until) {
      const asked = now();
      const answer = git(
        "rev-list",
        "--first-parent",
        `--max-count=${EARLIER_BUILDS}`,
        `${commit}^`,
      ).then((earlier) =>
        buildOf({ commit, earlier: (earlier ?? "").split("\n").filter((line) => line !== "") }),
      );
      const asking = { commit, answer, until: asked + BUILD_REUSED_FOR_MS };
      build = asking;
      void answer.then((found) => {
        if (found?.kind === "running") asking.until = asked + BUILD_RUNNING_REUSED_FOR_MS;
      });
    }
    return build.answer;
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

  /** Main's newest, whether the live copy is behind it, and its build while it is. */
  const mainNow = async () => {
    const [running, newestCommit] = await Promise.all([versionOf("HEAD"), newestOnMain()]);
    const newest = newestCommit === undefined ? null : await versionOf(newestCommit);
    const newerOnMain = running !== null && newest !== null && newest.commit !== running.commit;
    // Only asked while there's something to update to.
    const build = newerOnMain ? await buildOn(newest.commit) : null;
    return { running, newest, newerOnMain, build };
  };

  /** The sessions mid-turn, as the waiting Update says them (#186). */
  const sessionsWaitedFor = async (): Promise<UpdateWaiting | null> => {
    const busy = (await options.midTurn?.()) ?? [];
    if (busy.length === 0) return null;
    const needYou = busy.filter((each) => each.needsYou);
    const first = needYou[0]?.session;
    return {
      kind: "sessions",
      count: busy.length,
      needYou: needYou.length,
      open: first === undefined ? null : { workspaceId: first.workspaceId, sessionId: first.id },
    };
  };

  /** What the Update waiting waits for now (#186), or `null` when it can run, or none waits. */
  const waitingNow = async (main: {
    newest: LiveVersion | null;
    build: MainBuild | null;
  }): Promise<UpdateWaiting | null> => {
    await loaded;
    if (waiting?.kind === "dropped") {
      return main.newest?.commit === waiting.commit && main.build?.kind === "failed"
        ? { kind: "dropped", details: waiting.details }
        : null;
    }
    if (waiting === undefined) return null;
    if (main.build?.kind === "running") return { kind: "ci" };
    return sessionsWaitedFor();
  };

  /**
   * When the worker last started an update, until it has finished without a restart (refused,
   * say), when its note that the worker started it goes (#186).
   */
  let startedAt: number | undefined;

  /** Starts the update task, noting that the worker started it, so cut-off turns carry on. */
  const start = async (): Promise<Result<null, LiveError>> => {
    await mkdir(dataDir, { recursive: true });
    await writeJsonFile(restartFile, { at: new Date(now()).toISOString() });
    startedAt = now();
    try {
      await options.startUpdate({ task: updateTask });
    } catch {
      startedAt = undefined;
      await removeFile(restartFile);
      return err({
        kind: "not-started",
        message: `The update couldn't be started. Run install-task.ps1 again to set up the '${updateTask}' task.`,
      });
    }
    return ok(null);
  };

  return {
    status: async () => {
      const [main, last] = await Promise.all([mainNow(), lastUpdate()]);
      const { running, newest, newerOnMain, build } = main;
      if (running === null) return { kind: "off" };
      return {
        kind: "live",
        running,
        newest,
        newerOnMain,
        lastUpdate: last.ok ? last.value : null,
        build,
        waiting: await waitingNow(main),
      };
    },
    update: async (request = {}) => {
      const last = await lastUpdate();
      if (!last.ok) return last;
      if (last.value?.outcome === "running") return err({ kind: "running" });
      if (request.now !== true) {
        const main = await mainNow();
        // Main's build still runs, or a session is mid-turn: it waits, and runs itself (#186).
        const waits = main.build?.kind === "running" || (await sessionsWaitedFor()) !== null;
        if (waits) {
          await keepWaiting({ kind: "waiting", since: new Date(now()).toISOString() });
          return ok({ waits: true });
        }
      }
      await loaded;
      if (waiting !== undefined) await keepWaiting(undefined);
      const started = await start();
      return started.ok ? ok({ waits: false }) : started;
    },
    cancel: async () => {
      await loaded;
      if (waiting?.kind === "waiting") await keepWaiting(undefined);
    },
    watch: async () => {
      await loaded;
      if (startedAt !== undefined) {
        // Still here once it has finished, or given up: the worker wasn't restarted.
        const last = await lastUpdate();
        const finished =
          last.ok &&
          last.value !== null &&
          last.value.finishedAt !== null &&
          Date.parse(last.value.finishedAt) >= startedAt;
        if (finished || now() - startedAt > UPDATE_GIVES_UP_MS) {
          startedAt = undefined;
          // A crash after this isn't the update's: its turns wait for Continue.
          await removeFile(restartFile);
        }
      }
      if (waiting === undefined) return;
      const main = await mainNow();
      if (waiting.kind === "dropped") {
        // Main has moved on from the build that failed: nothing more to say.
        if (main.newest?.commit !== waiting.commit) await keepWaiting(undefined);
        return;
      }
      // Updated meanwhile (from the PC, say): nothing left to wait for.
      if (!main.newerOnMain) return keepWaiting(undefined);
      if (main.build?.kind === "failed" && main.newest !== null) {
        return keepWaiting({
          kind: "dropped",
          commit: main.newest.commit,
          details: main.build.details,
        });
      }
      if ((await waitingNow(main)) !== null) return;
      const last = await lastUpdate();
      if (last.ok && last.value?.outcome === "running") return keepWaiting(undefined);
      await keepWaiting(undefined);
      const started = await start();
      if (!started.ok) console.error("The waiting Update couldn't be started", started.error);
    },
    holding: () => waiting?.kind === "waiting",
    restartedByUpdate: async () => {
      const read = await readJsonFile(restartFile, RestartFile);
      await removeFile(restartFile);
      return (
        read.ok &&
        read.value !== undefined &&
        now() - Date.parse(read.value.at) < UPDATE_GIVES_UP_MS
      );
    },
    forget: () => {
      check = undefined;
      build = undefined;
    },
  };
};
