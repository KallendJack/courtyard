import { z } from "zod";

/** A version of the live copy: its full commit, and how people read it (short commit, first line). */
export const LiveVersion = z.object({ commit: z.string(), title: z.string() });
export type LiveVersion = z.infer<typeof LiveVersion>;

/** How the last update went, as scripts/live/update.ps1 records it (ADR 0011). */
export const LiveUpdateResult = z.object({
  outcome: z.enum(["running", "updated", "unchanged", "refused", "failed"]),
  from: LiveVersion,
  to: LiveVersion,
  message: z.string(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type LiveUpdateResult = z.infer<typeof LiveUpdateResult>;

const When = z.iso.datetime({ offset: true });

/**
 * One job of a CI run, as its row of main's build shows it (#249, #337). A matrix job's runs fold
 * into one row, with how many of them have finished.
 */
export const BuildJob = z.object({
  name: z.string(),
  /**
   * `waiting` for one that hasn't started, as it waits on the jobs it needs; `other` for one that
   * ended neither passing nor failing: skipped, cancelled.
   */
  outcome: z.enum(["waiting", "running", "passed", "failed", "other"]),
  /** When its latest try started, and ended; `null` until it has. */
  startedAt: When.nullable(),
  completedAt: When.nullable(),
  /** A matrix job's runs: how many have finished, of how many; `null` for a job that runs once. */
  shards: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
  /** The jobs it waits on, by name, each in a stage before its own. */
  needs: z.array(z.string()),
});
export type BuildJob = z.infer<typeof BuildJob>;

/**
 * Main's build (#249, #337): CI on main's newest commit as GitHub has it, in stages drawn from the
 * workflow's own order: jobs that start together share a stage, and a job that waits on others
 * sits in a stage after theirs. Update waits for it to pass.
 */
export const MainBuild = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("running"),
    stages: z.array(z.array(BuildJob)),
    /** When its latest try started; `null` until a job has. */
    startedAt: When.nullable(),
    /**
     * When it should end, from how long each job usually takes; `null` when unknown. Already past
     * when its jobs have run longer than they usually do: it's nearly done.
     */
    endsAround: When.nullable(),
  }),
  z.object({
    kind: z.literal("passed"),
    stages: z.array(z.array(BuildJob)),
    startedAt: When.nullable(),
    completedAt: When.nullable(),
  }),
  z.object({
    kind: z.literal("failed"),
    stages: z.array(z.array(BuildJob)),
    /** The first failed job's page on GitHub, with its log. */
    details: z.url({ protocol: /^https$/ }),
  }),
]);
export type MainBuild = z.infer<typeof MainBuild>;

/**
 * An Update tapped before it could run (#186), which the worker runs itself once main's build has
 * passed: one at a time, kept across a restart. It waits for main's build (`ci`) and nothing else,
 * holding nothing back (#621, ADR 0031); or it was dropped, as main's build failed while it
 * waited, with that build's log (`dropped`), until main moves on.
 */
export const UpdateWaiting = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ci") }),
  z.object({ kind: z.literal("dropped"), details: z.url({ protocol: /^https$/ }) }),
]);
export type UpdateWaiting = z.infer<typeof UpdateWaiting>;

/**
 * Update (#186): when ready, the worker runs it once main's build has passed, waiting till then;
 * `now` runs it at once. Either way it cuts off the turns running, which carry on by themselves
 * after the restart.
 */
export const LiveUpdateRequest = z.object({ now: z.boolean().optional() });
export type LiveUpdateRequest = z.infer<typeof LiveUpdateRequest>;

/** What Update did (#186): started, or waits to run itself. */
export const LiveUpdateStarted = z.object({ waits: z.boolean() });
export type LiveUpdateStarted = z.infer<typeof LiveUpdateStarted>;

/** Whether this worker can update itself from the app, and if so, what it runs and what's newer. */
export const LiveStatus = z.discriminatedUnion("kind", [
  /** Not a live copy: development, tests, or a worker set up by hand. */
  z.object({ kind: z.literal("off") }),
  z.object({
    kind: z.literal("live"),
    running: LiveVersion,
    /** Main's newest commit, when the live copy's remote could be reached. */
    newest: LiveVersion.nullable(),
    /** Whether main has moved on from what's running. */
    newerOnMain: z.boolean(),
    lastUpdate: LiveUpdateResult.nullable(),
    /**
     * Main's build while main has moved on (#249): `null` when it hasn't, or GitHub can't be
     * asked (no one signed in, or the live copy's remote isn't on GitHub).
     */
    build: MainBuild.nullable(),
    /** The Update waiting to run (#186), or `null` when none waits. */
    waiting: UpdateWaiting.nullable(),
  }),
]);
export type LiveStatus = z.infer<typeof LiveStatus>;
