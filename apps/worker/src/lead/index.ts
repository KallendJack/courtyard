import { join } from "node:path";
import {
  buildable,
  CODE_SESSIONS_AT_ONCE,
  type CodeSessionList,
  LEAD_BUILDERS,
  type LeadBuilder,
  type LeadMerge,
  type LeadReady,
  type LeadRun,
  type LeadStatus,
  type NextUpIssue,
  SessionId,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { allowAllUntil } from "../allow-all/index.ts";
import { readJsonFile, writeJsonFile } from "../files.ts";
import type { NextUp } from "../next-up/index.ts";
import { createOneAtATime } from "../one-at-a-time.ts";
import {
  type LeadBrief,
  type LeadToolDone,
  type LeadToolRefusal,
  leadMergedMessage,
  leadToolReply,
  RUN_BUILD_ORDER_MESSAGE,
} from "../prompts/index.ts";
import type { ToolReply } from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";
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

/** A builder's title starts with this when it fixes a red main (#355's issue). */
const MAIN_FIX = /^Main fails:/;

/** A builder the Lead started, and the code files its issue named then (#423). */
const Builder = z.object({
  session: SessionId,
  issue: z.number().int().positive(),
  files: z.array(z.string()).default([]),
});

/** A ready issue the Lead holds back (#423), behind the builder's issue that changes its files. */
const HeldBack = z.object({
  issue: z.number().int().positive(),
  behind: z.number().int().positive(),
});

/**
 * Merge in order (#423), as kept: merging the builders' pull requests in this order, first first,
 * with the heads it has asked a session to bring up to date; or stopped at one, and why.
 */
const Merge = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("merging"),
    queue: z.array(SessionId),
    broughtUp: z.array(z.string()),
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
  heldBack: z.array(HeldBack).optional(),
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

/** Where a builder stands: still building, its pull request ready to merge, or done with. */
const standingOf = (listed: Listed | undefined) => {
  const pullRequest = listed?.pullRequest;
  if (listed === undefined || (pullRequest !== undefined && pullRequest.state !== "open")) {
    return "ended" as const;
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
const sameFile = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

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
    | "stopBuilding"
    | "mergePullRequest"
    | "bringUpToDate"
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

  /** Where the Lead's builders stand, from the sessions listed now. */
  const buildersOf = (kept: Kept | undefined, listed: ReadonlyMap<SessionId, Listed>) => {
    const building: LeadBuilder[] = [];
    const ready: LeadReady[] = [];
    for (const { session, issue } of kept?.built ?? []) {
      const each = listed.get(session);
      const standing = standingOf(each);
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

  /** The next ready issues the Lead would start, leaving out what it builds and what's skipped. */
  const nextOf = (kept: Kept | undefined, issues: readonly NextUpIssue[]) =>
    issues.filter(
      (issue) =>
        buildable(issue) &&
        !(kept?.heldBack ?? []).some((held) => held.issue === issue.number) &&
        !(kept?.skipped ?? []).includes(issue.number) &&
        !(kept?.built ?? []).some((builder) => builder.issue === issue.number),
    );

  /** Merge in order as the owner sees it (#423): the pull request it's on, or where it stopped. */
  const mergeOf = (
    merge: Merge | undefined,
    listed: ReadonlyMap<SessionId, Listed>,
  ): LeadMerge | undefined => {
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
      const stop = (why: string, fixing: boolean) =>
        noted(
          { ...done, merge: { kind: "stopped", pullRequest: pull.number, why } },
          [
            `Stopped at #${pull.number}: ${why}.`,
            ...(fixing ? ["Its session is looking at it."] : []),
            ...(waiting.length === 0
              ? []
              : [`${waiting.join(" and ")} ${waiting.length === 1 ? "waits" : "wait"}.`]),
            `Once it's ${fixing ? "green" : "sorted"}, tap Merge in order again.`,
          ].join(" "),
        );
      const { checks } = pull;
      if (checks.kind === "failed") {
        return stop(
          `its ${namesOf(checks.failed)} ${checks.failed.length === 1 ? "check" : "checks"} failed`,
          true,
        );
      }
      if (pull.conflicts === true) {
        if (merge.broughtUp.includes(pull.head)) {
          return each?.busy === true
            ? kept
            : stop(
                "it still conflicts with main after its session tried to bring it up to date",
                false,
              );
        }
        const asked = await sessions.bringUpToDate(first);
        if (!asked.ok)
          return stop(
            "it conflicts with main, and its session couldn't be asked to bring it up to date",
            false,
          );
        return noted(
          { ...kept, merge: { ...merge, broughtUp: [...merge.broughtUp, pull.head] } },
          `Bringing #${pull.number} up to date first.`,
        );
      }
      if (checks.kind === "running" || each?.busy === true) return kept;
      const merged = await sessions.mergePullRequest(first, pull.head);
      if (!merged.ok) return stop(mergeRefused(merged.error), false);
      kept = { ...kept, merge: { ...merge, queue: rest } };
      if (rest.length > 0) return kept;
    }
  };

  const statusOf = async (
    workspaceId: WorkspaceId,
    kept: Kept | undefined,
  ): Promise<LeadStatus> => {
    const [listed, issues] = await Promise.all([listedIn(workspaceId), nextUp.list(workspaceId)]);
    const { building, ready } = buildersOf(kept, listed);
    const allowing = allowAllUntilOf(kept);
    const merge = mergeOf(kept?.merge, listed);
    return {
      state: kept?.state ?? "not-started",
      ...(kept === undefined ? {} : { session: kept.session }),
      ...(kept?.why === undefined ? {} : { why: kept.why }),
      builders: kept?.builders ?? LEAD_BUILDERS.byDefault,
      building,
      next: nextOf(kept, issues.ok ? issues.value : []).slice(0, 2),
      ready,
      ...(allowing === undefined ? {} : { buildersAllowedAll: allowing }),
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
   * One look at a running Lead: what's new about its builders, then whether it holds back, then a
   * builder for each next free issue up to its number, or a rest when nothing is ready to build.
   */
  const look = async (workspaceId: WorkspaceId, was: Kept): Promise<Kept> => {
    const listed = await listedIn(workspaceId);
    let kept = await mergeStep(await watchBuilders(was, listed), listed);
    if (kept.state !== "running") return kept;
    const { building } = buildersOf(kept, listed);
    const deciding = building.find(
      (builder) => listed.get(builder.session)?.waiting === "approval",
    );
    const red = deciding === undefined && (await options.mainRed(workspaceId));
    const updating = options.updating?.() === true;
    let why =
      deciding !== undefined
        ? `${nameOf(listed.get(deciding.session), deciding.issue)} waits on your decision.`
        : updating
          ? "Courtyard waits to update, so the next builder starts after it."
          : red
            ? "main is red, so only its fix starts."
            : undefined;
    let started = 0;
    let free = kept.builders - building.length;
    // What's held back is worked out afresh each time a builder could start.
    const { heldBack: _held, ...unheld } = kept;
    kept = unheld;
    if (deciding === undefined && !updating && free > 0) {
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
      const heldBack: z.infer<typeof HeldBack>[] = [];
      for (const issue of next) {
        if (free === 0) break;
        const files = [...(named.get(issue.number) ?? [])];
        const clash = changing
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
          },
          `Started building ${issue.title} (#${issue.number}).`,
        );
        changing.push({ issue: issue.number, files });
        started += 1;
        free -= 1;
      }
      if (heldBack.length > 0) kept = { ...kept, heldBack };
      if (!red && building.length === 0 && started === 0 && why === undefined) {
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

  /** Running again: woken, its skips forgotten, and a look straight away. */
  const runAgain = async (workspaceId: WorkspaceId, kept: Kept) => {
    const { why: _, ...rest } = kept;
    const woken = kept.state === "running" ? rest : await noted(rest, "Running the build order.");
    return look(workspaceId, { ...woken, state: "running", skipped: [] });
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
        if (kept !== undefined && there?.ok === true) return ok(await runAgain(workspaceId, kept));
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
        };
        // Kept at once, so its first turn is told it's the Lead.
        const recorded = await keep(workspaceId, started);
        if (!recorded.ok) return recorded;
        return ok(await look(workspaceId, started));
      }),

    /**
     * Merge in order (#423): the owner's tap is their OK to merge the builders' pull requests
     * ready now, in the build order's order, and no others. It starts at once, and goes on each
     * time round.
     */
    mergeInOrder: (rawId: string) =>
      changing(rawId, async (workspaceId, kept) => {
        if (kept === undefined) return err({ kind: "session", error: { kind: "not-found" } });
        const listed = await listedIn(workspaceId);
        const { ready } = buildersOf(kept, listed);
        if (ready.length === 0) return err({ kind: "nothing-to-merge" });
        const order = ready.map((each) => `#${each.pullRequest}`).join(" → ");
        const merging = await noted(
          {
            ...kept,
            merge: { kind: "merging", queue: ready.map((each) => each.session), broughtUp: [] },
          },
          `Merging in order: ${order}.`,
        );
        return ok(await mergeStep(merging, listed));
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
