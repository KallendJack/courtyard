import { join } from "node:path";
import {
  BUILDER_STALLS_AFTER_MINUTES,
  buildable,
  CODE_SESSIONS_AT_ONCE,
  type CodeSessionList,
  endsTurn,
  LEAD_BUILDERS,
  LEAD_WINDOW_BY_DEFAULT,
  type LeadAllowAll,
  type LeadBuilder,
  LeadHeldBack,
  type LeadMerge,
  type LeadMergeRequest,
  type LeadReady,
  type LeadRun,
  type LeadStatus,
  type LeadWindow,
  type NextUpIssue,
  type SessionEvent,
  SessionId,
  tasksIn,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { allowAllUntil } from "../../auth/allow-all/index.ts";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { createOneAtATime } from "../../lib/one-at-a-time.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import {
  CARRY_ON_MESSAGE,
  type LeadBrief,
  type LeadToolDone,
  type LeadToolRefusal,
  leadMergedMessage,
  leadToolReply,
  RUN_BUILD_ORDER_MESSAGE,
} from "../../prompts/index.ts";
import type { ToolReply } from "../../providers/index.ts";
import type { NextUp } from "../next-up/index.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { getWorkspace, listCodeWorkspaces, type WorkspaceError } from "../workspaces/index.ts";

/**
 * A code workspace's Lead (#347): one long-lived session whose job is the build order, not one
 * issue. The steady part is the worker's, one of its repeating jobs: once the owner runs the order,
 * it starts a builder session for each next free issue in Next up, a set number at a time, and
 * watches them: it notes in the Lead's chat what it did, tells the owner when a builder's pull
 * request is ready to merge, sends the Lead a turn when one merges (to move its boards and keep the
 * plan current), holds itself back while main is red, the machine is busy with the owner's own
 * sessions, or a builder waits on the owner's decision, and rests when nothing is ready to build.
 * The Lead's model talks with the owner and changes how the order runs with its build order tool.
 * Merging, Update, reordering and filing issues stay the owner's.
 */

/** Where each code workspace's Lead is kept, in the data folder. */
const FILE = "leads.json";

/** How many of the worker's notes the Lead's turns are told, the latest. */
const NOTES_KEPT = 10;

/** The title the Lead's session has. */
const LEAD_TITLE = "Lead";

/** How long the 4 hours window lasts (#457). */
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/** The hour Until tonight ends at, on the worker's clock (#457). */
const TONIGHT_AT = 22;

/** The brakes on a Run (#457): it starts no builder while this many PRs wait on the owner. */
const REVIEWS_WAITING_AT_MOST = 2;

/** The brakes on a Run (#457): it rests once it has started this many builders. */
const BUILDS_PER_RUN = 4;

/** Why it rests once a Run has started all it may (#457). */
const BUILT_ALL_THIS_RUN = `Built ${BUILDS_PER_RUN} this run · tap Run for more`;

/**
 * Until when a Run keeps the Lead going (#457), or `undefined` for just what's ready now. Until
 * tonight, once 22:00 has passed, lasts 4 hours, as tomorrow's 22:00 would be far too long.
 */
const wakesUntilOf = (window: LeadWindow, now: number) => {
  switch (window) {
    case "ready-now":
      return undefined;
    case "4-hours":
      return new Date(now + FOUR_HOURS_MS).toISOString();
    case "tonight": {
      const tonight = new Date(now);
      tonight.setHours(TONIGHT_AT, 0, 0, 0);
      return tonight.getTime() > now
        ? tonight.toISOString()
        : new Date(now + FOUR_HOURS_MS).toISOString();
    }
  }
};

/** A builder's title starts with this when it fixes a red main (#355's issue). */
const MAIN_FIX = /^Main fails:/;

/** How long a builder may be silent before it's stalled (#474). */
const STALLS_AFTER_MS = BUILDER_STALLS_AFTER_MINUTES * 60 * 1000;

/**
 * A builder the Lead started, the code files its issue named then (#423), and since when it has
 * been silent (#474): its latest event then, and when the Lead began counting, which waiting on
 * the owner or for a place starts again.
 */
const Builder = z.object({
  session: SessionId,
  issue: z.number().int().positive(),
  files: z.array(z.string()).default([]),
  quiet: z.object({ seq: z.number().int().nonnegative(), since: z.iso.datetime() }).optional(),
});

/**
 * Merge in order (#423), as kept: merging the builders' pull requests in this order, first first,
 * with the heads it has asked a session to bring up to date; or stopped at one, and why.
 */
const Merge = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("merging"),
    queue: z.array(SessionId),
    /** The heads it has seen conflict, waiting for the worker to bring them up to date (#382). */
    conflicting: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("stopped"),
    pullRequest: z.number().int().positive(),
    why: z.string(),
  }),
]);
type Merge = z.infer<typeof Merge>;

/** One code workspace's Lead, as kept. */
const Kept = z.object({
  session: SessionId,
  state: z.enum(["running", "paused", "resting"]),
  /** Why it's holding back while running, why it's resting. */
  why: z.string().optional(),
  builders: z.number().int().min(LEAD_BUILDERS.atLeast).max(LEAD_BUILDERS.atMost),
  /** The builders it started whose pull requests haven't merged or closed yet. */
  built: z.array(Builder),
  /** Issues the owner skipped for now, until they run the order again. */
  skipped: z.array(z.number().int().positive()),
  /** What it has told the owner already, by what it was about, so nothing is said twice. */
  told: z.array(z.string()),
  /** The worker's latest notes in its chat, oldest first. */
  notes: z.array(z.string()),
  /**
   * Until when the builders it starts allow all (#428), when the owner ran the order with Allow
   * all for builders: each allows all until its pull request opens, until then at most.
   */
  allowAllUntil: z.iso.datetime().optional(),
  /** Merge in order (#423), while it's merging or stopped. */
  merge: Merge.optional(),
  /** The ready issues it held back last time round (#423). */
  heldBack: z.array(LeadHeldBack).optional(),
  /** Until when it wakes from a rest for new work (#457), from the owner's latest Run. */
  wakesUntil: z.iso.datetime().optional(),
  /** How many builders it has started since the owner's latest Run (#457). */
  startedThisRun: z.number().int().min(0).default(0),
});
type Kept = z.infer<typeof Kept>;

const LeadsFile = z.object({ leads: z.record(z.string(), Kept) });

/** Why a Lead couldn't be read or run. */
export type LeadProblem =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  | { readonly kind: "not-code" }
  | { readonly kind: "session"; readonly error: SessionError }
  | { readonly kind: "storage" }
  /** Merge in order was tapped with no builder's pull request ready to merge (#423). */
  | { readonly kind: "nothing-to-merge" };

type Listed = CodeSessionList["sessions"][number];

/**
 * What a builder with no pull request has done, as the Lead reads it each look (#474): its latest
 * event, whether its last turn failed or was stopped, how many approvals it waits on that Allow
 * all would allow (#551), and whether something of the machine's is in hand for it (#574).
 */
type Heard = {
  readonly seq: number;
  readonly stopped: boolean;
  readonly allowable: number;
  readonly inHand: boolean;
  /** How its last turn ended of itself (#572), when it completed. */
  readonly ended: Ended | undefined;
};

/**
 * A builder's last turn, completed (#572): its end, whether it asked the owner a question with
 * set choices (suggested replies), and whether the Lead has told it to carry on since the owner's
 * own last message.
 */
type Ended = { readonly seq: number; readonly asked: boolean; readonly toldToCarryOn: boolean };

/** Whether a message in a session is the worker's (a failed check, a task's end), not the owner's. */
const fromWorker = (event: Extract<SessionEvent, { type: "owner-message" }>) =>
  event.checksFailed !== undefined ||
  event.conflicted !== undefined ||
  event.merged !== undefined ||
  event.continues !== undefined ||
  event.tasksEnded !== undefined ||
  event.carryOn === true;

/** How a session's last turn ended, when it completed (#572). */
const endedIn = (events: readonly SessionEvent[]): Ended | undefined => {
  const last = events.findLast((event) => event.type === "owner-message" || endsTurn(event));
  if (last?.type !== "turn-completed") return undefined;
  const since = events.findLast((event) => event.type === "owner-message")?.seq ?? 0;
  const owners = events.findLast((event) => event.type === "owner-message" && !fromWorker(event));
  return {
    seq: last.seq,
    asked: events.some((event) => event.type === "suggested-replies" && event.seq > since),
    toldToCarryOn: events.some(
      (event) =>
        event.type === "owner-message" && event.carryOn === true && event.seq > (owners?.seq ?? 0),
    ),
  };
};

/**
 * Whether something of the machine's is in hand for a session (#574): a task the model started
 * still runs, or its latest event is a command it's running or one waiting for the build turn,
 * which nothing has followed yet.
 */
const inHandIn = (events: readonly SessionEvent[]) => {
  const last = events.at(-1);
  return (
    (last?.type === "activity" &&
      (last.activity.kind === "ran-command" || last.activity.kind === "waiting-for-build")) ||
    tasksIn(events).some((task) => !task.preview && task.ended === undefined)
  );
};

/** How many approvals a session waits on that Allow all covers (#551): asked, not yet answered. */
const allowableIn = (events: readonly SessionEvent[]) => {
  const answered = new Set(
    events.flatMap((event) => (event.type === "approval-answered" ? [event.approval] : [])),
  );
  return events.filter(
    (event) =>
      event.type === "approval-requested" && event.all === true && !answered.has(event.seq),
  ).length;
};

/**
 * Whether a session's last turn failed or was stopped (#474); one cut off by a restart waits for
 * Continue (#186) instead.
 */
const endedBadly = (events: readonly SessionEvent[]) => {
  const last = events.findLast(
    (event) =>
      event.type === "owner-message" ||
      event.type === "turn-completed" ||
      event.type === "turn-stopped" ||
      event.type === "turn-failed",
  );
  return (
    last?.type === "turn-stopped" ||
    (last?.type === "turn-failed" && last.reason.kind !== "interrupted")
  );
};

/**
 * Where a builder stands: still building; with no pull request, its last turn failed or stopped,
 * or stalled (#474), neither taking a slot until it carries on; its pull request ready to merge;
 * or done with.
 */
const standingOf = (listed: Listed | undefined, heard?: Heard) => {
  const pullRequest = listed?.pullRequest;
  if (listed === undefined || (pullRequest !== undefined && pullRequest.state !== "open")) {
    return "ended" as const;
  }
  if (pullRequest === undefined) {
    if (listed.waiting === "stalled") return "stalled" as const;
    if (heard?.stopped === true && listed.now.kind === "your-turn" && !listed.queued) {
      return "stopped" as const;
    }
  }
  return pullRequest?.checks.kind === "passed" && pullRequest.conflicts !== true
    ? ("ready" as const)
    : ("building" as const);
};

/** A builder by what it builds, in a few words, as the owner reads it (#361). */
const nameOf = (listed: Listed | undefined, issue: number) =>
  listed?.title.replace(/^Build #\d+: /, "") ?? `issue #${issue}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Whether two files are the same (#423), as an issue names one and git lists the other: by path,
 * or one by its name or the end of its path, at the end of the other's.
 */
const sameFile = (a: string, b: string) =>
  !COMMON_NAMES.test(a) &&
  !COMMON_NAMES.test(b) &&
  (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`));

/**
 * File names many folders have (#423), which name no one file on their own: one named only by its
 * name clashes with nothing.
 */
const COMMON_NAMES =
  /^(?:index|routes|types|api|utils?|helpers?|main|app|config|constants)\.[\w.]+$|^(?:package|tsconfig)\.json$/;

/** Names in a sentence: "e2e", "check and e2e", "check, verify and e2e". */
const namesOf = (names: readonly string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** Why Merge in order couldn't merge a pull request (#423), as its stop says it. */
const mergeRefused = (error: SessionError) =>
  error.kind === "pull-request-refused"
    ? `GitHub wouldn't merge it (${error.reason})`
    : "GitHub couldn't merge it just now";

export const createLead = (options: {
  contextDir: string;
  dataDir: string;
  sessions: Pick<
    Sessions,
    | "create"
    | "get"
    | "list"
    | "lastModelOf"
    | "codeRunning"
    | "note"
    | "tellMerged"
    | "tellToCarryOn"
    | "stopBuilding"
    | "mergePullRequest"
    | "events"
    | "markStalled"
    | "allowAllFromLead"
    | "allowAllOffFromLead"
  >;
  nextUp: Pick<NextUp, "list" | "fresh" | "build" | "filesNamed">;
  /** The files a builder's worktree changes (#423), by its workspace and session. */
  changedFiles: (workspaceId: WorkspaceId, session: SessionId) => Promise<readonly string[]>;
  /** Whether a code workspace's main is red now (#355), by its id. */
  mainRed: (workspaceId: WorkspaceId) => Promise<boolean>;
  /** Whether an Update waits to run (#186): meanwhile no builder starts. */
  updating?: () => boolean;
  /** Tells the owner, on their devices, what a session needs (#173): "Ready to merge". */
  notify: (session: SessionId, need: string) => void;
  now: () => number;
}) => {
  const { sessions, nextUp } = options;
  const keptPath = join(options.dataDir, FILE);
  /** Everything a Lead does, one thing at a time, so two never read its record at once. */
  const oneAtATime = createOneAtATime();

  const readAll = async (): Promise<Result<Record<string, Kept>, LeadProblem>> => {
    const read = await readJsonFile(keptPath, LeadsFile);
    return read.ok ? ok(read.value?.leads ?? {}) : err({ kind: "storage" });
  };

  const keep = async (workspaceId: WorkspaceId, kept: Kept) => {
    const all = await readAll();
    if (!all.ok) return all;
    const written = await writeJsonFile(keptPath, { leads: { ...all.value, [workspaceId]: kept } });
    return written.ok ? ok(null) : err<LeadProblem>({ kind: "storage" });
  };

  /** A code workspace's id, or why it can't have a Lead. */
  const codeWorkspaceOf = async (rawId: string): Promise<Result<WorkspaceId, LeadProblem>> => {
    const workspace = await getWorkspace(options.contextDir, rawId);
    if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
    const { summary, repoPath } = workspace.value;
    return summary.mode === "code" && repoPath !== null
      ? ok(summary.id)
      : err({ kind: "not-code" });
  };

  /** Writes a note in the Lead's chat, and keeps it for its turns. */
  const noted = async (kept: Kept, text: string): Promise<Kept> => {
    const recorded = await sessions.note(kept.session, text);
    if (!recorded.ok) console.error(`The Lead couldn't note "${text}"`, recorded.error);
    return { ...kept, notes: [...kept.notes, text].slice(-NOTES_KEPT) };
  };

  /** The workspace's sessions by id, as listed now. */
  const listedIn = async (workspaceId: WorkspaceId) => {
    const listed = await sessions.list(workspaceId);
    return new Map((listed.ok ? listed.value : []).map((session) => [session.id, session]));
  };

  /** What each of the Lead's builders with no pull request has done (#474), read now. */
  const heardOf = async (kept: Kept | undefined, listed: ReadonlyMap<SessionId, Listed>) => {
    const heard = new Map<SessionId, Heard>();
    for (const { session } of kept?.built ?? []) {
      const each = listed.get(session);
      if (each === undefined || each.pullRequest !== undefined) continue;
      const events = await sessions.events(session);
      if (!events.ok) continue;
      heard.set(session, {
        seq: events.value.at(-1)?.seq ?? 0,
        stopped: endedBadly(events.value),
        // Only while its turn waits on one: a turn that ended asks nothing any more.
        allowable: each.waiting === "approval" ? allowableIn(events.value) : 0,
        inHand: inHandIn(events.value),
        ended: endedIn(events.value),
      });
    }
    return heard;
  };

  /** Where the Lead's builders stand, from the sessions listed now and what they've done. */
  const buildersOf = (
    kept: Kept | undefined,
    listed: ReadonlyMap<SessionId, Listed>,
    heard: ReadonlyMap<SessionId, Heard> = new Map(),
  ) => {
    const building: LeadBuilder[] = [];
    const ready: LeadReady[] = [];
    for (const { session, issue } of kept?.built ?? []) {
      const each = listed.get(session);
      const standing = standingOf(each, heard.get(session));
      if (each === undefined || standing === "ended") continue;
      if (standing === "building") building.push({ session, title: each.title, issue });
      else if (each.pullRequest !== undefined) {
        ready.push({ session, title: each.title, issue, pullRequest: each.pullRequest.number });
      }
    }
    return { building, ready };
  };

  /** Until when the builders the Lead starts now allow all (#428), while that's still ahead. */
  const allowAllUntilOf = (kept: Kept | undefined) => {
    const until = kept?.allowAllUntil;
    return until !== undefined && Date.parse(until) > options.now() ? until : undefined;
  };

  /** Its builders still building with no pull request yet, which Allow all for builders reaches (#551). */
  const allowableOf = (kept: Kept | undefined, listed: ReadonlyMap<SessionId, Listed>) =>
    (kept?.built ?? []).filter((builder) => {
      const each = listed.get(builder.session);
      return each !== undefined && each.pullRequest === undefined;
    });

  /** Who Allow all for builders reaches if it's switched on now (#551). */
  const reachOf = (
    kept: Kept | undefined,
    listed: ReadonlyMap<SessionId, Listed>,
    heard: ReadonlyMap<SessionId, Heard>,
  ) => {
    const builders = allowableOf(kept, listed);
    const approvals = builders
      .filter((builder) => listed.get(builder.session)?.allowingAll === undefined)
      .reduce((sum, builder) => sum + (heard.get(builder.session)?.allowable ?? 0), 0);
    return { builders: builders.length, approvals };
  };

  /** Until when a resting Lead wakes for new work (#457), while that's still ahead. */
  const openWindowOf = (kept: Kept | undefined) => {
    const until = kept?.wakesUntil;
    return until !== undefined && Date.parse(until) > options.now() ? until : undefined;
  };

  /**
   * The window a Run opens (#457): the one it names, or, when it names none (the Running row's
   * Run, or the Lead's tool), the one still open, else the default.
   */
  const windowFrom = (kept: Kept | undefined, window: LeadWindow | undefined) =>
    window !== undefined
      ? wakesUntilOf(window, options.now())
      : (openWindowOf(kept) ?? wakesUntilOf(LEAD_WINDOW_BY_DEFAULT, options.now()));

  /** The next ready issues the Lead would start, leaving out what it builds and what's skipped. */
  const nextOf = (kept: Kept | undefined, issues: readonly NextUpIssue[]) =>
    issues.filter(
      (issue) =>
        buildable(issue) &&
        !(kept?.heldBack ?? []).some((held) => held.issue === issue.number) &&
        !(kept?.skipped ?? []).includes(issue.number) &&
        !(kept?.built ?? []).some((builder) => builder.issue === issue.number),
    );

  /** Whether Merge in order still stands stopped (#423): its pull request still open. */
  const stillStopped = (
    merge: Extract<Merge, { kind: "stopped" }>,
    listed: ReadonlyMap<SessionId, Listed>,
  ) =>
    [...listed.values()].some(
      (each) => each.pullRequest?.number === merge.pullRequest && each.pullRequest.state === "open",
    );

  /** Merge in order as the owner sees it (#423): the pull request it's on, or where it stopped. */
  const mergeOf = (
    merge: Merge | undefined,
    listed: ReadonlyMap<SessionId, Listed>,
  ): LeadMerge | undefined => {
    if (merge?.kind === "stopped") return stillStopped(merge, listed) ? merge : undefined;
    if (merge?.kind !== "merging") return merge;
    const on = merge.queue
      .map((session) => listed.get(session)?.pullRequest)
      .find((pull) => pull?.state === "open");
    return on === undefined ? undefined : { kind: "merging", pullRequest: on.number };
  };

  /**
   * One step of Merge in order (#423), each time round and as the owner taps it: the first pull
   * request still open is merged once its checks pass and its session's turn is done, and the next
   * is seen afresh next time round, since GitHub works out again whether it conflicts. One that
   * conflicts is brought up to date by its session, once for each head; a failing check, a conflict
   * its session left, or GitHub's refusal stops it, saying which and why. Merged and closed ones
   * leave the queue; once it's empty, it says so.
   */
  const mergeStep = async (was: Kept, listed: ReadonlyMap<SessionId, Listed>): Promise<Kept> => {
    let kept = was;
    if (kept.merge?.kind === "stopped" && !stillStopped(kept.merge, listed)) {
      const { merge: _, ...forgotten } = kept;
      kept = forgotten;
    }
    for (;;) {
      const merge = kept.merge;
      if (merge?.kind !== "merging") return kept;
      const [first, ...rest] = merge.queue;
      const { merge: _, ...done } = kept;
      if (first === undefined) return noted(done, "Merged them all, in order.");
      const each = listed.get(first);
      const pull = each?.pullRequest;
      if (pull?.state !== "open") {
        kept = { ...kept, merge: { ...merge, queue: rest } };
        continue;
      }
      const waiting = rest.flatMap((session) => {
        const number = listed.get(session)?.pullRequest?.number;
        return number === undefined ? [] : [`#${number}`];
      });
      const stop = (stopping: { why: string; fixing: boolean }) =>
        noted(
          { ...done, merge: { kind: "stopped", pullRequest: pull.number, why: stopping.why } },
          [
            `Stopped at #${pull.number}: ${stopping.why}.`,
            ...(stopping.fixing ? ["Its session is looking at it."] : []),
            ...(waiting.length === 0
              ? []
              : [`${waiting.join(" and ")} ${waiting.length === 1 ? "waits" : "wait"}.`]),
            `Once it's ${stopping.fixing ? "green" : "sorted"}, tap Merge in order again.`,
          ].join(" "),
        );
      const { checks } = pull;
      if (checks.kind === "failed") {
        const word = checks.failed.length === 1 ? "check" : "checks";
        return stop({ why: `its ${namesOf(checks.failed)} ${word} failed`, fixing: true });
      }
      // The worker brings one that conflicts up to date through its session, once for each head
      // (#382): the merge waits for that, and stops if the session left it conflicting.
      if (pull.conflicts === true) {
        if (!merge.conflicting.includes(pull.head)) {
          return noted(
            { ...kept, merge: { ...merge, conflicting: [...merge.conflicting, pull.head] } },
            `Bringing #${pull.number} up to date first.`,
          );
        }
        return each?.busy === true
          ? kept
          : stop({
              why: "it still conflicts with main after its session tried to bring it up to date",
              fixing: false,
            });
      }
      if (checks.kind === "running" || each?.busy === true) return kept;
      const merged = await sessions.mergePullRequest(first, pull.head);
      if (!merged.ok) return stop({ why: mergeRefused(merged.error), fixing: false });
      kept = { ...kept, merge: { ...merge, queue: rest } };
      if (rest.length > 0) return kept;
    }
  };

  const statusOf = async (
    workspaceId: WorkspaceId,
    kept: Kept | undefined,
  ): Promise<LeadStatus> => {
    const [listed, issues] = await Promise.all([listedIn(workspaceId), nextUp.list(workspaceId)]);
    const heard = await heardOf(kept, listed);
    const { building, ready } = buildersOf(kept, listed, heard);
    const allowing = allowAllUntilOf(kept);
    const merge = mergeOf(kept?.merge, listed);
    const wakes = kept?.state === "resting" ? openWindowOf(kept) : undefined;
    return {
      state: kept?.state ?? "not-started",
      ...(kept === undefined ? {} : { session: kept.session }),
      ...(kept?.why === undefined ? {} : { why: kept.why }),
      builders: kept?.builders ?? LEAD_BUILDERS.byDefault,
      building,
      next: nextOf(kept, issues.ok ? issues.value : []).slice(0, 2),
      ready,
      ...(allowing === undefined ? {} : { buildersAllowedAll: allowing }),
      allowAllReaches: reachOf(kept, listed, heard),
      ...(wakes === undefined ? {} : { wakesUntil: wakes }),
      ...(merge === undefined ? {} : { merge }),
      ...(kept?.heldBack === undefined || kept.state !== "running"
        ? {}
        : { heldBack: kept.heldBack }),
    };
  };

  /**
   * Tells the owner what's new about the Lead's builders: each pull request ready to merge (with a
   * notification), and each merged one (with a turn for the Lead). Done with, a builder leaves its
   * record.
   */
  const watchBuilders = async (
    kept: Kept,
    listed: ReadonlyMap<SessionId, Listed>,
  ): Promise<Kept> => {
    let now = kept;
    const tellOnce = async (about: string, text: string) => {
      if (now.told.includes(about)) return;
      now = await noted({ ...now, told: [...now.told, about] }, text);
    };
    for (const { session, issue } of kept.built) {
      const each = listed.get(session);
      const pullRequest = each?.pullRequest;
      const name = nameOf(each, issue);
      if (pullRequest?.state === "open" && standingOf(each) === "ready") {
        const about = `ready:${session}:${pullRequest.head}`;
        if (!now.told.includes(about)) options.notify(session, "Ready to merge");
        await tellOnce(about, `${name} is ready for you to merge (#${pullRequest.number}).`);
      }
      if (pullRequest?.state === "merged" && !now.told.includes(`merged:${session}`)) {
        // Sent only while the Lead is free: otherwise it's tried again next time round.
        const told = await sessions.tellMerged(now.session, {
          pullRequest: pullRequest.number,
          text: leadMergedMessage({ pullRequest: pullRequest.number, issue, title: name }),
        });
        if (told.ok)
          await tellOnce(`merged:${session}`, `${name} merged (#${pullRequest.number}).`);
      }
    }
    const done = (builder: z.infer<typeof Builder>) => {
      const each = listed.get(builder.session);
      if (standingOf(each) !== "ended") return false;
      // A merged one stays until the Lead has been told.
      return (
        each?.pullRequest?.state !== "merged" || now.told.includes(`merged:${builder.session}`)
      );
    };
    return { ...now, built: now.built.filter((builder) => !done(builder)) };
  };

  /**
   * Watches its builders' silence (#474): one still building with no pull request, silent (no
   * turn, commit or event) for `STALLS_AFTER_MS`, is stalled. Its session is marked so, which
   * waits on the owner and frees its slot, the owner is told, and its session is kept, its claim
   * standing, for the owner to look at. Time it waits on the owner or for a place doesn't count,
   * nor time something of the machine's is in hand for it (#574): its silence starts again once
   * that ends. One with a pull request waits on the owner or CI, so never stalls.
   */
  const watchQuiet = async (
    was: Kept,
    listed: ReadonlyMap<SessionId, Listed>,
    heard: ReadonlyMap<SessionId, Heard>,
  ) => {
    let kept = was;
    let stalled = false;
    const built: z.infer<typeof Builder>[] = [];
    const at = new Date(options.now()).toISOString();
    for (const builder of was.built) {
      const each = listed.get(builder.session);
      const latest = heard.get(builder.session);
      const { quiet, ...unwatched } = builder;
      if (each === undefined || latest === undefined || standingOf(each, latest) !== "building") {
        built.push(unwatched);
        continue;
      }
      if (each.waiting !== "nothing" || each.queued || latest.inHand || quiet?.seq !== latest.seq) {
        built.push({ ...unwatched, quiet: { seq: latest.seq, since: at } });
        continue;
      }
      built.push(builder);
      if (options.now() - Date.parse(quiet.since) < STALLS_AFTER_MS) continue;
      const marked = await sessions.markStalled(builder.session, latest.seq);
      if (!marked.ok) continue;
      stalled = true;
      options.notify(builder.session, "Stalled");
      kept = await noted(
        kept,
        `${nameOf(each, builder.issue)} stalled: silent ${BUILDER_STALLS_AFTER_MINUTES} min, so its slot is free.`,
      );
    }
    return { kept: { ...kept, built }, stalled };
  };

  /**
   * Watches its builders' stops (#572): one whose turn completed with no pull request, nothing of
   * the machine's in hand and no question for the owner (no suggested replies) is told to carry
   * on, once until the owner's own next message, and the Lead's chat says so. Stopping again like
   * that, it waits on the owner: they're told "Stopped, no PR", once a stop. One asking the owner
   * a question waits on them as it is; the Lead never answers it.
   */
  const watchStops = async (
    was: Kept,
    listed: ReadonlyMap<SessionId, Listed>,
    heard: ReadonlyMap<SessionId, Heard>,
  ) => {
    let kept = was;
    for (const builder of was.built) {
      const each = listed.get(builder.session);
      const ended = heard.get(builder.session)?.ended;
      if (
        each === undefined ||
        ended === undefined ||
        ended.asked ||
        each.pullRequest !== undefined ||
        each.now.kind !== "your-turn" ||
        each.queued ||
        each.waiting === "stalled" ||
        heard.get(builder.session)?.inHand === true
      ) {
        continue;
      }
      const name = nameOf(each, builder.issue);
      if (!ended.toldToCarryOn) {
        // Refused while a turn runs there or an Update waits: it's tried again next time round.
        const told = await sessions.tellToCarryOn(builder.session, CARRY_ON_MESSAGE);
        if (told.ok) kept = await noted(kept, `Told ${name} to carry on: it stopped with no PR.`);
        continue;
      }
      const about = `stopped:${builder.session}:${ended.seq}`;
      if (kept.told.includes(about)) continue;
      options.notify(builder.session, "Stopped, no PR");
      kept = await noted(
        { ...kept, told: [...kept.told, about] },
        `${name} stopped again with no PR, so it waits on you.`,
      );
    }
    return kept;
  };

  /**
   * Whether a resting Lead wakes now (#457): while its window is open, once an issue it would
   * start is buildable (made ready, its claim freed, its blocker closed, its clash merged).
   */
  const wakes = async (workspaceId: WorkspaceId, kept: Kept) => {
    if (kept.state !== "resting" || openWindowOf(kept) === undefined) return false;
    const issues = await nextUp.fresh(workspaceId);
    const { heldBack: _, ...unheld } = kept;
    return issues.ok && nextOf(unheld, issues.value).length > 0;
  };

  /**
   * One look at a Lead: what's new about its builders; then, resting within its window, whether it
   * wakes for new work (#457); then, running, whether it holds back, then a builder for each next
   * free issue up to its number, or a rest when nothing is ready to build or its Run has built all
   * it may.
   */
  const look = async (workspaceId: WorkspaceId, was: Kept): Promise<Kept> => {
    let listed = await listedIn(workspaceId);
    const heard = await heardOf(was, listed);
    const watched = await watchQuiet(await watchBuilders(was, listed), listed, heard);
    // One just found stalled is listed so from now on.
    if (watched.stalled) listed = await listedIn(workspaceId);
    let kept = await mergeStep(await watchStops(watched.kept, listed, heard), listed);
    const woke = await wakes(workspaceId, kept);
    if (woke) {
      const { why: _, heldBack: _held, ...rest } = kept;
      kept = { ...rest, state: "running" };
    }
    if (kept.state !== "running") return kept;
    const { building, ready } = buildersOf(kept, listed, heard);
    const deciding = building.find(
      (builder) => listed.get(builder.session)?.waiting === "approval",
    );
    // The owner's reviews are a brake (#457): no new builder while too many wait on them.
    const reviewing = ready.length >= REVIEWS_WAITING_AT_MOST;
    const red = deciding === undefined && !reviewing && (await options.mainRed(workspaceId));
    const updating = options.updating?.() === true;
    let why =
      deciding !== undefined
        ? `${nameOf(listed.get(deciding.session), deciding.issue)} waits on your decision.`
        : updating
          ? "Courtyard waits to update, so the next builder starts after it."
          : reviewing
            ? `${ready.length} PRs wait on your review, so the next builder starts once one merges.`
            : red
              ? "main is red, so only its fix starts."
              : undefined;
    let started = 0;
    let free = kept.builders - building.length;
    if (deciding === undefined && !updating && !reviewing && free > 0) {
      // What's held back is worked out afresh each time a builder could start.
      const { heldBack: _held, ...unheld } = kept;
      kept = unheld;
      const issues = await nextUp.fresh(workspaceId);
      if (!issues.ok) return kept;
      const next = nextOf(kept, issues.value).filter((issue) => !red || MAIN_FIX.test(issue.title));
      const named = await nextUp.filesNamed(workspaceId);
      // Each builder still at work, by its issue, with the files its issue named and its
      // worktree changes; those it starts now join it.
      const changing = await Promise.all(
        kept.built
          .filter((builder) => standingOf(listed.get(builder.session)) !== "ended")
          .map(async (builder) => ({
            issue: builder.issue,
            files: [
              ...builder.files,
              ...(await options.changedFiles(workspaceId, builder.session)),
            ],
          })),
      );
      const heldBack: LeadHeldBack[] = [];
      for (const issue of next) {
        if (free === 0 || kept.startedThisRun >= BUILDS_PER_RUN) break;
        const files = [...(named.get(issue.number) ?? [])];
        // Main's fix is never held back: nothing goes green while main is red.
        const clash = (MAIN_FIX.test(issue.title) ? [] : changing)
          .flatMap((builder) => {
            const shared = files.find((file) => builder.files.some((each) => sameFile(file, each)));
            return shared === undefined ? [] : [{ behind: builder.issue, shared }];
          })
          .at(0);
        if (clash !== undefined) {
          heldBack.push({ issue: issue.number, behind: clash.behind });
          const about = `held:${issue.number}:${clash.behind}`;
          if (!kept.told.includes(about)) {
            kept = await noted(
              { ...kept, told: [...kept.told, about] },
              `Holding back #${issue.number} ${issue.title}: it changes the same files as #${clash.behind} (${clash.shared}). It starts once #${clash.behind} merges.`,
            );
          }
          continue;
        }
        // One place always stays free for the owner's own sessions.
        if (sessions.codeRunning() >= CODE_SESSIONS_AT_ONCE - 1) {
          why ??= "your own sessions are using the machine, so the next builder waits.";
          break;
        }
        const model = await sessions.lastModelOf(kept.session);
        if (model === undefined) break;
        const allowAllUntil = allowAllUntilOf(kept);
        const built = await nextUp.build(workspaceId, issue.number, {
          ...model,
          byLead: true,
          ...(allowAllUntil === undefined ? {} : { allowAllUntil }),
        });
        if (!built.ok) {
          // Claimed by someone else meanwhile, or blocked by an open issue (#377): the next one, then.
          if (["claimed", "no-such-issue", "blocked"].includes(built.error.kind)) continue;
          console.error(`The Lead couldn't start #${issue.number}`, built.error);
          break;
        }
        kept = await noted(
          {
            ...kept,
            built: [...kept.built, { session: built.value.id, issue: issue.number, files }],
            startedThisRun: kept.startedThisRun + 1,
          },
          woke && started === 0
            ? `Woke: #${issue.number} is ready, started building.`
            : `Started building ${issue.title} (#${issue.number}).`,
        );
        changing.push({ issue: issue.number, files });
        started += 1;
        free -= 1;
      }
      if (heldBack.length > 0) kept = { ...kept, heldBack };
      // A Run builds so many at most (#457): then it rests, its window closed, until the next.
      if (kept.startedThisRun >= BUILDS_PER_RUN) {
        const { why: _, wakesUntil: _until, heldBack: _held, ...rest } = kept;
        return noted(
          { ...rest, state: "resting", why: BUILT_ALL_THIS_RUN },
          `${BUILT_ALL_THIS_RUN}.`,
        );
      }
      if (
        !red &&
        building.length === 0 &&
        started === 0 &&
        heldBack.length === 0 &&
        why === undefined
      ) {
        const unready = issues.value.filter((issue) => !issue.ready).length;
        const waiting = issues.value.filter((issue) => issue.ready && !buildable(issue)).length;
        const rest = `Nothing ready to build.${
          unready === 0
            ? ""
            : ` ${plural(unready, "issue needs", "issues need")} a board or a grill.`
        }${
          waiting === 0
            ? ""
            : ` ${plural(waiting, "issue waits", "issues wait")} on another still open.`
        }`;
        return noted({ ...kept, state: "resting", why: rest }, rest);
      }
    }
    if (why === kept.why) return kept;
    const { why: _, ...rest } = kept;
    if (why === undefined) return noted(rest, "Carrying on.");
    return noted({ ...rest, why }, `Holding back: ${why}`);
  };

  /** Runs `change` on a code workspace's Lead, one at a time, and keeps what it gives. */
  const changing = (
    rawId: string,
    change: (
      workspaceId: WorkspaceId,
      kept: Kept | undefined,
    ) => Promise<Result<Kept, LeadProblem>>,
  ) =>
    oneAtATime(async (): Promise<Result<LeadStatus, LeadProblem>> => {
      const workspaceId = await codeWorkspaceOf(rawId);
      if (!workspaceId.ok) return workspaceId;
      const all = await readAll();
      if (!all.ok) return all;
      const changed = await change(workspaceId.value, all.value[workspaceId.value]);
      if (!changed.ok) return changed;
      const kept = await keep(workspaceId.value, changed.value);
      if (!kept.ok) return kept;
      return ok(await statusOf(workspaceId.value, changed.value));
    });

  /** The workspace whose Lead a session is, with its record. */
  const leadOf = async (session: SessionId) => {
    const all = await readAll();
    if (!all.ok) return undefined;
    const found = Object.entries(all.value).find(([, kept]) => kept.session === session);
    const workspaceId = WorkspaceId.safeParse(found?.[0]);
    return found === undefined || !workspaceId.success
      ? undefined
      : { workspaceId: workspaceId.data, kept: found[1] };
  };

  /**
   * Running again: woken, its skips and its count of builds forgotten, its window (#457) opened
   * afresh, and a look straight away.
   */
  const runAgain = async (workspaceId: WorkspaceId, kept: Kept, window?: LeadWindow) => {
    const wakesUntil = windowFrom(kept, window);
    const { why: _, wakesUntil: _was, ...rest } = kept;
    const woken = kept.state === "running" ? rest : await noted(rest, "Running the build order.");
    return look(workspaceId, {
      ...woken,
      state: "running",
      skipped: [],
      startedThisRun: 0,
      ...(wakesUntil === undefined ? {} : { wakesUntil }),
    });
  };

  /** Pausing: builders carry on, nothing new starts. */
  const paused = async (kept: Kept) => {
    if (kept.state === "paused") return kept;
    const { why: _, ...rest } = kept;
    return noted(
      { ...rest, state: "paused" },
      "Paused: nothing new starts until you run the order again.",
    );
  };

  /** Skipping an issue for now: its builder stops and its claim is released (#347). */
  const skip = async (
    workspaceId: WorkspaceId,
    kept: Kept,
    issue: number,
  ): Promise<Result<{ kept: Kept; stopped: boolean }, LeadToolRefusal>> => {
    const builder = kept.built.find((each) => each.issue === issue);
    if (builder === undefined) {
      const issues = await nextUp.list(workspaceId);
      const offered = issues.ok && nextOf(kept, issues.value).some((each) => each.number === issue);
      if (!offered) return err({ kind: "no-such-issue", issue });
      return ok({
        kept: await noted(
          { ...kept, skipped: [...kept.skipped, issue] },
          `Skipped #${issue} for now.`,
        ),
        stopped: false,
      });
    }
    await sessions.stopBuilding(
      builder.session,
      "the owner skipped it for now, through Courtyard's Lead.",
    );
    const skipped = await noted(
      {
        ...kept,
        built: kept.built.filter((each) => each !== builder),
        skipped: [...kept.skipped, issue],
      },
      `Skipped #${issue} for now: its builder is stopped and its claim released.`,
    );
    return ok({ kept: await look(workspaceId, skipped), stopped: true });
  };

  const ToolInput = z.discriminatedUnion("action", [
    z.object({ action: z.literal("pause") }),
    z.object({ action: z.literal("run") }),
    z.object({ action: z.literal("skip"), issue: z.number().int().positive() }),
    z.object({ action: z.literal("builders"), count: z.number().int() }),
  ]);

  return {
    /** A code workspace's Lead, as its Home and its chat show it. */
    status: async (rawId: string): Promise<Result<LeadStatus, LeadProblem>> => {
      const workspaceId = await codeWorkspaceOf(rawId);
      if (!workspaceId.ok) return workspaceId;
      const all = await readAll();
      if (!all.ok) return all;
      return ok(await statusOf(workspaceId.value, all.value[workspaceId.value]));
    },

    /**
     * Run the build order (#347): the Lead's session starts, with the owner's tap as its first
     * message, or wakes, and it looks at once.
     */
    run: (rawId: string, run: LeadRun) =>
      changing(rawId, async (workspaceId, was) => {
        // Allow all for builders (#428), when this tap says: on for the next 12 hours, or off. A
        // wake that doesn't say (the Running row's Run) leaves it as it was.
        const allowing =
          run.allowAll === true
            ? allowAllUntil("task", options.now())
            : run.allowAll === false
              ? undefined
              : was?.allowAllUntil;
        const allowingFrom = ({ allowAllUntil: _, ...rest }: Kept): Kept =>
          allowing === undefined ? rest : { ...rest, allowAllUntil: allowing };
        const kept = was === undefined ? undefined : allowingFrom(was);
        const there = kept === undefined ? undefined : await sessions.get(kept.session);
        if (kept !== undefined && there?.ok === true) {
          return ok(await runAgain(workspaceId, kept, run.window));
        }
        const wakesUntil = windowFrom(kept, run.window);
        const created = await sessions.create({
          workspaceId,
          message: {
            text: RUN_BUILD_ORDER_MESSAGE,
            model: run.model,
            ...(run.effort === undefined ? {} : { effort: run.effort }),
          },
          title: LEAD_TITLE,
          lead: "lead",
        });
        if (!created.ok) return err({ kind: "session", error: created.error });
        const started: Kept = {
          session: created.value.id,
          state: "running",
          builders: kept?.builders ?? LEAD_BUILDERS.byDefault,
          built: kept?.built ?? [],
          skipped: [],
          told: kept?.told ?? [],
          notes: [],
          ...(allowing === undefined ? {} : { allowAllUntil: allowing }),
          ...(wakesUntil === undefined ? {} : { wakesUntil }),
          startedThisRun: 0,
        };
        // Kept at once, so its first turn is told it's the Lead.
        const recorded = await keep(workspaceId, started);
        if (!recorded.ok) return recorded;
        return ok(await look(workspaceId, started));
      }),

    /**
     * Merge in order (#423): the owner's tap is their OK to merge the builders' pull requests
     * their screen showed ready, those still ready now, in the build order's order, and no
     * others. It starts at once, and goes on each
     * time round.
     */
    mergeInOrder: (rawId: string, request: LeadMergeRequest) =>
      changing(rawId, async (workspaceId, kept) => {
        if (kept === undefined) return err({ kind: "session", error: { kind: "not-found" } });
        const listed = await listedIn(workspaceId);
        const ready = buildersOf(kept, listed).ready.filter((each) =>
          request.pullRequests.includes(each.pullRequest),
        );
        if (ready.length === 0) return err({ kind: "nothing-to-merge" });
        const order = ready.map((each) => `#${each.pullRequest}`).join(" → ");
        const merging = await noted(
          {
            ...kept,
            merge: { kind: "merging", queue: ready.map((each) => each.session), conflicting: [] },
          },
          `Merging in order: ${order}.`,
        );
        return ok(await mergeStep(merging, listed));
      }),

    /**
     * Allow all for builders from the Lead's row (#551), while it runs, is paused or rests. On:
     * for the next 12 hours, its builders still building (no pull request yet) allow all until
     * each one's pull request opens, as do any it starts; one allowing all already keeps its own
     * end, and the approvals they wait on that it covers are allowed at once. Off: the builders it
     * gave it to ask again, those the owner switched on themselves don't, and new ones start
     * asking.
     */
    allowAll: (rawId: string, request: LeadAllowAll) =>
      changing(rawId, async (workspaceId, was) => {
        if (was === undefined) return err({ kind: "session", error: { kind: "not-found" } });
        const { allowAllUntil: _, ...kept } = was;
        const builders = allowableOf(was, await listedIn(workspaceId));
        if (!request.on) {
          for (const { session } of was.built) {
            const ended = await sessions.allowAllOffFromLead(session);
            if (!ended.ok)
              console.error("The Lead couldn't end a builder's Allow all", ended.error);
          }
          return ok(await noted(kept, "Allow all for builders is off: its builders ask again."));
        }
        const until = allowAllUntil("12h", options.now());
        for (const { session } of builders) {
          const allowed = await sessions.allowAllFromLead(session, until);
          if (!allowed.ok) console.error("The Lead couldn't allow a builder all", allowed.error);
        }
        return ok(
          await noted(
            { ...kept, allowAllUntil: until },
            `Allow all for builders is on for 12 hours: ${plural(builders.length, "builder", "builders")} now, and any it starts.`,
          ),
        );
      }),

    /** Pause (#347): builders already running carry on, and nothing new starts. */
    pause: (rawId: string) =>
      changing(rawId, async (_, kept) =>
        kept === undefined
          ? err({ kind: "session", error: { kind: "not-found" } })
          : ok(await paused(kept)),
      ),

    /** For the worker's repeating jobs: one look at each code workspace's Lead. */
    watch: async () => {
      const workspaces = await listCodeWorkspaces(options.contextDir);
      if (!workspaces.ok) return;
      for (const { summary } of workspaces.value) {
        await changing(summary.id, async (workspaceId, kept) =>
          kept === undefined
            ? err({ kind: "session", error: { kind: "not-found" } })
            : ok(await look(workspaceId, kept)),
        );
      }
    },

    /**
     * The build order as a Lead's turn is told it. Only a Lead's turn asks, so one whose record
     * isn't there (yet) is told the order is starting.
     */
    brief: async (session: SessionId): Promise<LeadBrief> => {
      const found = await leadOf(session);
      if (found === undefined) {
        return {
          state: "running",
          why: undefined,
          builders: LEAD_BUILDERS.byDefault,
          building: [],
          next: [],
          ready: [],
          notes: [],
        };
      }
      const status = await statusOf(found.workspaceId, found.kept);
      const issueTitle = (builder: LeadBuilder) => builder.title.replace(/^Build #\d+: /, "");
      return {
        state: found.kept.state,
        why: found.kept.why,
        builders: found.kept.builders,
        building: status.building.map((builder) => ({
          issue: builder.issue,
          title: issueTitle(builder),
        })),
        next: status.next.map(({ number, title }) => ({ number, title })),
        ready: status.ready.map((ready) => ({
          issue: ready.issue,
          title: issueTitle(ready),
          pullRequest: ready.pullRequest,
        })),
        notes: found.kept.notes,
      };
    },

    /** The Lead's build order tool (#347): pause, run, skip an issue, or set its builders. */
    tool: async (session: SessionId, input: unknown): Promise<ToolReply> => {
      const parsed = ToolInput.safeParse(input);
      if (!parsed.success) return leadToolReply(err({ kind: "malformed" }));
      const found = await leadOf(session);
      if (found === undefined) return leadToolReply(err({ kind: "malformed" }));
      const call = parsed.data;
      let done: Result<LeadToolDone, LeadToolRefusal> = err({ kind: "malformed" });
      await changing(found.workspaceId, async (workspaceId, kept) => {
        if (kept === undefined) return err({ kind: "session", error: { kind: "not-found" } });
        switch (call.action) {
          case "pause":
            done = ok({ kind: "paused" });
            return ok(await paused(kept));
          case "run":
            done = ok({ kind: "running" });
            return ok(await runAgain(workspaceId, kept));
          case "skip": {
            const skipped = await skip(workspaceId, kept, call.issue);
            if (!skipped.ok) {
              done = skipped;
              return ok(kept);
            }
            done = ok({ kind: "skipped", issue: call.issue, stopped: skipped.value.stopped });
            return ok(skipped.value.kept);
          }
          case "builders": {
            const { count } = call;
            if (count < LEAD_BUILDERS.atLeast || count > LEAD_BUILDERS.atMost) {
              done = err({ kind: "builders", count });
              return ok(kept);
            }
            done = ok({ kind: "builders", count });
            const set = await noted(
              { ...kept, builders: count },
              `${plural(count, "builder runs", "builders run")} at once from now.`,
            );
            return ok(set.state === "running" ? await look(workspaceId, set) : set);
          }
        }
      });
      return leadToolReply(done);
    },
  };
};

export type Lead = ReturnType<typeof createLead>;
