import type {
  CodeSessionList,
  OpenPullRequest,
  OpenPullRequestList,
  PullRequestFrom,
  WorkspaceId,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useWide } from "@courtyard/ui/frame/handheld.ts";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { PlaceholderRows } from "@courtyard/ui/layout/kept.tsx";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { type ComponentProps, lazy, Suspense, useState } from "react";
import { ButtonLink } from "@/components/buttons/button-link";
import { SegmentedChoice } from "@/components/forms/segmented-choice";
import { addStylesheet } from "@/lib/stylesheet";
import { describeProblem } from "../../components/layout/problems.tsx";
import { bringUpToDate } from "./api.ts";
import { ChecksState } from "./checks.tsx";
import { useOpenPullRequests } from "./open-pull-requests.ts";
import css from "./review.css?inline";

// A code workspace's Home asks for them too (#301), as does Home's tile for it (#102).
export { useOpenPullRequests } from "./open-pull-requests.ts";

// The review's stylesheet (review.css), which has the list's classes too.
addStylesheet("review", css);

const Review = lazy(() => import("./review.tsx"));

/**
 * The page of a pull request no session opened (#278), on its workspace's page, loaded from here
 * rather than by the workspace page itself: each file the first load could lead to is listed in
 * it, and a second way to the review would split the pieces it shares into files of their own.
 */
export function PullRequestPage(props: ComponentProps<typeof Review>) {
  return (
    <Suspense>
      <Review {...props} />
    </Suspense>
  );
}

type Listed = CodeSessionList["sessions"][number];

const SHOWING = [
  { value: "open", label: "Open" },
  { value: "merged", label: "Merged" },
] as const;

/** A row of the list: a pull request, and the session it's from, when one is. */
type Row = Omit<OpenPullRequest, "waiting"> & { readonly session: Listed | undefined };

/** The workspace's sessions' pull requests as last seen, open or merged, latest first. */
const fromSessions = (sessions: readonly Listed[], state: "open" | "merged"): Row[] =>
  sessions
    .flatMap((session) =>
      session.pullRequest?.state === state && session.branch !== undefined
        ? [
            {
              pullRequest: session.pullRequest,
              branch: session.branch,
              from: { kind: "session", sessionId: session.id, title: session.title } as const,
              session,
            },
          ]
        : [],
    )
    .sort((a, b) => b.pullRequest.number - a.pullRequest.number);

/**
 * A code workspace's pull requests (#240, #278; Paper, "PRs: every open PR"): every open one on
 * its repository, whoever opened it (a session, a Claude Code helper, the owner on GitHub), latest
 * first, each with its branch, who it's from, where it stands, and its main action: Review, or
 * Bring up to date when it conflicts. Or those its sessions merged. The PRs tab's list: until the
 * workspace page has tabs, a section of its own. Loaded only for a code workspace, with the
 * review's stylesheet.
 */
export default function PullRequests(props: {
  workspaceId: WorkspaceId;
  sessions: CodeSessionList["sessions"];
  /** The open ones as the page has them already (a code workspace's Home, #301), if it does. */
  open?: OpenPullRequestList | undefined;
}) {
  const { workspaceId, sessions } = props;
  const [showing, setShowing] = useState<"open" | "merged">("open");
  const asked = useOpenPullRequests(workspaceId, sessions, props.open === undefined);
  const open = props.open ?? asked;

  const rows: Row[] =
    showing === "merged" || open === undefined
      ? fromSessions(sessions, showing)
      : open.pullRequests.map((pull) => {
          const { from } = pull;
          return {
            ...pull,
            session:
              from.kind === "session"
                ? sessions.find((session) => session.id === from.sessionId)
                : undefined,
          };
        });
  const merged = fromSessions(sessions, "merged");
  // Nothing known yet: the list keeps its place with faint rows until it comes.
  const unknown = open === undefined && showing === "open";
  if (!unknown && rows.length === 0 && merged.length === 0 && showing === "open") return null;

  return (
    <section aria-labelledby="pull-requests" data-review="" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <CapsLabel tone="muted" heading={{ level: 2, id: "pull-requests" }}>
          {unknown ? "Pull requests" : `Pull requests · ${rows.length} ${showing}`}
        </CapsLabel>
        <SegmentedChoice
          label="Show"
          look="apart"
          options={SHOWING}
          value={showing}
          onChange={setShowing}
        />
      </div>
      {unknown ? (
        <PlaceholderRows count={2} size="tall" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {showing === "open" ? "None open." : "None merged yet."}
        </p>
      ) : (
        <ul className="flex flex-col overflow-clip rounded-card border bg-surface">
          {rows.map((row) => (
            <PullRequestRow key={row.pullRequest.number} workspaceId={workspaceId} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Who a pull request is from, after its branch. */
const fromSaid = (from: PullRequestFrom) => {
  switch (from.kind) {
    case "session":
      return `from the session “${from.title}”`;
    case "claude-code":
      return "from a Claude Code helper";
    case "dependabot":
      return "from Dependabot";
    case "github":
      return `from ${from.login} on GitHub`;
  }
};

function PullRequestRow(props: { workspaceId: WorkspaceId; row: Row }) {
  const { workspaceId, row } = props;
  const { pullRequest, session } = row;
  const navigate = useNavigate();
  const desktop = useWide();
  const title = `#${pullRequest.number} ${pullRequest.title ?? session?.title ?? ""}`.trim();
  const fixing = pullRequest.checks.kind === "failed" && session?.now.kind === "working";
  const open = pullRequest.state === "open";
  const conflicts = open && pullRequest.conflicts === true;
  const ready = open && !conflicts && pullRequest.checks.kind === "passed";
  const { bump } = row;
  const checks = (
    <ChecksState
      pullRequest={pullRequest}
      base={row.base}
      chip={desktop}
      rerunning={bump?.kind === "rerunning"}
    />
  );
  // A bump the worker filed for the Lead (#496) says so, with its issue.
  const said = fixing
    ? "the session is fixing it"
    : bump?.kind === "fixing"
      ? `the Lead is fixing it · #${bump.issue}`
      : fromSaid(row.from);

  const bring = useAction(async () => {
    if (session === undefined) return undefined;
    const brought = await bringUpToDate(session.id);
    if (brought.kind !== "loaded") return describeProblem(brought).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId, sessionId: session.id },
    });
    return undefined;
  });

  const action = conflicts ? "Bring up to date" : "Review";
  const look = { variant: ready || conflicts ? "primary" : "outline", size: "lg" } as const;

  return (
    <li
      aria-label={title}
      className="flex min-h-19 items-center gap-3 py-3 pr-3 pl-4.5 not-last:border-b xl:gap-4 xl:py-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 xl:gap-1.5">
        <p className="truncate text-interface font-semibold xl:text-base/5.5 xl:font-bold">
          {title}
        </p>
        <p className="flex min-w-0 items-center gap-2 text-meta/4 text-muted-foreground">
          {/* Its branch is cut short only once who it's from has given way (#319). */}
          <span className="min-w-0 truncate font-mono text-primary-text">{row.branch}</span>
          <span className="min-w-0 flex-1 truncate">· {said}</span>
        </p>
        {/* On a phone, its checks go under its branch. */}
        <div className="md:hidden">{checks}</div>
      </div>
      <div className="w-37.5 shrink-0 max-md:hidden xl:w-50">{checks}</div>
      <div className="flex shrink-0 flex-col items-end gap-1 md:w-39 xl:w-45">
        {session === undefined ? (
          // One no session opened: its page shows what would start before it starts.
          <ButtonLink
            to="/workspaces/$workspaceId"
            params={{ workspaceId }}
            hash={`pr-${pullRequest.number}`}
            aria-label={`${action} ${title}`}
            {...look}
          >
            {action}
          </ButtonLink>
        ) : conflicts ? (
          <Button
            aria-label={`${action} ${title}`}
            busy={bring.busy}
            busyLabel="Bringing up to date…"
            onClick={() => void bring.run()}
            {...look}
          >
            <RefreshCw aria-hidden />
            {action}
          </Button>
        ) : (
          <ButtonLink
            to="/workspaces/$workspaceId/sessions/$sessionId"
            params={{ workspaceId, sessionId: session.id }}
            search={{ view: "review" }}
            aria-label={`${action} ${title}`}
            {...look}
          >
            {action}
          </ButtonLink>
        )}
        <FormError message={bring.error} />
      </div>
    </li>
  );
}
