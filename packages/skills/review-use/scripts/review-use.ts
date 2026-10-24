import { parseArgs } from "node:util";
import { buildersSection } from "./builders.ts";
import {
  count,
  DAY_MS,
  type Event,
  isRecord,
  type ReviewOptions,
  type Session,
  sessionsIn,
  table,
  type Workspace,
  windowOf,
  workspaceOf,
} from "./logs.ts";

/**
 * Review use's script (#606): real use in a window, read from the data folder's session logs and
 * the context folder's workspace names (`logs.ts`), as the sections the skill's model judges. It
 * reads only `sessions/<session>/session.json` and `events.jsonl` in the data folder and
 * `<workspace>/workspace.json` in the context folder, never a login, a sign-in or a setting, and
 * writes nothing: what it finds goes to its output alone. Plain Node, so it runs from a checkout
 * with nothing installed.
 *
 *   node packages/skills/review-use/scripts/review-use.ts --data <folder> [--context <folder>]
 *     [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 */

/** What an owner message says the worker sent it, not the owner. */
const WORKER_SENT = [
  "checksFailed",
  "conflicted",
  "merged",
  "runsBuildOrder",
  "continues",
  "tasksEnded",
  "carriesOn",
  "afterLimit",
];

/** Whether an event is the owner's own words: a message they sent, or added to a running turn. */
const ownerWords = (event: Event) =>
  (event.type === "owner-message" && !WORKER_SENT.some((key) => key in event)) ||
  (event.type === "message-added" && !("task" in event));

const SAVES = new Set(["context-saved", "document-saved", "thing-saved", "project-saved"]);
const UNDOES = new Set([
  "context-undone",
  "context-edited",
  "document-undone",
  "thing-undone",
  "project-undone",
]);

/** The skills the owner started, by name, with how often: `grilling ×2`. */
const skillsStarted = (events: readonly Event[]) => {
  const started = new Map<string, number>();
  for (const event of events) {
    if (event.type === "owner-message" && typeof event.skill === "string") {
      started.set(event.skill, (started.get(event.skill) ?? 0) + 1);
    }
  }
  return [...started].map(([name, times]) => `${name} ×${times}`).join(", ") || "none";
};

const attachmentsIn = (events: readonly Event[]) =>
  events.reduce(
    (sum, event) =>
      sum +
      (event.type === "owner-message" && Array.isArray(event.attachments)
        ? event.attachments.length
        : 0),
    0,
  );

/** Each workspace's use in the window, one row each. */
const workspacesSection = (
  sessions: readonly Session[],
  workspaces: ReadonlyMap<string, Workspace>,
) => {
  const byWorkspace = Map.groupBy(sessions, (session) => session.workspaceId);
  const rows = [...byWorkspace].map(([id, own]) => {
    const events = own.flatMap((session) => session.events);
    const workspace = workspaces.get(id);
    const mode = workspace?.mode ?? (own.some((session) => session.branch) ? "code" : "planning");
    return [
      workspace?.name ?? id,
      mode,
      own.length,
      count(events, ownerWords),
      skillsStarted(events),
      attachmentsIn(events),
      count(events, (event) => SAVES.has(event.type)),
      count(events, (event) => UNDOES.has(event.type)),
      count(events, (event) => event.type === "approval-requested"),
      count(events, (event) => event.type === "approval-answered" && event.answer === "deny"),
    ];
  });
  return [
    "## Workspaces",
    "",
    table(
      [
        "Workspace",
        "Kind",
        "Sessions",
        "Owner messages",
        "Skills started",
        "Attachments",
        "Saves",
        "Undone or edited",
        "Approvals",
        "Denied",
      ],
      rows,
    ),
  ].join("\n");
};

/** The longest quote, and the most quoted from one session: enough to judge by, never a transcript. */
const QUOTE_MAX = 120;
const QUOTES_PER_SESSION = 3;

/** An owner message on one line, cut at a word to at most `QUOTE_MAX` characters. */
const quote = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= QUOTE_MAX) return `"${line}"`;
  const cut = line.slice(0, QUOTE_MAX);
  const word = cut.lastIndexOf(" ");
  return `"${(word > 0 ? cut.slice(0, word) : cut).trimEnd()}…"`;
};

/** Each workspace's sessions, with how often the owner spoke and their first few messages. */
const saidSection = (sessions: readonly Session[], workspaces: ReadonlyMap<string, Workspace>) => {
  const byWorkspace = Map.groupBy(sessions, (session) => session.workspaceId);
  const parts = [...byWorkspace].flatMap(([id, own]) => {
    const lines = own.flatMap((session) => {
      const words = session.events.filter(ownerWords);
      if (words.length === 0) return [];
      const day = words[0]?.at.slice(0, 10);
      const quotes = words
        .slice(0, QUOTES_PER_SESSION)
        .map((event) => quote(String(event.text ?? "")));
      const messages = `${words.length} message${words.length === 1 ? "" : "s"}`;
      return [`- ${session.title}, ${day} (${messages}): ${quotes.join("; ")}`];
    });
    return lines.length === 0 ? [] : [`### ${workspaces.get(id)?.name ?? id}`, lines.join("\n")];
  });
  return ["## What the owner said", ...parts].join("\n\n");
};

/** Events a signal isn't: an answer's text as it streams, and what the sections above count. */
const NOT_SIGNALS = new Set(["text-delta", "owner-message"]);

/** What an event is a sign of: its type, or for an activity, its kind, skill or connection. */
const signalOf = (event: Event): string | undefined => {
  if (NOT_SIGNALS.has(event.type)) return undefined;
  if (event.type !== "activity" || !isRecord(event.activity)) return event.type;
  const { kind, name, connection } = event.activity;
  if (kind === "skill-loaded" && typeof name === "string") return `skill loaded: ${name}`;
  if (kind === "used-tool" && typeof connection === "string") return `tool: ${connection}`;
  return typeof kind === "string" ? kind : undefined;
};

/** How often each signal came up in planning and code workspaces, most first. */
const signalsSection = (
  sessions: readonly Session[],
  workspaces: ReadonlyMap<string, Workspace>,
) => {
  const counts = new Map<string, { planning: number; code: number }>();
  for (const session of sessions) {
    const mode =
      workspaces.get(session.workspaceId)?.mode ??
      (session.branch === undefined ? "planning" : "code");
    for (const event of session.events) {
      const signal = signalOf(event);
      if (signal === undefined) continue;
      const counted = counts.get(signal) ?? { planning: 0, code: 0 };
      counted[mode] += 1;
      counts.set(signal, counted);
    }
  }
  const rows = [...counts]
    .sort(
      ([a, x], [b, y]) => y.planning + y.code - (x.planning + x.code) || a.localeCompare(b, "en"),
    )
    .map(([signal, { planning, code }]) => [signal, planning, code]);
  return ["## Signals", "", table(["Signal", "Planning", "Code"], rows)].join("\n");
};

/** The review's sections for the window, as Markdown. */
export const reviewUse = async (options: ReviewOptions): Promise<string> => {
  const sessions = await sessionsIn(options);
  const ids = [...new Set(sessions.map((session) => session.workspaceId))];
  const workspaces = new Map(
    await Promise.all(ids.map(async (id) => [id, await workspaceOf(options.context, id)] as const)),
  );
  return [
    `# Use, ${options.since} to ${options.until}`,
    workspacesSection(sessions, workspaces),
    saidSection(sessions, workspaces),
    signalsSection(sessions, workspaces),
    buildersSection(sessions, Math.min(windowOf(options).to, Date.now())),
  ].join("\n\n");
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      data: { type: "string" },
      context: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
    },
  });
  const until = values.until ?? new Date().toISOString().slice(0, 10);
  const since =
    values.since ?? new Date(Date.parse(until) - 13 * DAY_MS).toISOString().slice(0, 10);
  if (values.data === undefined || !DATE.test(since) || !DATE.test(until)) {
    console.error(
      "Usage: node review-use.ts --data <folder> [--context <folder>] [--since YYYY-MM-DD] [--until YYYY-MM-DD]",
    );
    process.exit(1);
  }
  console.log(await reviewUse({ data: values.data, context: values.context, since, until }));
}
