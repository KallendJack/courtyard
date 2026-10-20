import {
  type BumpStanding,
  type CodeSessionList,
  type NeedsYou,
  type NeedYou,
  type OwnerQuestion,
  overflowFrom,
  type PlanUsage,
  type ProviderId,
  type ProviderStatus,
  type ProviderUsage,
  type PullRequest,
  type PullRequestWaiting,
  type SessionEvent,
  type SessionWaiting,
  type TurnNow,
  USAGE_WARNS_AGAIN_AT,
  USAGE_WARNS_AT,
  type UsageWarning,
  type UsageWindow,
  type WorkspaceSummary,
} from "@courtyard/contract";

/**
 * What waits on the owner (#334; AGENTS.md), decided here once for every list, screen and device:
 * a session's approval or new reply, and an open pull request's failing checks, merge or conflict.
 * The web app shows what these say and never works it out itself.
 */

/** How long a session's answer counts as a new reply, waiting on the owner (#301). */
const NEW_REPLY_MS = 24 * 60 * 60 * 1000;

/**
 * A session's latest answer: the event that ended its turn, completed or failed, by number and
 * time, and how it ended: completed; failed at a usage limit, which the Lead carries on (#570);
 * cut off by a restart (#186), which waits for Continue; or failed otherwise (#541).
 */
export type Answer = {
  readonly seq: number;
  readonly at: string;
  readonly ended: "completed" | "limited" | "cut-off" | "failed";
};

/**
 * The answer an event is, when it ends its turn completed or failed; a stopped turn is the
 * owner's own doing, so it's no reply.
 */
const answerOf = (event: SessionEvent): Answer | undefined => {
  if (event.type === "turn-completed") return { seq: event.seq, at: event.at, ended: "completed" };
  if (event.type !== "turn-failed") return undefined;
  const { kind } = event.reason;
  const ended = kind === "interrupted" ? "cut-off" : kind === "rate-limited" ? "limited" : "failed";
  return { seq: event.seq, at: event.at, ended };
};

/**
 * A session's latest answer as its events come, one at a time: `answer`, whether its turn now is
 * a code workspace's Lead reporting (#347), started by the owner's tap on Run the build order or
 * by the worker when a builder's pull request merged: its answer is a report on Home's Running
 * row, not a reply the owner waits for; and the question its model asked the owner since their
 * last message (#541), until they send another.
 */
export type Answered = {
  readonly answer: Answer | undefined;
  readonly reporting: boolean;
  readonly asked: OwnerQuestion | undefined;
};

/** A session with no answer yet. */
export const NOT_ANSWERED: Answered = { answer: undefined, reporting: false, asked: undefined };

export const answeredAfter = (was: Answered, event: SessionEvent): Answered => {
  if (event.type === "owner-message") {
    return {
      // A message answers a turn cut off or failed, even one whose own answer is a Lead's report.
      answer: was.answer === undefined ? undefined : { ...was.answer, ended: "completed" },
      reporting: event.merged !== undefined || event.runsBuildOrder === true,
      asked: undefined,
    };
  }
  if (event.type === "owner-asked") {
    return {
      ...was,
      asked: { text: event.question, choices: event.choices, asked: event.seq },
    };
  }
  const answer = was.reporting ? undefined : answerOf(event);
  return answer === undefined ? was : { ...was, answer };
};

/**
 * What a session waits on the owner for, and while that's until they answer (#541), whether they
 * have seen it and the question it asked.
 */
export type Waiting = {
  readonly waiting: SessionWaiting;
  readonly question?: OwnerQuestion;
  readonly seen?: true;
};

/**
 * What a session waits on the owner for: the approval its turn waits on; else its last turn, cut
 * off by a restart under a day ago (#186), until Continue or a new message, seen or not. Else,
 * with no turn running or waiting for a slot and its pull request not ended, until the owner
 * answers however long it takes and whatever they've read (#541): the question its model asked
 * them; a builder's (a session started on an issue) last turn, failed other than at a usage limit;
 * or a builder stopped with neither a pull request nor a question. Else a Lead's builder its Lead
 * found stalled (#474), until anything new happens in it; else its latest answer, while the owner
 * hasn't seen it (`seen`, the event number its page last showed up to, on any device), it's under
 * a day old, no turn runs or waits for a slot, and it has no pull request (whose own rows say what
 * waits); else nothing.
 */
export const sessionWaiting = (session: {
  now: TurnNow;
  queued: boolean;
  pullRequest: PullRequest | undefined;
  answered: Answered;
  /** It was started on an issue, to build it (#324, #347). */
  builder: boolean;
  /** Its Lead found it stalled, and nothing has happened in it since (#474). */
  stalled: boolean;
  seen: number;
  clock: number;
}): Waiting => {
  if (session.now.kind === "needs-you") return { waiting: "approval" };
  const { answer, asked } = session.answered;
  const recent = answer !== undefined && session.clock - Date.parse(answer.at) < NEW_REPLY_MS;
  const free = session.now.kind === "your-turn" && !session.queued;
  if (free && recent && answer.ended === "cut-off") return { waiting: "cut-off" };
  const { pullRequest } = session;
  if (free && answer !== undefined && (pullRequest === undefined || pullRequest.state === "open")) {
    const seen = answer.seq <= session.seen ? { seen: true as const } : {};
    if (asked !== undefined) return { waiting: "asked", question: asked, ...seen };
    if (session.builder && answer.ended === "failed") return { waiting: "turn-failed", ...seen };
    if (session.builder && answer.ended === "completed" && pullRequest === undefined) {
      return { waiting: "stopped", ...seen };
    }
  }
  if (session.stalled) return { waiting: "stalled" };
  const newReply =
    free && recent && pullRequest === undefined && answer !== undefined && answer.seq > session.seen;
  return { waiting: newReply ? "reply" : "nothing" };
};

/**
 * Needs you's order (#301): builders waiting on the owner, by question, failed turn and stop
 * (#541), then stalled (#474), approvals, turns cut off, failing checks, replies, merges,
 * conflicts.
 */
const NEEDS_ORDER: readonly NeedYou["kind"][] = [
  "asked",
  "turn-failed",
  "stopped",
  "stalled",
  "approval",
  "cut-off",
  "failed",
  "reply",
  "merge",
  "conflict",
];

/**
 * Everything waiting on the owner in every workspace (#492), from each one's listed sessions: what
 * each session waits for, and what its pull request does, in Needs you's order, the newest first
 * in each. A pull request no session opened is its code workspace's own Needs you's to show.
 */
export const needsYouOf = (
  listed: readonly {
    readonly workspace: WorkspaceSummary;
    readonly sessions: CodeSessionList["sessions"];
  }[],
): NeedsYou => {
  const needs = listed.flatMap(({ workspace, sessions }) =>
    sessions.flatMap((session): NeedYou[] => {
      const where = {
        workspace: { id: workspace.id, name: workspace.name },
        session: { id: session.id, title: session.title },
      };
      const since = session.now.kind === "needs-you" ? session.now.since : session.updatedAt;
      const seen = session.seen === undefined ? {} : { seen: session.seen };
      const { waiting, question } = session;
      const own: NeedYou[] =
        waiting === "nothing"
          ? []
          : waiting === "asked"
            ? question === undefined
              ? []
              : [{ kind: "asked", ...where, since, question, ...seen }]
            : [{ kind: waiting, ...where, since, ...seen }];
      const { pullRequest } = session;
      const pull = pullRequest === undefined ? "nothing" : pullRequestWaiting(pullRequest, session);
      if (pullRequest === undefined || pull === "nothing") return own;
      return [
        ...own,
        {
          kind: pull,
          ...where,
          since: session.updatedAt,
          pullRequest: {
            number: pullRequest.number,
            ...(pullRequest.title === undefined ? {} : { title: pullRequest.title }),
          },
        },
      ];
    }),
  );
  return {
    needs: needs.sort(
      (a, b) =>
        NEEDS_ORDER.indexOf(a.kind) - NEEDS_ORDER.indexOf(b.kind) ||
        Date.parse(b.since) - Date.parse(a.since),
    ),
    busy: listed.some(({ sessions }) =>
      sessions.some((session) => session.now.kind !== "your-turn"),
    ),
  };
};

/**
 * A provider's warning put off with Not now (#66): its window, until when (the window's reset),
 * and how much of it was used then, so passing `USAGE_WARNS_AGAIN_AT` brings it back once.
 */
export type PutOff = {
  readonly provider: ProviderId;
  readonly window: UsageWindow;
  readonly until: number;
  readonly used: number;
};

/** The most warnings shown at once: one line per provider on Home, at most two (#66). */
const MOST_WARNINGS = 2;

/** A plan's fullest window it knows, or nothing for no plan or none known. */
export const fullestOf = (usage: PlanUsage) => {
  if (usage.kind === "no-plan") return undefined;
  let fullest: { window: UsageWindow; used: number; resetAt?: string } | undefined;
  for (const { window, used, resetAt } of usage.meters) {
    if (used === null || (fullest !== undefined && fullest.used >= used)) continue;
    fullest = { window, used, ...(resetAt === undefined ? {} : { resetAt }) };
  }
  return fullest;
};

/** Whether a warning on `window` at `used` stays put off by the owner's Not now. */
const isPutOff = (
  putOff: readonly PutOff[],
  warning: { provider: ProviderId; window: UsageWindow; used: number },
  clock: number,
) =>
  putOff.some(
    (each) =>
      each.provider === warning.provider &&
      each.window === warning.window &&
      clock < each.until &&
      !(warning.used >= USAGE_WARNS_AGAIN_AT && each.used < USAGE_WARNS_AGAIN_AT),
  );

/**
 * The warnings before a limit (#66), fullest first, at most two: each provider whose fullest
 * window is past `USAGE_WARNS_AT`, unless the owner put it off (Not now) until it resets or passes
 * `USAGE_WARNS_AGAIN_AT`. Each offers Switch to the first other provider that's connected with
 * room (as Carry on would go), saying that one's own fullest window when it's past
 * `USAGE_WARNS_AT` too. A provider at its limit with nowhere to switch has none: the limit card
 * after its turn says so.
 */
export const usageWarnings = (state: {
  readonly usage: readonly ProviderUsage[];
  readonly statuses: readonly ProviderStatus[];
  readonly putOff: readonly PutOff[];
  readonly clock: number;
}): UsageWarning[] => {
  const fullest = new Map(state.usage.map((each) => [each.provider, fullestOf(each.usage)]));
  const full = (provider: ProviderId) => (fullest.get(provider)?.used ?? 0) >= 100;
  const warnings = state.usage.flatMap((each): UsageWarning[] => {
    const meter = fullest.get(each.provider);
    if (meter === undefined || meter.used < USAGE_WARNS_AT) return [];
    if (isPutOff(state.putOff, { provider: each.provider, ...meter }, state.clock)) return [];
    const overflow = overflowFrom(
      state.statuses.filter((status) => !full(status.id)),
      each.provider,
    );
    if (overflow.kind !== "carry-on" && meter.used >= 100) return [];
    const theirs = overflow.kind === "carry-on" ? fullest.get(overflow.model.provider) : undefined;
    return [
      {
        provider: each.provider,
        label: each.label,
        ...meter,
        ...(overflow.kind === "carry-on"
          ? {
              switchTo: {
                label: overflow.label,
                model: overflow.model,
                ...(theirs !== undefined && theirs.used >= USAGE_WARNS_AT
                  ? { fullest: { window: theirs.window, used: theirs.used } }
                  : {}),
              },
            }
          : {}),
      },
    ];
  });
  return warnings.sort((a, b) => b.used - a.used).slice(0, MOST_WARNINGS);
};

/**
 * What an open pull request waits on the owner for: its conflict with its base, unless its
 * session is bringing it up to date (#382); its failing checks, unless its session is working on
 * them (#172), or it's a Dependabot bump the worker or the Lead has (#496) until it's still
 * failing after the Lead's fix; a merge once its checks pass; else nothing (its checks still
 * running, say).
 */
export const pullRequestWaiting = (
  pullRequest: PullRequest,
  session: { readonly now: TurnNow } | undefined,
  bump?: BumpStanding,
): PullRequestWaiting => {
  if (pullRequest.state !== "open") return "nothing";
  if (pullRequest.conflicts === true) {
    return session?.now.kind === "working" ? "nothing" : "conflict";
  }
  if (bump !== undefined) return bump.kind === "stuck" ? "failed" : "nothing";
  if (pullRequest.checks.kind === "failed") {
    return session?.now.kind === "working" ? "nothing" : "failed";
  }
  return pullRequest.checks.kind === "passed" ? "merge" : "nothing";
};
