import type { SessionDetail } from "@courtyard/contract";
import { Page, PageTitle } from "@courtyard/ui/layout/page.tsx";
import { useMemo } from "react";
import { BackLink } from "@/components/buttons/back-link";
import { NotKept, OfflineLine } from "@/components/layout/offline";
import type { OfflineSession } from "../../api/session-page.ts";
import { turnsIn } from "../sessions/turns/events.ts";
import { SessionTurns } from "../sessions/turns/session-turns.tsx";

/** Nothing is queued in a session read offline, so there's nothing to remove. */
const NOTHING_QUEUED = async () => undefined;

/**
 * A session read from the device's copy (#106; Paper, "Cover · Session, offline"): the same page,
 * read-only. Its conversation as the copy keeps it, or one quiet line when the copy lists the
 * session but doesn't keep it; in place of the Reply box, the grey line saying it's a copy.
 */
export function ReadSession(props: { session: SessionDetail; offline: OfflineSession }) {
  const { session, offline } = props;
  const { events } = offline;
  const turns = useMemo(() => (events === undefined ? undefined : turnsIn(events)), [events]);
  const header = (
    <PageTitle above={<BackLink workspaceId={session.workspaceId} button />}>
      {session.title}
    </PageTitle>
  );
  const footer = (
    <div className="pt-2 pb-3 md:pb-6">
      <OfflineLine at={offline.at} />
    </div>
  );
  return (
    <Page header={header} footer={footer}>
      {turns === undefined ? (
        <div className="mt-6">
          <NotKept />
        </div>
      ) : (
        <SessionTurns
          sessionId={session.id}
          turns={turns}
          providers={[]}
          workspaceId={session.workspaceId}
          queuedMessages={[]}
          onRemoveQueued={NOTHING_QUEUED}
          offline
        />
      )}
    </Page>
  );
}
