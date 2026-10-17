import {
  type CodeSessionList,
  type KeptConversation,
  type KeptWorkspace,
  OFFLINE_CONVERSATIONS,
  type OfflineCopy,
  type SessionEvent,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { err, ok, type Result } from "../../lib/result.ts";
import { listDocuments } from "../documents/index.ts";
import { readOwnerContext } from "../owner-context/index.ts";
import type { Sessions } from "../sessions/index.ts";
import { readThings } from "../things/index.ts";
import { listWorkspaces, type WorkspaceError } from "../workspaces/index.ts";

/** The events a kept conversation keeps: the owner's messages, the answers, the saves, and each turn's end. */
const KEPT_EVENTS: ReadonlySet<SessionEvent["type"]> = new Set([
  "owner-message",
  "text-delta",
  "context-saved",
  "context-undone",
  "context-edited",
  "turn-completed",
  "turn-stopped",
  "turn-failed",
]);

/**
 * Whether an event that isn't kept stood between two pieces of an answer, which the session page
 * shows as paragraphs of their own: what the model did, a helper it started, a message the owner
 * added, or a task's end.
 */
const breaksText = (event: SessionEvent) =>
  event.type === "activity" ||
  event.type === "helper-started" ||
  event.type === "task-ended" ||
  (event.type === "message-added" && event.task === undefined);

/**
 * A session's conversation as the offline copy keeps it (#106): only the events that draw the
 * owner's messages, the answers and the saves, each answer's text joined into as few pieces as it
 * can be. Where something the model did split its text, the pieces stay paragraphs of their own.
 */
export const conversationIn = (events: readonly SessionEvent[]): SessionEvent[] => {
  const kept: SessionEvent[] = [];
  /** Whether the turn has text yet, and whether something not kept broke it since. */
  let hasText = false;
  let broken = false;
  for (const event of events) {
    if (!KEPT_EVENTS.has(event.type)) {
      if (hasText && breaksText(event)) broken = true;
      continue;
    }
    if (event.type === "owner-message") {
      hasText = false;
      broken = false;
    }
    if (event.type !== "text-delta") {
      kept.push(event);
      continue;
    }
    const before = kept.at(-1);
    const text = broken && !/\n\n$/.test(lastText(kept)) ? `\n\n${event.text}` : event.text;
    hasText = true;
    broken = false;
    if (before?.type === "text-delta") {
      kept[kept.length - 1] = { ...before, text: before.text + text };
    } else {
      kept.push({ ...event, text });
    }
  }
  return kept;
};

/** The text a turn's answer ends with so far, from the last kept piece of it. */
const lastText = (kept: readonly SessionEvent[]) => {
  for (let at = kept.length - 1; at >= 0; at -= 1) {
    const event = kept[at];
    if (event?.type === "text-delta") return event.text;
    if (event?.type === "owner-message") return "";
  }
  return "";
};

type Listed = CodeSessionList["sessions"][number];

/**
 * A session as the copy lists it: calm, since what waits on the owner (an approval, a new reply,
 * a pull request) isn't kept and can't be acted on offline.
 */
const calm = (session: Listed): Listed => {
  const { pullRequest: _, ...rest } = session;
  return { ...rest, now: { kind: "your-turn" }, waiting: "nothing", queued: false };
};

/** Why there's no copy: the context folder, or a session's log, couldn't be read. */
export type OfflineCopyError =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  | { readonly kind: "storage"; readonly message: string };

/**
 * The offline copy (#106), decided once, here: everything a device that keeps one stores to read
 * while the worker can't be reached. The device keeps it whole and read-only; the worker keeps no
 * list of the devices that hold one.
 */
export const createOfflineCopy = (options: {
  contextDir: string;
  sessions: Sessions;
  /** A workspace's page's detail, as `GET /api/workspaces/:id` gives it. */
  detail: (workspace: WorkspaceSummary) => Promise<Result<WorkspaceDetail, WorkspaceError>>;
  now: () => number;
}) => {
  const { contextDir, sessions } = options;

  /** How many Things and documents a planning workspace has: none are kept, but its tabs say so. */
  const notKeptIn = async (workspace: WorkspaceSummary) => {
    if (workspace.mode !== "planning") return { things: 0, documents: 0 };
    const target = { contextDir, workspaceId: workspace.id };
    const [things, documents] = await Promise.all([readThings(target), listDocuments(target)]);
    return {
      things: things.ok ? things.value.things.length : 0,
      documents: documents.ok ? documents.value.length : 0,
    };
  };

  const keptWorkspace = async (
    workspace: WorkspaceSummary,
  ): Promise<Result<KeptWorkspace, OfflineCopyError>> => {
    const [detail, listed, notKept] = await Promise.all([
      options.detail(workspace),
      sessions.list(workspace.id),
      notKeptIn(workspace),
    ]);
    if (!detail.ok) return err({ kind: "workspace", error: detail.error });
    if (!listed.ok) return err({ kind: "storage", message: "Its sessions can't be read." });
    const latest = [...listed.value]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, OFFLINE_CONVERSATIONS);
    const conversations: KeptConversation[] = [];
    for (const session of latest) {
      const events = await sessions.events(session.id);
      if (!events.ok) return err({ kind: "storage", message: "A session's log can't be read." });
      const { now: _, waiting: __, queued: ___, pullRequest: ____, ...summary } = session;
      conversations.push({
        session: { ...summary, workspaceArchived: false },
        events: conversationIn(events.value),
      });
    }
    return ok({
      detail: detail.value,
      sessions: { sessions: listed.value.map(calm), running: 0 },
      conversations,
      notKept,
    });
  };

  return {
    copy: async (): Promise<Result<OfflineCopy, OfflineCopyError>> => {
      const at = new Date(options.now()).toISOString();
      const [workspaces, owner] = await Promise.all([
        listWorkspaces(contextDir),
        readOwnerContext(contextDir),
      ]);
      if (!workspaces.ok) return err({ kind: "workspace", error: workspaces.error });
      if (!owner.ok) return err({ kind: "workspace", error: owner.error });
      const kept: KeptWorkspace[] = [];
      for (const workspace of workspaces.value) {
        const one = await keptWorkspace(workspace);
        if (!one.ok) return one;
        kept.push(one.value);
      }
      return ok({
        at,
        ownerContext: { ownerContext: owner.value?.ownerContext ?? null },
        workspaces: { workspaces: workspaces.value },
        kept,
      });
    },
  };
};

export type OfflineCopyMaker = ReturnType<typeof createOfflineCopy>;
