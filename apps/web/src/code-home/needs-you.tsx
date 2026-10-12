import type {
  ApprovalAsk,
  CodeSessionList,
  MattSetup,
  OpenPullRequest,
  WorkspaceId,
} from "@courtyard/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form-error";
import { PlaceholderRows } from "@/components/kept";
import { ThumbButton } from "@/components/thumb-button";
import { useAction } from "@/lib/use-action";
import { MattSetupOffer } from "../matt-setup/matt-setup-offer.tsx";
import { describeProblem } from "../problems.tsx";
import { bringUpToDate, endPullRequest } from "../review/api.ts";
import { answerApproval } from "../sessions/messages.ts";
import { sessionEnded } from "../sessions/session-links.tsx";
import { describeWhen } from "../when.ts";
import { Block, BlockRow } from "./block.tsx";

type Listed = CodeSessionList["sessions"][number];

/** How long a session's answer counts as a new reply, waiting on the owner. */
const NEW_REPLY_MS = 24 * 60 * 60 * 1000;

/** How long ago something was, in a few words: "just now", "2 min ago", "3 h ago", "Yesterday". */
export const agoWords = (iso: string, now = Date.now()) => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return describeWhen(iso);
};

/** What an approval asks, as a question with the exact command, file or action in it. */
const askedWords = (ask: ApprovalAsk) => {
  switch (ask.kind) {
    case "command":
      return `Run ${ask.command}?`;
    case "tool":
      return `${ask.action} in ${ask.connection}?`;
    default:
      return `Change ${ask.path}?`;
  }
};

/** One thing waiting on the owner (AGENTS.md): each a row of Needs you. */
type Need =
  | { readonly kind: "approval"; readonly session: Listed }
  | { readonly kind: "failed"; readonly pull: OpenPullRequest; readonly count: number }
  | { readonly kind: "reply"; readonly session: Listed }
  | { readonly kind: "merge"; readonly pull: OpenPullRequest }
  | { readonly kind: "conflict"; readonly pull: OpenPullRequest; readonly session?: Listed }
  | { readonly kind: "setup"; readonly missing: number };

/**
 * What waits on the owner, in the order the grill set (#301): approvals, failing checks, new
 * replies, pull requests ready to merge, conflicts, then Matt's setup.
 */
export const needsOf = (given: {
  sessions: readonly Listed[];
  pulls: readonly OpenPullRequest[];
  setup: MattSetup;
  now?: number;
}): Need[] => {
  const now = given.now ?? Date.now();
  const sessionOf = ({ from }: OpenPullRequest) =>
    from.kind === "session"
      ? given.sessions.find((session) => session.id === from.sessionId)
      : undefined;
  const open = given.pulls.filter((pull) => pull.pullRequest.state === "open");
  const approvals: Need[] = given.sessions
    .filter((session) => session.now.kind === "needs-you")
    .map((session) => ({ kind: "approval", session }));
  const failed: Need[] = open.flatMap((pull) => {
    const { checks, conflicts } = pull.pullRequest;
    // A session fixing its own failed checks is running, not waiting on the owner (#172).
    if (checks.kind !== "failed" || conflicts === true) return [];
    if (sessionOf(pull)?.now.kind === "working") return [];
    return [{ kind: "failed", pull, count: checks.failed.length }];
  });
  const replies: Need[] = given.sessions
    .filter(
      (session) =>
        session.now.kind === "your-turn" &&
        !session.queued &&
        session.pullRequest === undefined &&
        !sessionEnded(session) &&
        now - Date.parse(session.updatedAt) < NEW_REPLY_MS,
    )
    .map((session) => ({ kind: "reply", session }));
  const merges: Need[] = open
    .filter(
      (pull) => pull.pullRequest.checks.kind === "passed" && pull.pullRequest.conflicts !== true,
    )
    .map((pull) => ({ kind: "merge", pull }));
  const conflicts: Need[] = open
    .filter((pull) => pull.pullRequest.conflicts === true)
    .map((pull) => {
      const session = sessionOf(pull);
      return session === undefined
        ? { kind: "conflict", pull }
        : { kind: "conflict", pull, session };
    });
  const setup: Need[] =
    given.setup.state === "offered" ? [{ kind: "setup", missing: given.setup.missing.length }] : [];
  return [...approvals, ...failed, ...replies, ...merges, ...conflicts, ...setup];
};

/** A pull request's name on a row: its number and title. */
const pullTitle = (pull: OpenPullRequest) =>
  `#${pull.pullRequest.number} ${pull.pullRequest.title ?? pull.branch}`.trim();

/**
 * Needs you (#301; Paper, "Code workspace Home"): every approval, failing check, new reply, pull
 * request ready to merge, conflict, and Matt's setup offer, each a row with its one-tap action:
 * Approve, Review, Open, Merge, Bring up to date. Hidden when nothing waits on the owner.
 */
export function NeedsYou(props: {
  workspaceId: WorkspaceId;
  needs: readonly Need[];
  /** What it shows is still to come (a first visit): it keeps its place with faint rows. */
  pending: boolean;
  setup: MattSetup;
  onSetup: (setup: MattSetup) => void;
  /** Something here changed (merged, approved): the page asks for its lists again. */
  onChanged: () => void;
}) {
  const [settingUp, setSettingUp] = useState(false);
  const opened = props.setup.state === "opened";
  if (props.needs.length === 0 && !opened && !props.pending) return null;
  if (props.needs.length === 0 && props.pending) {
    return (
      <Block label="Needs you" needs>
        <PlaceholderRows count={2} />
      </Block>
    );
  }
  return (
    <Block label="Needs you" count={props.needs.length} needs>
      <ul className="flex flex-col gap-1.5">
        {props.needs.map((need) => (
          <NeedRow
            key={keyOf(need)}
            workspaceId={props.workspaceId}
            need={need}
            settingUp={settingUp}
            onSettingUp={() => setSettingUp((was) => !was)}
            onChanged={props.onChanged}
          />
        ))}
      </ul>
      {(settingUp || opened) && (
        <MattSetupOffer
          workspaceId={props.workspaceId}
          setup={props.setup}
          onAnswered={(setup) => {
            setSettingUp(false);
            props.onSetup(setup);
          }}
        />
      )}
    </Block>
  );
}

const keyOf = (need: Need) => {
  switch (need.kind) {
    case "approval":
    case "reply":
      return `${need.kind}-${need.session.id}`;
    case "setup":
      return "setup";
    default:
      return `${need.kind}-${need.pull.pullRequest.number}`;
  }
};

function NeedRow(props: {
  workspaceId: WorkspaceId;
  need: Need;
  settingUp: boolean;
  onSettingUp: () => void;
  onChanged: () => void;
}) {
  const { workspaceId, need } = props;
  const sessionLink = (session: Listed, words: string) => (
    <Link
      to="/workspaces/$workspaceId/sessions/$sessionId"
      params={{ workspaceId, sessionId: session.id }}
      className="hover:underline"
    >
      {words}
    </Link>
  );
  const prLink = (pull: OpenPullRequest) => (
    <Link
      to="/workspaces/$workspaceId"
      params={{ workspaceId }}
      hash={`pr-${pull.pullRequest.number}`}
      className="hover:underline"
    >
      {pullTitle(pull)}
    </Link>
  );
  switch (need.kind) {
    case "approval": {
      const { session } = need;
      if (session.now.kind !== "needs-you") return null;
      const asked = askedWords(session.now.ask);
      return (
        <BlockRow
          label={asked}
          title={sessionLink(session, asked)}
          sub={`${session.title} · asked ${agoWords(session.now.since)}`}
          tone="needs"
          action={
            <Approve
              session={session}
              approval={session.now.approval}
              label={asked}
              onChanged={props.onChanged}
            />
          }
        />
      );
    }
    case "failed":
      return (
        <BlockRow
          label={pullTitle(need.pull)}
          title={prLink(need.pull)}
          sub={`${need.count} ${need.count === 1 ? "check" : "checks"} failed`}
          tone="failed"
          action={<RowLink pull={need.pull} workspaceId={workspaceId} label="Review" />}
        />
      );
    case "reply":
      return (
        <BlockRow
          label={need.session.title}
          title={sessionLink(need.session, need.session.title)}
          sub={`Your turn · replied ${agoWords(need.session.updatedAt)}`}
          tone="quiet"
          action={
            <ButtonLink
              to="/workspaces/$workspaceId/sessions/$sessionId"
              params={{ workspaceId, sessionId: need.session.id }}
              variant="outline"
              size="md"
              aria-label={`Open ${need.session.title}`}
            >
              Open
            </ButtonLink>
          }
        />
      );
    case "merge":
      return (
        <BlockRow
          label={pullTitle(need.pull)}
          title={prLink(need.pull)}
          sub="Checks passed · ready to merge"
          tone="passed"
          action={<Merge workspaceId={workspaceId} pull={need.pull} onChanged={props.onChanged} />}
        />
      );
    case "conflict":
      return (
        <BlockRow
          label={pullTitle(need.pull)}
          title={prLink(need.pull)}
          sub={`Conflicts with ${need.pull.base ?? "its base"}`}
          tone="needs"
          action={
            need.session === undefined ? (
              // One no session opened: its page shows what would start before it starts.
              <RowLink pull={need.pull} workspaceId={workspaceId} label="Bring up to date" />
            ) : (
              <BringUpToDate
                workspaceId={workspaceId}
                session={need.session}
                label={pullTitle(need.pull)}
              />
            )
          }
        />
      );
    case "setup":
      return (
        <BlockRow
          label="Add Matt's setup to this repo?"
          title="Add Matt's setup to this repo?"
          sub={`${need.missing} ${need.missing === 1 ? "thing" : "things"} missing · Matt's skills read them`}
          tone="needs"
          action={
            <ThumbButton
              look="needs"
              row
              aria-expanded={props.settingUp}
              onClick={props.onSettingUp}
            >
              {props.settingUp ? "Hide" : "Review"}
            </ThumbButton>
          }
        />
      );
  }
}

/** A row's link to a pull request's page, where what happens next is shown first. */
function RowLink(props: { pull: OpenPullRequest; workspaceId: WorkspaceId; label: string }) {
  return (
    <ButtonLink
      to="/workspaces/$workspaceId"
      params={{ workspaceId: props.workspaceId }}
      hash={`pr-${props.pull.pullRequest.number}`}
      variant="outline"
      size="md"
      aria-label={`${props.label} ${pullTitle(props.pull)}`}
    >
      {props.label}
    </ButtonLink>
  );
}

/** Approve: Allow on the approval the session waits on, in one tap (#171). */
function Approve(props: {
  session: Listed;
  approval: number;
  label: string;
  onChanged: () => void;
}) {
  // Stops a kept answer's tries once the row has gone (answered on another device, say).
  const gone = useRef<AbortController>(undefined);
  useEffect(() => {
    const row = new AbortController();
    gone.current = row;
    return () => row.abort();
  }, []);
  const approve = useAction(async () => {
    const answered = await answerApproval({
      sessionId: props.session.id,
      approval: props.approval,
      answer: "allow",
      onWaiting: () => {},
      signal: gone.current?.signal ?? new AbortController().signal,
    });
    if (answered.kind !== "loaded") return describeProblem(answered).body;
    props.onChanged();
    return undefined;
  });
  return (
    <>
      <ThumbButton
        look="needs"
        row
        aria-label={`Approve: ${props.label}`}
        disabled={approve.busy}
        onClick={() => void approve.run()}
      >
        Approve
      </ThumbButton>
      <FormError message={approve.error} />
    </>
  );
}

/** Merge, in one tap: only the commit the row showed, so one that moved on since is refused. */
function Merge(props: { workspaceId: WorkspaceId; pull: OpenPullRequest; onChanged: () => void }) {
  const { pullRequest } = props.pull;
  const merge = useAction(async () => {
    const merged = await endPullRequest(
      { kind: "number", workspaceId: props.workspaceId, number: pullRequest.number },
      { kind: "merge", head: pullRequest.head },
    );
    if (merged.kind !== "loaded") return describeProblem(merged).body;
    props.onChanged();
    return undefined;
  });
  return (
    <>
      <ThumbButton
        look="primary"
        row
        aria-label={`Merge ${pullTitle(props.pull)}`}
        disabled={merge.busy}
        onClick={() => void merge.run()}
      >
        Merge
      </ThumbButton>
      <FormError message={merge.error} />
    </>
  );
}

/** Bring up to date, in one tap: the PR's session is sent the message to merge its base in (#278). */
function BringUpToDate(props: { workspaceId: WorkspaceId; session: Listed; label: string }) {
  const navigate = useNavigate();
  const bring = useAction(async () => {
    const brought = await bringUpToDate(props.session.id);
    if (brought.kind !== "loaded") return describeProblem(brought).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: props.workspaceId, sessionId: props.session.id },
    });
    return undefined;
  });
  return (
    <>
      <ThumbButton
        look="needs"
        row
        aria-label={`Bring up to date ${props.label}`}
        disabled={bring.busy}
        onClick={() => void bring.run()}
      >
        Bring up to date
      </ThumbButton>
      <FormError message={bring.error} />
    </>
  );
}
