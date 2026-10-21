import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BuilderStatus, type FailureReason, PullRequest, SessionId } from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { createOneAtATime } from "../../lib/one-at-a-time.ts";

/**
 * Each Lead builder's status (#590, ADR 0031): one of eight, a recorded fact rather than a guess.
 * `sessions/` tells it what happens in a builder's session as it happens (a turn starting or
 * ending, a check waiting, starting or ending, an approval asked or answered, its pull request
 * heard of), and each moves the status on, kept in the data folder beside `leads.json` with when it
 * began. Nothing re-reads an event log to work it out.
 */

/** How long a builder at the usage limit waits when the limit didn't say when it resets. */
const LIMIT_UNSAID_MS = 60 * 60 * 1000;

/** Where every builder's status is kept, in the data folder. */
const FILE = "builders.json";

/** One builder, as kept. */
const Kept = z.object({
  status: BuilderStatus,
  /** A turn of its is running now. */
  turning: z.boolean(),
  /** Its pull request as last heard of, once it has one. */
  pullRequest: PullRequest.optional(),
  /**
   * It was told to carry on (#590) after its last turn ended with no pull request and no
   * question; ending so again, it's stuck.
   */
  carriedOn: z.boolean(),
  /**
   * A restart cut its last turn off (#610), so it carries on by itself; cut off again before a
   * turn ends otherwise, it's stuck.
   */
  cutOff: z.boolean().default(false),
});
type Kept = z.infer<typeof Kept>;

const BuildersFile = z.object({ builders: z.record(z.string(), Kept) });

/** How a builder's turn ended. */
export type TurnEnding =
  | { readonly kind: "completed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly reason: FailureReason };

/** Something that happened in a builder's session, which may move its status on. */
export type Happening =
  | { readonly kind: "turn-started" }
  /** The owner tapped Retry on it while Stuck (#592): its turn starts afresh, its one carry-on with it. */
  | { readonly kind: "retried" }
  /** A heavy check waits for its place, with this many ahead of it (#281, #306). */
  | { readonly kind: "check-waiting"; readonly command: string; readonly ahead: number }
  | { readonly kind: "check-started"; readonly command: string }
  | { readonly kind: "check-ended"; readonly command: string }
  /** An approval it asked for, by its event number (#171). */
  | { readonly kind: "approval-asked"; readonly approval: number }
  | { readonly kind: "approval-answered"; readonly approval: number }
  | { readonly kind: "pull-request"; readonly pullRequest: PullRequest }
  /**
   * Its turn ended, once what it did to its pull request has been heard: how, and whether its
   * answer ended by asking the owner something.
   */
  | { readonly kind: "turn-ended"; readonly ending: TurnEnding; readonly asked: boolean };

/** Why a builder is stuck, in plain words. */
const STUCK = {
  twice: "It ended two turns in a row with no pull request and no question.",
  cutOffTwice: "A restart cut its turn off twice.",
  stopped: "Its turn was stopped.",
  closed: "Its pull request was closed without merging.",
  failed: (message: string) => `Its turn failed: ${message}`,
} as const;

/** Statuses without their `since`. */
type Unstamped = BuilderStatus extends infer S
  ? S extends unknown
    ? Omit<S, "since">
    : never
  : never;

/** Where a builder with this pull request stands, between turns. */
const fromPullRequest = (pullRequest: PullRequest): Unstamped => {
  const { number } = pullRequest;
  if (pullRequest.state === "merged") return { kind: "merged", pullRequest: number };
  if (pullRequest.state === "closed") return { kind: "stuck", reason: STUCK.closed };
  if (pullRequest.checks.kind === "failed" || pullRequest.conflicts === true) {
    return { kind: "building" };
  }
  return pullRequest.checks.kind === "passed"
    ? { kind: "ready-for-review", pullRequest: number }
    : { kind: "in-ci", pullRequest: number };
};

/**
 * Where a builder whose status was never recorded stands (#635), one started before statuses were
 * kept: as its pull request does, since `since`.
 */
export const statusFromPullRequest = (pullRequest: PullRequest, since: string) => {
  const status = BuilderStatus.safeParse({ ...fromPullRequest(pullRequest), since });
  return status.success ? status.data : undefined;
};

/** Why a turn that failed leaves a builder where it does. */
const fromFailure = (reason: FailureReason): Unstamped => {
  switch (reason.kind) {
    case "rate-limited":
      return {
        kind: "waiting-for-limit",
        ...(reason.resetAt === undefined ? {} : { resetAt: reason.resetAt }),
      };
    case "interrupted":
      // Cut off by a restart: it carries on by itself (`turn-ended`, #610).
      return { kind: "waiting-on-you" };
    case "provider-unavailable":
    case "unknown":
      return { kind: "stuck", reason: STUCK.failed(reason.message) };
  }
};

/**
 * Whether two statuses are the same one going on, which keeps its `since`: the same kind, about
 * the same check, approval or pull request. A check waiting and then running is one check.
 */
const goesOn = (was: BuilderStatus | undefined, now: Unstamped) => {
  if (was === undefined || was.kind !== now.kind) return false;
  switch (now.kind) {
    case "checking":
      return was.kind === "checking" && was.command === now.command;
    case "waiting-on-you":
      return was.kind === "waiting-on-you" && was.approval === now.approval;
    case "in-ci":
    case "ready-for-review":
    case "merged":
      return "pullRequest" in was && was.pullRequest === now.pullRequest;
    case "stuck":
      return was.kind === "stuck" && was.reason === now.reason;
    default:
      return true;
  }
};

/** What a happening makes of a builder, and whether it's to be told to carry on. */
const next = (
  was: Kept | undefined,
  happening: Happening,
): { kept: Omit<Kept, "status"> & { status: Unstamped | undefined }; carryOn: boolean } => {
  const base = {
    turning: was?.turning ?? false,
    ...(was?.pullRequest === undefined ? {} : { pullRequest: was.pullRequest }),
    carriedOn: was?.carriedOn ?? false,
    cutOff: was?.cutOff ?? false,
  };
  const status = was?.status;
  const stays = { kept: { ...base, status }, carryOn: false };
  // Merged is where a builder ends: nothing moves it on.
  if (status?.kind === "merged") return stays;
  const to = (moved: Unstamped, changes: Partial<Omit<Kept, "status">> = {}) => ({
    kept: { ...base, ...changes, status: moved },
    carryOn: false,
  });
  switch (happening.kind) {
    case "turn-started":
      return to({ kind: "building" }, { turning: true });
    case "retried":
      // Still Stuck until its turn starts; told to carry on once more, as a fresh start is.
      return {
        kept: { ...base, carriedOn: false, cutOff: false, status },
        carryOn: false,
      };
    case "check-waiting":
      return to({ kind: "checking", command: happening.command, ahead: happening.ahead });
    case "check-started":
      return to({ kind: "checking", command: happening.command });
    case "check-ended":
      return status?.kind === "checking" && status.command === happening.command
        ? to({ kind: "building" })
        : stays;
    case "approval-asked":
      return to({ kind: "waiting-on-you", approval: happening.approval });
    case "approval-answered":
      return status?.kind === "waiting-on-you" && status.approval === happening.approval
        ? to({ kind: "building" })
        : stays;
    case "pull-request": {
      const { pullRequest } = happening;
      // While a turn runs, it's the turn's end that says where the builder stands, unless the
      // pull request has merged or closed meanwhile.
      if (base.turning && pullRequest.state === "open") {
        return { kept: { ...base, pullRequest, status }, carryOn: false };
      }
      return to(fromPullRequest(pullRequest), { pullRequest });
    }
    case "turn-ended": {
      const { ending } = happening;
      if (ending.kind === "failed" && ending.reason.kind === "interrupted") {
        // Cut off by a restart, it carries on by itself once (#610); cut off again, it's stuck.
        return base.cutOff
          ? to({ kind: "stuck", reason: STUCK.cutOffTwice }, { turning: false })
          : to({ kind: "waiting-on-you" }, { turning: false, cutOff: true });
      }
      const ended = { turning: false, cutOff: false };
      if (ending.kind === "stopped") return to({ kind: "stuck", reason: STUCK.stopped }, ended);
      if (ending.kind === "failed") return to(fromFailure(ending.reason), ended);
      if (base.pullRequest !== undefined) {
        return to(fromPullRequest(base.pullRequest), { ...ended, carriedOn: false });
      }
      if (happening.asked) return to({ kind: "waiting-on-you" }, { ...ended, carriedOn: false });
      if (base.carriedOn) return to({ kind: "stuck", reason: STUCK.twice }, ended);
      return {
        kept: { ...base, ...ended, carriedOn: true, status: { kind: "building" } },
        carryOn: true,
      };
    }
  }
};

/**
 * Whether a builder now waits on the owner, which they're told of (#593): Stuck, or Waiting on you
 * but for a turn a restart cut off, which carries on by itself.
 */
const waitsOnTheOwner = (kept: Kept) =>
  kept.status.kind === "stuck" || (kept.status.kind === "waiting-on-you" && !kept.cutOff);

export const createBuilders = (options: {
  dataDir: string;
  now: () => number;
  /**
   * Tells the owner a builder waits on them (#593): once each time it comes to be Waiting on you
   * or Stuck, never again while that status holds.
   */
  waitsOnYou?: (session: SessionId, status: BuilderStatus) => void;
}) => {
  const path = join(options.dataDir, FILE);
  const oneAtATime = createOneAtATime();
  /** Every builder as kept, read from its file the first time it's needed. */
  let all: Record<string, Kept> | undefined;

  const read = async () => {
    if (all !== undefined) return all;
    const kept = await readJsonFile(path, BuildersFile);
    if (!kept.ok) console.error("The builders' statuses can't be read; starting afresh.");
    all = kept.ok ? (kept.value?.builders ?? {}) : {};
    return all;
  };

  return {
    /**
     * Moves a builder's status on for what happened, keeping it when it changed: its status
     * now, and whether it's to be told to carry on (its turn ended with nothing to show, once).
     */
    heard: (session: SessionId, happening: Happening) =>
      oneAtATime(async () => {
        const builders = await read();
        const was = builders[session];
        const moved = next(was, happening);
        const { status: unstamped, ...rest } = moved.kept;
        if (unstamped === undefined) return { status: undefined, carryOn: false };
        const goingOn = was !== undefined && goesOn(was.status, unstamped);
        const since = goingOn ? was.status.since : new Date(options.now()).toISOString();
        const stamped = BuilderStatus.safeParse({ ...unstamped, since });
        if (!stamped.success) return { status: was?.status, carryOn: false };
        const status = stamped.data;
        const kept: Kept = { ...rest, status };
        if (JSON.stringify(kept) !== JSON.stringify(was)) {
          builders[session] = kept;
          await mkdir(options.dataDir, { recursive: true });
          const written = await writeJsonFile(path, { builders });
          if (!written.ok) console.error(`Builder ${session}: its status couldn't be kept`);
        }
        if (!goingOn && waitsOnTheOwner(kept)) options.waitsOnYou?.(session, status);
        return { status, carryOn: moved.carryOn };
      }),

    /** A builder's status, once anything has happened in it. */
    statusOf: (session: SessionId) => oneAtATime(async () => (await read())[session]?.status),

    /**
     * Whether a builder a restart has just cut off carries on by itself (#610): the first time
     * since a turn of its ended otherwise.
     */
    carriesOnAfterRestart: (session: SessionId) =>
      oneAtATime(async () => {
        const kept = (await read())[session];
        return kept?.cutOff === true && kept.status.kind === "waiting-on-you";
      }),

    /**
     * The builders waiting for the usage limit whose reset has come (#610): at `resetAt`, or an
     * hour after the limit when it wasn't said.
     */
    dueAtReset: () =>
      oneAtATime(async () => {
        const now = options.now();
        return Object.entries(await read()).flatMap(([session, kept]) => {
          const { status } = kept;
          if (status.kind !== "waiting-for-limit") return [];
          const resets =
            status.resetAt === undefined
              ? Date.parse(status.since) + LIMIT_UNSAID_MS
              : Date.parse(status.resetAt);
          const id = SessionId.safeParse(session);
          return now >= resets && id.success ? [id.data] : [];
        });
      }),
  };
};

export type Builders = ReturnType<typeof createBuilders>;
