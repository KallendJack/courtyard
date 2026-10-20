import {
  CODE_SESSIONS_AT_ONCE,
  type CodeSessionList,
  type SessionId,
  type SessionSummary,
  type WorkspaceMode,
} from "@courtyard/contract";
import { Link, useRouter } from "@tanstack/react-router";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/buttons/button";
import { ListedSessionText } from "@/components/chat/session-state";
import { SuggestedReplies } from "@/components/chat/suggested-replies";
import { ByLead, LeadMark } from "@/components/code/lead-mark";
import { FormError } from "@/components/forms/form-error";
import { CapsLabel } from "@/components/layout/caps-label";
import { CARD, LIST_ROW, SectionTitle } from "@/components/layout/page";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { deleteSession, markAllRead } from "../../api/worker.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { describeWhen } from "../../lib/when.ts";
import { heldWords, waitingFirst, waitsUntilAnswered } from "../code-home/needs.ts";
import { KEPT_SESSIONS, loadSessions } from "./kept-sessions.ts";

type Listed = CodeSessionList["sessions"][number];

/** A session whose pull request was merged or closed has ended (#278). */
export const sessionEnded = (session: Listed) =>
  session.pullRequest !== undefined && session.pullRequest.state !== "open";

/** The next steps a session's last answer suggested, each replying in it with a tap (#565). */
export type NextSteps = {
  readonly session: SessionId;
  readonly replies: readonly string[];
  /** Sends one as the owner's message in that session: whether it was sent. */
  readonly pick: (reply: string) => Promise<boolean>;
};

/**
 * The workspace's sessions, latest first, each saying whose turn it is (#179); those waiting on the
 * owner come first, marked for a new reply or an approval, with Mark all read while any new reply
 * waits (#345). In a code workspace, how many code sessions are running across the worker, and any
 * session waiting for one of them to end, which can be removed (#174). A planning workspace's page
 * shows them as a card, its latest session with the next steps its last answer suggested (#565);
 * a code workspace's, on its Sessions tab (#301), its Lead pinned at the top with its mark and its
 * builders marked "by Lead" (#347).
 */
export function SessionLinks(props: {
  list: CodeSessionList;
  mode: WorkspaceMode;
  /**
   * Read from the device's copy (#106): the sessions whose conversations it keeps. The rest stay
   * listed, faint, and say they're not kept; nothing says whose turn it is or what's running.
   */
  kept?: ReadonlySet<SessionId>;
  /** A planning workspace's latest session's next steps, under its row. */
  nextSteps?: NextSteps;
}) {
  const { sessions, running } = props.list;
  const { kept, nextSteps } = props;
  if (sessions.length === 0) return null;
  // A session whose pull request was merged or closed has ended: it leaves the sessions for
  // History, so its place is free for a new one (#278).
  const open = sessions.filter((session) => !sessionEnded(session));
  // A code workspace's Lead stays pinned at the top (#347), then those waiting on the owner until
  // they answer in a gold group of their own (#541).
  const leads = open.filter((session) => session.lead === true);
  const held = open.filter((session) => session.lead !== true && waitsUntilAnswered(session));
  const rest = waitingFirst(
    open.filter((session) => session.lead !== true && !waitsUntilAnswered(session)),
  );
  const current = [...leads, ...held, ...rest];
  const history = sessions.filter(sessionEnded);
  const replies = current.some((session) => session.waiting === "reply");
  return (
    <>
      {current.length > 0 && (
        <section aria-label="Sessions" className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <SectionTitle>Sessions</SectionTitle>
            <div className="flex items-center gap-3">
              {props.mode === "code" && kept === undefined && (
                <span className="text-meta text-muted-foreground">
                  {running} of {CODE_SESSIONS_AT_ONCE} code sessions running
                </span>
              )}
              {replies && <MarkAllRead workspaceId={sessions[0]?.workspaceId} />}
            </div>
          </div>
          {held.length > 0 && kept === undefined ? (
            <>
              {leads.length > 0 && <SessionList sessions={leads} kept={kept} />}
              <section aria-label="Waiting on you" className="mt-3 flex flex-col">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <CapsLabel tone="warning" heading={{ level: 3 }}>
                    Waiting on you · {held.length}
                  </CapsLabel>
                  <span className="text-meta text-muted-foreground">
                    Stay until you answer · Mark all read leaves them
                  </span>
                </div>
                <SessionList sessions={held} kept={kept} />
              </section>
              {rest.length > 0 && (
                <SessionList
                  sessions={rest}
                  kept={kept}
                  {...(nextSteps === undefined ? {} : { nextSteps })}
                />
              )}
            </>
          ) : (
            <SessionList
              sessions={current}
              kept={kept}
              {...(nextSteps === undefined ? {} : { nextSteps })}
            />
          )}
        </section>
      )}
      {history.length > 0 && (
        <section aria-label="History" className={CARD}>
          <SectionTitle>History</SectionTitle>
          <SessionList sessions={history} kept={kept} />
        </section>
      )}
    </>
  );
}

/**
 * Sessions, each a link with whose turn it is and what it waits on, and Remove for one queued; or,
 * read offline (`kept`), each with when it was last active, faint where it isn't kept. Under the
 * one the next steps are for, its next steps.
 */
function SessionList(props: {
  sessions: readonly Listed[];
  kept: ReadonlySet<SessionId> | undefined;
  nextSteps?: NextSteps;
}) {
  const { kept, nextSteps } = props;
  return (
    <ul className="mt-2 divide-y">
      {props.sessions.map((session) => (
        <li key={session.id} className="flex flex-col">
          <div className="flex items-center gap-2">
            <SessionRow session={session} kept={kept} />
          </div>
          {nextSteps?.session === session.id && nextSteps.replies.length > 0 && (
            <div className="pb-3">
              <SuggestedReplies
                key={nextSteps.replies.join("\n")}
                replies={nextSteps.replies}
                onPick={nextSteps.pick}
                row={{ label: "Next steps" }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A session's row: its link, and Remove for one queued. */
function SessionRow(props: { session: Listed; kept: ReadonlySet<SessionId> | undefined }) {
  const { session, kept } = props;
  return (
    <>
      <Link
        to="/workspaces/$workspaceId/sessions/$sessionId"
        params={{ workspaceId: session.workspaceId, sessionId: session.id }}
        className={classes(LIST_ROW, "min-w-0 flex-1")}
      >
        <ListedSessionText
          title={session.title}
          now={session.now}
          updatedAt={session.updatedAt}
          when={describeWhen}
          held={heldWords(session)}
          {...(kept === undefined ? {} : { offline: kept.has(session.id) ? "kept" : "not-kept" })}
        />
        {session.lead === true && <LeadMark />}
        {session.byLead === true && <ByLead />}
        {session.waiting !== "nothing" && <WaitingMark on={session.waiting} />}
      </Link>
      {session.queued && <RemoveQueued session={session} />}
    </>
  );
}

/**
 * What a session waits on the owner for, as the worker says (#345): the lilac new-reply tab or the
 * gold needs-you tab (Paper, Style guide · Handheld, Session slots).
 */
function WaitingMark(props: { on: Exclude<Listed["waiting"], "nothing"> }) {
  const reply = props.on === "reply";
  return (
    <span
      role="img"
      aria-label={
        reply
          ? "New reply"
          : props.on === "cut-off"
            ? "Cut off"
            : props.on === "stalled"
              ? "Stalled"
              : props.on === "approval"
                ? "Needs you"
                : "Waiting on you"
      }
      className={classes(
        "flex h-7.5 w-11.5 shrink-0 items-center justify-center self-center rounded-row",
        reply ? "bg-primary-text" : "bg-warning",
      )}
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4">
        {reply ? (
          <path
            d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"
            className="fill-card"
          />
        ) : (
          <>
            <path
              d="M8 1.8L13 3.8V7.6C13 10.6 10.9 13 8 14.2C5.1 13 3 10.6 3 7.6V3.8L8 1.8Z"
              className="fill-card"
            />
            <path
              d="M5.8 8L7.3 9.5L10.3 6.4"
              fill="none"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-warning"
            />
          </>
        )}
      </svg>
    </span>
  );
}

/**
 * Mark all read (#345): every new reply in the workspace is seen, on every device; its lists and
 * tiles clear. An approval still waits: it needs acting on.
 */
function MarkAllRead(props: { workspaceId: Listed["workspaceId"] | undefined }) {
  const router = useRouter();
  const { workspaceId } = props;
  const mark = useAction(async () => {
    if (workspaceId === undefined) return undefined;
    const marked = await markAllRead(workspaceId);
    if (marked.kind !== "loaded") return describeProblem(marked).body;
    const now = await loadSessions(workspaceId);
    if (now !== undefined) KEPT_SESSIONS.set(workspaceId, now);
    await router.invalidate();
    return undefined;
  });
  return (
    <div className="flex flex-col items-end">
      <Button
        variant="soft"
        size="sm"
        busy={mark.busy}
        busyLabel="Marking read…"
        onClick={() => mark.run()}
      >
        <CheckCheck aria-hidden />
        Mark all read
      </Button>
      <FormError message={mark.error} />
    </div>
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
      <Button
        variant="quiet"
        size="xs"
        busy={remove.busy}
        busyLabel="Removing…"
        onClick={() => remove.run()}
      >
        Remove
      </Button>
      <FormError message={remove.error} />
    </div>
  );
}
