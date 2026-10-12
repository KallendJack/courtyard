import {
  CODE_SESSIONS_AT_ONCE,
  type CodeSessionList,
  type SessionSummary,
  type WorkspaceMode,
} from "@courtyard/contract";
import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { CARD, LIST_ROW, SectionTitle } from "@/components/page";
import { ListedSessionText } from "@/components/session-state";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { describeWhen } from "../when.ts";
import { deleteSession } from "../worker.ts";

/** A session whose pull request was merged or closed has ended (#278). */
export const sessionEnded = (session: CodeSessionList["sessions"][number]) =>
  session.pullRequest !== undefined && session.pullRequest.state !== "open";

/**
 * The workspace's sessions, latest first, each saying whose turn it is (#179). In a code
 * workspace, how many code sessions are running across the worker, and any session waiting for one
 * of them to end, which can be removed (#174). A planning workspace's page shows them as a card; a
 * code workspace's, on its Sessions tab (#301).
 */
export function SessionLinks(props: { list: CodeSessionList; mode: WorkspaceMode }) {
  const { sessions, running } = props.list;
  if (sessions.length === 0) return null;
  // A session whose pull request was merged or closed has ended: it leaves the sessions for
  // History, so its place is free for a new one (#278).
  const current = sessions.filter((session) => !sessionEnded(session));
  const history = sessions.filter(sessionEnded);
  return (
    <>
      {current.length > 0 && (
        <section aria-label="Sessions" className={CARD}>
          <div className="flex items-baseline justify-between gap-4">
            <SectionTitle>Sessions</SectionTitle>
            {props.mode === "code" && (
              <span className="text-meta text-muted-foreground">
                {running} of {CODE_SESSIONS_AT_ONCE} code sessions running
              </span>
            )}
          </div>
          <SessionList sessions={current} />
        </section>
      )}
      {history.length > 0 && (
        <section aria-label="History" className={CARD}>
          <SectionTitle>History</SectionTitle>
          <SessionList sessions={history} />
        </section>
      )}
    </>
  );
}

/** Sessions, each a link with whose turn it is, and Remove for one waiting to start. */
function SessionList(props: { sessions: CodeSessionList["sessions"] }) {
  return (
    <ul className="mt-2 divide-y">
      {props.sessions.map((session) => (
        <li key={session.id} className="flex items-center gap-2">
          <Link
            to="/workspaces/$workspaceId/sessions/$sessionId"
            params={{ workspaceId: session.workspaceId, sessionId: session.id }}
            className={classes(LIST_ROW, "min-w-0 flex-1")}
          >
            <ListedSessionText
              title={session.title}
              now={session.now}
              updatedAt={session.updatedAt}
              waitsForSlot={session.queued}
              when={describeWhen}
            />
          </Link>
          {session.queued && <RemoveQueued session={session} />}
        </li>
      ))}
    </ul>
  );
}

/** Remove, for a session waiting to start: it goes, with the message it was waiting to answer. */
function RemoveQueued(props: { session: SessionSummary }) {
  const router = useRouter();
  const remove = useAction(async () => {
    const removed = await deleteSession(props.session.id);
    if (removed.kind !== "loaded") return describeProblem(removed).body;
    await router.invalidate();
    return undefined;
  });
  return (
    <div className="flex shrink-0 flex-col items-end">
      <Button variant="quiet" size="xs" disabled={remove.busy} onClick={() => remove.run()}>
        Remove
      </Button>
      <FormError message={remove.error} />
    </div>
  );
}
