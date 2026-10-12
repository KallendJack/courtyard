import type {
  CodeSessionList,
  OpenPullRequest,
  OpenPullRequestList,
  PullRequestFrom,
  WorkspaceId,
} from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { type ComponentProps, lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form-error";
import { useLayout } from "@/components/handheld";
import { SegmentedChoice } from "@/components/segmented-choice";
import { addStylesheet } from "@/lib/stylesheet";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { bringUpToDate, loadOpenPullRequests } from "./api.ts";
import { ChecksState } from "./checks.tsx";
import css from "./review.css?inline";

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
type Row = OpenPullRequest & { readonly session: Listed | undefined };

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

/** What the sessions' pull requests are now, so the list is asked for again when one changes. */
const versionOf = (sessions: readonly Listed[]) =>
  JSON.stringify(sessions.map((session) => [session.id, session.pullRequest]));

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
}) {
  const { workspaceId, sessions } = props;
  const [showing, setShowing] = useState<"open" | "merged">("open");
  const [open, setOpen] = useState<OpenPullRequestList>();
  const version = versionOf(sessions);

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again as the sessions' pull requests change
  useEffect(() => {
    let current = true;
    void loadOpenPullRequests(workspaceId).then((loaded) => {
      if (current && loaded.kind === "loaded") setOpen(loaded.data);
    });
    return () => {
      current = false;
    };
  }, [workspaceId, version]);

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
  if (rows.length === 0 && merged.length === 0 && showing === "open") return null;

  return (
    <section aria-labelledby="pull-requests" data-review="" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="pull-requests"
          className="text-label font-semibold tracking-label text-muted-foreground uppercase"
        >
          Pull requests · {rows.length} {showing}
        </h2>
        <SegmentedChoice
          label="Show"
          look="apart"
          options={SHOWING}
          value={showing}
          onChange={setShowing}
        />
      </div>
      {rows.length === 0 ? (
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
    case "github":
      return `from ${from.login} on GitHub`;
  }
};

function PullRequestRow(props: { workspaceId: WorkspaceId; row: Row }) {
  const { workspaceId, row } = props;
  const { pullRequest, session } = row;
  const navigate = useNavigate();
  const desktop = useLayout() === "desktop";
  const title = `#${pullRequest.number} ${pullRequest.title ?? session?.title ?? ""}`.trim();
  const fixing = pullRequest.checks.kind === "failed" && session?.now.kind === "working";
  const open = pullRequest.state === "open";
  const conflicts = open && pullRequest.conflicts === true;
  const ready = open && !conflicts && pullRequest.checks.kind === "passed";
  const checks = <ChecksState pullRequest={pullRequest} base={row.base} chip={desktop} />;

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
          <span className="min-w-0 flex-1 truncate">
            · {fixing ? "the session is fixing it" : fromSaid(row.from)}
          </span>
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
            disabled={bring.busy}
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
