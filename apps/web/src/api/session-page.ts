import {
  type OfflineCopy,
  type ProviderList,
  SessionDetail,
  type SessionEvent,
  type SkillList,
  WorkspaceId,
} from "@courtyard/contract";
import { type FromWorker, fromWorker, NOT_FOUND } from "./worker.ts";
import { loadProviders, loadSkills } from "./worker-calls.ts";

/**
 * A session's page read from the device's copy (#106): when the copy is from, and the events of
 * its conversation, or none when the copy lists the session but doesn't keep its conversation.
 */
export type OfflineSession = {
  readonly at: string;
  readonly events: readonly SessionEvent[] | undefined;
};

/** Everything a session's page shows, and, reading the device's copy, what it keeps of it. */
type SessionPage = {
  readonly session: FromWorker<SessionDetail>;
  readonly providers: FromWorker<ProviderList>;
  readonly skills: FromWorker<SkillList>;
  readonly offline: OfflineSession | undefined;
};

const OFFLINE = { kind: "offline" } as const;

/** A session's page from the device's copy (#106); one the copy doesn't list shows as offline. */
const readSessionPage = (copy: OfflineCopy, sessionId: string): SessionPage => {
  const page = (session: SessionDetail, events: OfflineSession["events"]): SessionPage => ({
    session: { kind: "loaded", data: session },
    providers: OFFLINE,
    skills: OFFLINE,
    offline: { at: copy.at, events },
  });
  for (const { conversations, sessions } of copy.kept) {
    const conversation = conversations.find(({ session }) => session.id === sessionId);
    if (conversation !== undefined) return page(conversation.session, conversation.events);
    const listed = sessions.sessions.find((session) => session.id === sessionId);
    if (listed !== undefined) {
      const { now: _, waiting: __, queued: ___, pullRequest: ____, ...summary } = listed;
      return page({ ...summary, workspaceArchived: false }, undefined);
    }
  }
  return { session: OFFLINE, providers: OFFLINE, skills: OFFLINE, offline: undefined };
};

/**
 * Everything a session's page shows, asked for at once. Its route imports this when the page
 * opens, so neither the code nor the schemas are on the first load (#393). Reading the device's
 * copy (#106), it comes from that instead.
 */
export const loadSessionPage = async (
  params: { workspaceId: string; sessionId: string },
  reading: OfflineCopy | undefined,
): Promise<SessionPage> => {
  if (reading !== undefined) return readSessionPage(reading, params.sessionId);
  const workspaceId = WorkspaceId.safeParse(params.workspaceId);
  const [session, providers, skills] = await Promise.all([
    fromWorker(`/sessions/${encodeURIComponent(params.sessionId)}`, SessionDetail),
    loadProviders(),
    workspaceId.success ? loadSkills(workspaceId.data) : NOT_FOUND,
  ]);
  return { session, providers, skills, offline: undefined };
};
