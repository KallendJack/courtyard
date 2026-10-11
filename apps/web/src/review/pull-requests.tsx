import type { CodeSessionList } from "@courtyard/contract";
import { useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { SegmentedChoice } from "@/components/segmented-choice";
import { addStylesheet } from "@/lib/stylesheet";
import { ChecksState } from "./checks.tsx";
import css from "./review.css?inline";

// The review's stylesheet (review.css), which has the list's classes too.
addStylesheet("review", css);

type Listed = CodeSessionList["sessions"][number];
type WithPullRequest = Listed & { pullRequest: NonNullable<Listed["pullRequest"]> };

const SHOWING = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
] as const;

/**
 * A code workspace's pull requests (#240; Paper, "Tablet · PRs tab"), one from each session that
 * opened one, latest first: its title, branch and where its checks stand, and Review, the main
 * action once its checks pass. The open ones, or those merged. The PRs tab's list: until the
 * workspace page has tabs (#222), a section of its own. Loaded only for a code workspace, with the
 * review's stylesheet.
 */
export default function PullRequests(props: { sessions: CodeSessionList["sessions"] }) {
  const [showing, setShowing] = useState<"open" | "merged">("open");
  const all = props.sessions.filter(
    (session): session is WithPullRequest => session.pullRequest !== undefined,
  );
  if (all.length === 0) return null;
  const shown = all.filter((session) => session.pullRequest.state === showing);
  return (
    <section aria-labelledby="pull-requests" data-review="" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="pull-requests"
          className="text-label font-semibold tracking-label text-muted-foreground uppercase"
        >
          Pull requests · {shown.length} {showing}
        </h2>
        <SegmentedChoice
          label="Show"
          look="apart"
          options={SHOWING}
          value={showing}
          onChange={setShowing}
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {showing === "open"
            ? "None open: each one shows here once a session opens it."
            : "None merged yet."}
        </p>
      ) : (
        <ul className="flex flex-col overflow-clip rounded-card border bg-surface">
          {shown.map((session) => (
            <PullRequestRow key={session.id} session={session} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PullRequestRow(props: { session: WithPullRequest }) {
  const { session } = props;
  const { pullRequest } = session;
  const title = `#${pullRequest.number} ${pullRequest.title ?? session.title}`;
  const fixing = pullRequest.checks.kind === "failed" && session.now.kind === "working";
  const ready = pullRequest.state === "open" && pullRequest.checks.kind === "passed";
  const checks = <ChecksState pullRequest={pullRequest} />;
  return (
    <li
      aria-label={title}
      className="flex min-h-19 items-center gap-3 py-3 pr-3 pl-4.5 not-last:border-b"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-interface font-semibold">{title}</p>
        <p className="flex min-w-0 items-center gap-2 text-meta/4 text-muted-foreground">
          {session.branch !== undefined && (
            <span className="truncate font-mono text-primary-text">{session.branch}</span>
          )}
          {fixing && <span className="shrink-0">· the session is fixing it</span>}
        </p>
        {/* On a phone, its checks go under its branch. */}
        <div className="md:hidden">{checks}</div>
      </div>
      <div className="w-37.5 shrink-0 max-md:hidden">{checks}</div>
      <ButtonLink
        to="/workspaces/$workspaceId/sessions/$sessionId"
        params={{ workspaceId: session.workspaceId, sessionId: session.id }}
        search={{ view: "review" }}
        aria-label={`Review ${title}`}
        variant={ready ? "primary" : "outline"}
        size="lg"
      >
        Review
      </ButtonLink>
    </li>
  );
}
