import type {
  ApprovalAsk,
  CodeSessionList,
  MattSetup,
  OpenPullRequest,
  WorkspaceId,
} from "@courtyard/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/buttons/button-link";
import { ThumbButton } from "@/components/buttons/thumb-button";
import { FormError } from "@/components/forms/form-error";
import { Block, BlockEmpty, BlockRow, BlockRows } from "@/components/layout/home-block";
import { PlaceholderRows } from "@/components/layout/kept";
import { useAction } from "@/hooks/use-action";
import { continueTurn } from "../../api/worker.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { clockWords } from "../../lib/when.ts";
import { MattSetupDone, SetupSheet } from "../matt-setup/setup-card.tsx";
import { bringUpToDate, endPullRequest } from "../pull-requests/api.ts";
import { answerApproval } from "../sessions/composer/messages.ts";
import { useMergeInOrder } from "./merge-in-order.ts";
import { agoWords, type Need } from "./needs.ts";

// Home reads what waits on the owner the same way (#102, #334).
export { needsOf, onTheBoard } from "./needs.ts";

type Listed = CodeSessionList["sessions"][number];

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

/** How many pull requests are ready: "1 PR ready", "3 PRs ready". */
const readyWords = (count: number) => `${count} ${count === 1 ? "PR" : "PRs"} ready`;

/** A builder's name on a row (#474): its issue's number and title, "#183 Shared Scroller". */
const builderTitle = (session: Listed) => session.title.replace(/^Build (#\d+): /, "$1 ");

/** A pull request's name on a row: its number and title. */
const pullTitle = (pull: OpenPullRequest) =>
  `#${pull.pullRequest.number} ${pull.pullRequest.title ?? pull.branch}`.trim();

/**
 * Needs you (#301; Paper, "Code workspace Home"): every approval, turn cut off by a restart (#186),
 * failing check, new reply, pull request ready to merge, conflict, and Matt's setup offer, each a
 * row with its one-tap action: Approve, Continue, Review, Open, Merge, Bring up to date. The Lead's
 * builders' are on the Builders board instead (#592), and while one needs the owner, with nothing
 * else waiting, it says "Nothing else needs you". It takes the height the page leaves it, its rows
 * scrolling inside when there are more than fit (#335); with nothing waiting it says so.
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
  /** What it says with nothing waiting: "Nothing else needs you" while builders do (#592). */
  nothing?: string;
}) {
  const [settingUp, setSettingUp] = useState(false);
  const opened = props.setup.state === "opened";
  if (props.needs.length === 0 && props.pending) {
    return (
      <Block label="Needs you" needs fill aRowAtLeast>
        <PlaceholderRows count={2} />
      </Block>
    );
  }
  // Nothing waits: the block keeps its place, calm, with one quiet line (#283).
  if (props.needs.length === 0 && !opened) {
    return (
      <Block label="Needs you" fill aRowAtLeast>
        <BlockEmpty>{props.nothing ?? "Nothing needs you"}</BlockEmpty>
      </Block>
    );
  }
  return (
    <Block label="Needs you" count={props.needs.length} needs fill aRowAtLeast>
      <BlockRows>
        <ul className="flex flex-col gap-1.5">
          {props.needs.map((need) => (
            <NeedRow
              key={keyOf(need)}
              workspaceId={props.workspaceId}
              need={need}
              onSettingUp={() => setSettingUp(true)}
              onChanged={props.onChanged}
            />
          ))}
        </ul>
        {props.setup.state === "opened" && <MattSetupDone setup={props.setup} />}
        {props.setup.state === "offered" && (
          <SetupSheet
            open={settingUp}
            onClose={() => setSettingUp(false)}
            workspaceId={props.workspaceId}
            card={props.setup.card}
            onAnswered={(setup) => {
              setSettingUp(false);
              props.onSetup(setup);
            }}
          />
        )}
      </BlockRows>
    </Block>
  );
}

const keyOf = (need: Need) => {
  switch (need.kind) {
    case "stuck":
    case "approval":
    case "cut-off":
    case "reply":
      return `${need.kind}-${need.session.id}`;
    case "setup":
      return "setup";
    case "merge-in-order":
      return "merge-in-order";
    default:
      return `${need.kind}-${need.pull.pullRequest.number}`;
  }
};

function NeedRow(props: {
  workspaceId: WorkspaceId;
  need: Need;
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
    case "stuck":
      // Open only opens the kept session: the owner reads what happened and says there how it
      // should go on (#590).
      return (
        <BlockRow
          label={builderTitle(need.session)}
          title={sessionLink(need.session, builderTitle(need.session))}
          sub={need.session.stuck === undefined ? "Stuck" : `Stuck · ${need.session.stuck}`}
          tone="needs"
          action={<OpenSession workspaceId={workspaceId} session={need.session} />}
        />
      );
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
    case "cut-off":
      return (
        <BlockRow
          label={need.session.title}
          title={sessionLink(need.session, need.session.title)}
          sub={`Cut off at ${clockWords(need.session.updatedAt)} · Courtyard restarted`}
          tone="needs"
          action={<Continue session={need.session} onChanged={props.onChanged} />}
        />
      );
    case "failed":
      return (
        <BlockRow
          label={pullTitle(need.pull)}
          title={prLink(need.pull)}
          sub={
            // A bump the Lead's fix didn't mend is the owner's to decide (#496).
            need.pull.bump?.kind === "stuck"
              ? `Still failing after fix · #${need.pull.bump.issue}`
              : `${need.count} ${need.count === 1 ? "check" : "checks"} failed`
          }
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
          action={<OpenSession workspaceId={workspaceId} session={need.session} />}
        />
      );
    case "merge":
      return (
        <BlockRow
          label={pullTitle(need.pull)}
          title={prLink(need.pull)}
          sub={
            need.session?.byLead === true
              ? "By Lead · checks passed · ready to merge"
              : need.pull.from.kind === "dependabot"
                ? "From Dependabot · checks passed"
                : "Checks passed · ready to merge"
          }
          tone="passed"
          action={<Merge workspaceId={workspaceId} pull={need.pull} onChanged={props.onChanged} />}
        />
      );
    case "merge-in-order": {
      const order = need.pulls.map((pull) => `#${pull.pullRequest.number}`).join(" → ");
      const { merge } = need;
      return (
        <BlockRow
          label={`${readyWords(need.pulls.length)}, in build order`}
          title={`${readyWords(need.pulls.length)}, in build order`}
          sub={
            merge?.kind === "merging"
              ? `Merging #${merge.pullRequest} · ${order}`
              : merge?.kind === "stopped"
                ? `Stopped at #${merge.pullRequest} · ${merge.why}`
                : `${order} · all passed`
          }
          tone={merge?.kind === "stopped" ? "needs" : "passed"}
          action={
            merge?.kind === "merging" ? undefined : (
              <MergeInOrder
                workspaceId={workspaceId}
                pulls={need.pulls}
                onChanged={props.onChanged}
              />
            )
          }
        />
      );
    }
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
          sub={`${need.missing} ${need.missing === 1 ? "thing" : "things"} to set up · Matt's skills read them`}
          tone="needs"
          action={
            <ThumbButton look="needs" row aria-haspopup="dialog" onClick={props.onSettingUp}>
              Review
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

/** Open: a row's link to its session's page. */
function OpenSession(props: { workspaceId: WorkspaceId; session: Listed }) {
  return (
    <ButtonLink
      to="/workspaces/$workspaceId/sessions/$sessionId"
      params={{ workspaceId: props.workspaceId, sessionId: props.session.id }}
      variant="outline"
      size="md"
      aria-label={`Open ${props.session.title}`}
    >
      Open
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
        busy={approve.busy}
        busyLabel="Approving…"
        onClick={() => void approve.run()}
      >
        Approve
      </ThumbButton>
      <FormError message={approve.error} />
    </>
  );
}

/** Continue (#186): the session's last turn, cut off by a restart, carries on, in one tap. */
function Continue(props: { session: Listed; onChanged: () => void }) {
  const go = useAction(async () => {
    const continued = await continueTurn(props.session.id);
    if (continued.kind !== "loaded") return describeProblem(continued).body;
    props.onChanged();
    return undefined;
  });
  return (
    <>
      <ThumbButton
        look="primary"
        row
        aria-label={`Continue ${props.session.title}`}
        busy={go.busy}
        busyLabel="Continuing…"
        onClick={() => void go.run()}
      >
        Continue
      </ThumbButton>
      <FormError message={go.error} />
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
        busy={merge.busy}
        busyLabel="Merging…"
        onClick={() => void merge.run()}
      >
        Merge
      </ThumbButton>
      <FormError message={merge.error} />
    </>
  );
}

/**
 * Merge in order, in one tap (#423): the owner's OK for the Lead to merge its builders' pull
 * requests ready now, in the build order's order.
 */
function MergeInOrder(props: {
  workspaceId: WorkspaceId;
  pulls: readonly OpenPullRequest[];
  onChanged: () => void;
}) {
  const merge = useMergeInOrder({
    workspaceId: props.workspaceId,
    pullRequests: props.pulls.map((pull) => pull.pullRequest.number),
    onMerging: props.onChanged,
  });
  return (
    <>
      <ThumbButton
        look="primary"
        row
        busy={merge.busy}
        busyLabel="Merging…"
        onClick={() => void merge.run()}
      >
        Merge in order
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
        busy={bring.busy}
        busyLabel="Bringing up to date…"
        onClick={() => void bring.run()}
      >
        Bring up to date
      </ThumbButton>
      <FormError message={bring.error} />
    </>
  );
}
