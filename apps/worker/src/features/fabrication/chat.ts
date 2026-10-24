import type {
  BuildChat,
  BuildChatEntry,
  BuildSlug,
  ProjectSlug,
  SessionEvent,
  SessionSummary,
  WorkspaceId,
} from "@courtyard/contract";
import { ok, type Result } from "../../lib/result.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";

// A Build's chat in Fabrication (#698, ADR 0037): Courtyard backs it with a session in the Build's
// workspace. Fabrication's API reads it as Fabrication's own shape, so the app never reads a
// session's events, and a standalone Fabrication could keep its chat its own way.

/** How many of a workspace's latest sessions are read for one that saved the Build. */
const READ_AT_MOST = 20;

/**
 * The session a Build's chat is in: its project's latest (one started in Courtyard from the
 * project counts too), or else the latest that saved the Build; none until there's one.
 */
export const chatSessionOf = async (
  sessions: Pick<Sessions, "list" | "events">,
  build: { workspaceId: WorkspaceId; slug: BuildSlug; project: ProjectSlug | undefined },
): Promise<Result<SessionSummary | undefined, SessionError>> => {
  const listed = await sessions.list(build.workspaceId);
  if (!listed.ok) return listed;
  const newest = [...listed.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (build.project !== undefined) {
    const projects = newest.find((session) => session.project === build.project);
    if (projects !== undefined) return ok(projects);
  }
  for (const session of newest.slice(0, READ_AT_MOST)) {
    const events = await sessions.events(session.id);
    if (!events.ok) return events;
    const saved = events.value.some(
      (event) => event.type === "build-saved" && event.save.build.slug === build.slug,
    );
    if (saved) return ok(session);
  }
  return ok(undefined);
};

/** A changed parameter's name, from its line in a save ("height: 900 mm → 850 mm"). */
const parameterOf = (change: string) =>
  change.startsWith("Renamed from ") ? "name" : (change.split(":")[0] ?? change);

/**
 * The chat as Fabrication shows it, from the session's events: each thing the owner said, each
 * answer whole, and each save of this Build, marked once undone. What the worker sends on the
 * owner's behalf (a failed check, a conflict) and what a code session's tasks add aren't the
 * owner's words, so they're left out.
 */
export const chatOf = (
  session: SessionSummary,
  events: readonly SessionEvent[],
  slug: BuildSlug,
): BuildChat => {
  const entries: BuildChatEntry[] = [];
  const undone = new Set(
    events.flatMap((event) => (event.type === "build-undone" ? [event.save] : [])),
  );
  let model: BuildChat["model"];
  for (const event of events) {
    const last = entries.at(-1);
    switch (event.type) {
      case "owner-message":
        model = event.model;
        if (event.checksFailed === undefined && event.conflicted === undefined) {
          entries.push({ seq: event.seq, from: "owner", text: event.text });
        }
        break;
      case "message-added":
        if (event.task === undefined) {
          entries.push({ seq: event.seq, from: "owner", text: event.text });
        }
        break;
      case "text-delta":
        if (last?.from === "model") entries[entries.length - 1] = { ...last, text: last.text + event.text };
        else entries.push({ seq: event.seq, from: "model", text: event.text });
        break;
      case "build-saved":
        if (event.save.build.slug !== slug) break;
        entries.push({
          seq: event.seq,
          from: "build",
          did: event.save.action === "add" ? "started" : "changed",
          changed: event.save.changes.map(parameterOf),
          undone: undone.has(event.seq),
        });
        break;
      default:
        break;
    }
  }
  return {
    session: session.id,
    answering: session.busy,
    entries,
    ...(model === undefined ? {} : { model }),
  };
};
