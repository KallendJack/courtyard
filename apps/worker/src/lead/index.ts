import { join } from "node:path";
import {
  CODE_SESSIONS_AT_ONCE,
  type CodeSessionList,
  LEAD_BUILDERS,
  type LeadBuilder,
  type LeadReady,
  type LeadRun,
  type LeadStatus,
  type NextUpIssue,
  SessionId,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
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
import {
  getWorkspace,
  listCodeWorkspaces,
  type WorkspaceError,
} from "../workspaces/index.ts";

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

const Builder = z.object({ session: SessionId, issue: z.number().int().positive() });

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
});
type Kept = z.infer<typeof Kept>;

const LeadsFile = z.object({ leads: z.record(z.string(), Kept) });

/** Why a Lead couldn't be read or run. */
export type LeadProblem =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  | { readonly kind: "not-code" }
  | { readonly kind: "session"; readonly error: SessionError }
  | { readonly kind: "storage" };

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

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

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
    | "stopTurn"
  >;
  nextUp: Pick<NextUp, "list" | "fresh" | "build" | "release">;
  /** Whether a code workspace's main is red now (#355), by its id. */
  mainRed: (workspaceId: WorkspaceId) => Promise<boolean>;
  /** Tells the owner, on their devices, what a session needs (#173): "Ready to merge". */
  notify: (session: SessionId, need: string) => void;
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

  /** The next ready issues the Lead would start, leaving out what it builds and what's skipped. */
  const nextOf = (kept: Kept | undefined, issues: readonly NextUpIssue[]) =>
    issues.filter(
      (issue) =>
        issue.ready &&
        !(kept?.skipped ?? []).includes(issue.number) &&
        !(kept?.built ?? []).some((builder) => builder.issue === issue.number),
    );

  const statusOf = async (
    workspaceId: WorkspaceId,
    kept: Kept | undefined,
  ): Promise<LeadStatus> => {
    const [listed, issues] = await Promise.all([listedIn(workspaceId), nextUp.list(workspaceId)]);
    const { building, ready } = buildersOf(kept, listed);
    return {
      state: kept?.state ?? "not-started",
      ...(kept === undefined ? {} : { session: kept.session }),
      ...(kept?.why === undefined ? {} : { why: kept.why }),
      builders: kept?.builders ?? LEAD_BUILDERS.byDefault,
      building,
      next: nextOf(kept, issues.ok ? issues.value : []).slice(0, 2),
      ready,
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
        if (told.ok) await tellOnce(`merged:${session}`, `${name} merged (#${pullRequest.number}).`);
      }
    }
    const done = (builder: z.infer<typeof Builder>) => {
      const each = listed.get(builder.session);
      if (standingOf(each) !== "ended") return false;
      // A merged one stays until the Lead has been told.
      return each?.pullRequest?.state !== "merged" || now.told.includes(`merged:${builder.session}`);
    };
    return { ...now, built: now.built.filter((builder) => !done(builder)) };
  };

  /**
   * One look at a running Lead: what's new about its builders, then whether it holds back, then a
   * builder for each next free issue up to its number, or a rest when nothing is ready to build.
   */
  const look = async (workspaceId: WorkspaceId, was: Kept): Promise<Kept> => {
    const listed = await listedIn(workspaceId);
    let kept = await watchBuilders(was, listed);
    if (kept.state !== "running") return kept;
    const { building } = buildersOf(kept, listed);
    const deciding = building.find(
      (builder) => listed.get(builder.session)?.waiting === "approval",
    );
    const red = deciding === undefined && (await options.mainRed(workspaceId));
    let why =
      deciding !== undefined
        ? `${nameOf(listed.get(deciding.session), deciding.issue)} waits on your decision.`
        : red
          ? "main is red, so only its fix starts."
          : undefined;
    let started = 0;
    let free = kept.builders - building.length;
    if (deciding === undefined && free > 0) {
      const issues = await nextUp.fresh(workspaceId);
      if (!issues.ok) return kept;
      const next = nextOf(kept, issues.value).filter((issue) => !red || MAIN_FIX.test(issue.title));
      for (const issue of next) {
        if (free === 0) break;
        // One place always stays free for the owner's own sessions.
        if (sessions.codeRunning() >= CODE_SESSIONS_AT_ONCE - 1) {
          why ??= "your own sessions are using the machine, so the next builder waits.";
          break;
        }
        const model = await sessions.lastModelOf(kept.session);
        if (model === undefined) break;
        const built = await nextUp.build(workspaceId, issue.number, { ...model, byLead: true });
        if (!built.ok) {
          // Claimed by someone else meanwhile: the next one, then.
          if (built.error.kind === "claimed" || built.error.kind === "no-such-issue") continue;
          console.error(`The Lead couldn't start #${issue.number}`, built.error);
          break;
        }
        kept = await noted(
          { ...kept, built: [...kept.built, { session: built.value.id, issue: issue.number }] },
          `Started building ${issue.title} (#${issue.number}).`,
        );
        started += 1;
        free -= 1;
      }
      if (!red && building.length === 0 && started === 0 && why === undefined) {
        const unready = issues.value.filter((issue) => !issue.ready).length;
        const rest = `Nothing ready to build.${
          unready === 0
            ? ""
            : ` ${plural(unready, "issue needs", "issues need")} a board or a grill.`
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
    change: (workspaceId: WorkspaceId, kept: Kept | undefined) => Promise<Result<Kept, LeadProblem>>,
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
    const woken =
      kept.state === "running" ? rest : await noted(rest, "Running the build order.");
    return look(workspaceId, { ...woken, state: "running", skipped: [] });
  };

  /** Pausing: builders carry on, nothing new starts. */
  const paused = async (kept: Kept) => {
    if (kept.state === "paused") return kept;
    const { why: _, ...rest } = kept;
    return noted({ ...rest, state: "paused" }, "Paused: nothing new starts until you run the order again.");
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
    await sessions.stopTurn(builder.session);
    const released = await nextUp.release(
      workspaceId,
      issue,
      "the owner skipped it for now, through Courtyard's Lead.",
    );
    if (!released.ok) console.error(`#${issue}'s claim couldn't be released`, released.error);
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
      changing(rawId, async (workspaceId, kept) => {
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
        };
        // Kept at once, so its first turn is told it's the Lead.
        const recorded = await keep(workspaceId, started);
        if (!recorded.ok) return recorded;
        return ok(await look(workspaceId, started));
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
