import { count, isRecord, type Session, table } from "./logs.ts";

/** Review use's Builders section: each Lead builder's time in the window, in work and waiting. */

/** Where a builder's time goes, in the Builders table's order. */
const SPANS = [
  "working",
  "checking",
  "waiting its turn",
  "waiting on you",
  "at the limit",
  "idle, no PR",
  "PR waiting",
] as const;
type Span = (typeof SPANS)[number];
/** Of those, the model's own work. */
const WORK: ReadonlySet<Span> = new Set(["working", "checking"]);

/** A heavy check, as the builds queue counts one (#281): a test tool, or a script that tests. */
const HEAVY_CHECK =
  /(?:^|\s)(?:vitest|playwright test|pnpm (?:run )?(?:test|e2e|build|verify)|npm (?:test|run (?:test|e2e|build|verify)))(?:\s|$)/;

const TURN_ENDS = new Set(["turn-completed", "turn-stopped", "turn-failed"]);

type Timeline = {
  readonly spans: Record<Span, number>;
  readonly pullRequest: number | undefined;
  readonly approvals: number;
  readonly carriedOn: number;
};

/**
 * A builder's time in the window, span by span: from each event to the next, by what that event
 * left it doing, until its pull request merged or closed, or the window's end.
 */
const timelineOf = (session: Session, end: number): Timeline => {
  const spans = Object.fromEntries(SPANS.map((span) => [span, 0])) as Record<Span, number>;
  let pullRequest: number | undefined;
  let now: Span | undefined;
  let since = 0;
  let over = false;
  const move = (to: Span | undefined, at: number) => {
    if (now !== undefined) spans[now] += Math.max(0, at - since);
    now = to;
    since = at;
  };
  for (const event of session.events) {
    if (over) break;
    const at = Date.parse(event.at);
    const idle = pullRequest === undefined ? "idle, no PR" : "PR waiting";
    if (event.type === "owner-message" || event.type === "approval-answered") move("working", at);
    else if (event.type === "approval-requested") move("waiting on you", at);
    else if (event.type === "turn-failed") {
      const reason = isRecord(event.reason) ? event.reason.kind : undefined;
      move(reason === "rate-limited" ? "at the limit" : idle, at);
    } else if (TURN_ENDS.has(event.type)) move(idle, at);
    else if (event.type === "pull-request" && isRecord(event.pullRequest)) {
      const { number, state } = event.pullRequest;
      if (typeof number === "number") pullRequest = number;
      if (state === "merged" || state === "closed") {
        move(undefined, at);
        over = true;
      } else if (now === "idle, no PR") move("PR waiting", at);
    } else if (event.type === "activity" && isRecord(event.activity) && now !== undefined) {
      const { kind, command } = event.activity;
      if (kind === "waiting-for-build") move("waiting its turn", at);
      else if (kind === "ran-command" && typeof command === "string" && HEAVY_CHECK.test(command))
        move("checking", at);
      else if (now === "checking" || now === "waiting its turn") move("working", at);
    }
  }
  if (!over) move(undefined, Math.max(since, end));
  const approvals = count(session.events, (event) => event.type === "approval-requested");
  const carriedOn = count(
    session.events,
    (event) => event.type === "owner-message" && event.carriesOn === true,
  );
  return { spans, pullRequest, approvals, carriedOn };
};

const MINUTE_MS = 60 * 1000;

/** A length of time to the minute: `10 min`, `2 h`, `1 h 10 min`. */
const lasting = (ms: number) => {
  const minutes = Math.round(ms / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

/** Each Lead builder's time, in work and waiting, with every builder's together after them. */
export const buildersSection = (sessions: readonly Session[], end: number) => {
  const builders = sessions.filter((session) => session.byLead === true);
  if (builders.length === 0) return "## Builders\n\nNo Lead builder ran in the window.";
  const timelines = builders.map((builder) => ({ builder, ...timelineOf(builder, end) }));
  const row = (timeline: Timeline) => [
    ...SPANS.map((span) => lasting(timeline.spans[span])),
    timeline.approvals,
    timeline.carriedOn,
  ];
  const all: Timeline = {
    spans: Object.fromEntries(
      SPANS.map((span) => [span, timelines.reduce((sum, t) => sum + t.spans[span], 0)]),
    ) as Record<Span, number>,
    pullRequest: undefined,
    approvals: timelines.reduce((sum, t) => sum + t.approvals, 0),
    carriedOn: timelines.reduce((sum, t) => sum + t.carriedOn, 0),
  };
  const withPullRequest = timelines.filter((t) => t.pullRequest !== undefined).length;
  const rows = [
    ...timelines.map((t) => [
      t.builder.title,
      t.builder.claim === undefined ? "–" : `#${t.builder.claim.issue}`,
      t.pullRequest === undefined ? "–" : `#${t.pullRequest}`,
      ...row(t),
    ]),
    ["All builders", builders.length, withPullRequest, ...row(all)],
  ];
  const work = SPANS.reduce((sum, span) => sum + (WORK.has(span) ? all.spans[span] : 0), 0);
  const total = SPANS.reduce((sum, span) => sum + all.spans[span], 0);
  const share = total === 0 ? 0 : Math.round((work / total) * 100);
  const head = [
    "Builder",
    "Issue",
    "PR",
    ...SPANS.map((span) => span[0]?.toUpperCase() + span.slice(1)),
  ];
  return [
    "## Builders",
    "",
    table([...head, "Approvals", "Carried on"], rows),
    "",
    `Model work (working and checking): ${lasting(work)} of ${lasting(total)} (${share}%).`,
  ].join("\n");
};
