import type { PullRequest, PullRequestReview, SessionId, WorkspaceId } from "@courtyard/contract";
import { GitMerge } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { ConfirmStep } from "@/components/confirm-step";
import { FileTree, lineCounts } from "@/components/file-tree";
import { FormError } from "@/components/form-error";
import { Notice } from "@/components/notice";
import { PageTitle } from "@/components/page";
import { ThumbButton } from "@/components/thumb-button";
import { addStylesheet } from "@/lib/stylesheet";
import { describeProblem } from "../problems.tsx";
import type { FromWorker } from "../worker.ts";
import { endPullRequest, loadReview } from "./api.ts";
import { ChecksState } from "./checks.tsx";
import { Diff } from "./diff.tsx";
import css from "./review.css?inline";
import { WhatChanged } from "./what-changed.tsx";

// The review's own stylesheet (review.css), added once, when a review is first opened.
addStylesheet("review", css);

/** What the session page shows of a pull request: its review asked for again when it changes. */
const versionOf = (pullRequest: PullRequest | undefined) =>
  pullRequest === undefined
    ? ""
    : JSON.stringify([
        pullRequest.state,
        pullRequest.head,
        pullRequest.checks,
        pullRequest.changes,
      ]);

const filesSaid = (count: number) => (count === 1 ? "1 file" : `${count} files`);

/**
 * A code session's pull request, reviewed (#160, #240; Paper, "Tablet · PR review and Merge" and
 * "description open"): the way back to All PRs, its title, where its checks stand, its branch and
 * size; what changed in one line, which opens the whole description; the files it changes as a
 * small tree beside the chosen file's diff (folded into one bar while the description is open);
 * then a big Merge and Close PR in thumb reach, Merge greyed out with its reason until it can
 * merge. On a narrow screen the tree, diff and buttons stack. Asking for changes is a message in
 * the session, from the message box below. Loaded only when it's opened, with its own stylesheet.
 */
export default function Review(props: {
  sessionId: SessionId;
  workspaceId: WorkspaceId;
  /** The session's title, the pull request's until GitHub has given it. */
  sessionTitle: string;
  /**
   * The pull request as the session's events have it now, once they've arrived: the review is
   * asked for again as it changes.
   */
  pullRequest: PullRequest | undefined;
  /** It was merged or closed from here, so the session has ended. */
  onEnded: () => void;
}) {
  const { sessionId, onEnded } = props;
  const version = versionOf(props.pullRequest);
  const [review, setReview] = useState<FromWorker<PullRequestReview>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again each time the pull request changes
  useEffect(() => {
    let current = true;
    void loadReview(sessionId).then((loaded) => {
      if (current) setReview(loaded);
    });
    return () => {
      current = false;
    };
  }, [sessionId, version]);

  const loaded = review?.kind === "loaded" ? review.data : undefined;
  const pullRequest = loaded?.pullRequest ?? props.pullRequest;
  const title =
    pullRequest === undefined
      ? props.sessionTitle
      : `#${pullRequest.number} ${pullRequest.title ?? props.sessionTitle}`;

  return (
    // Where the review's own classes apply (review.css).
    <div data-review="" className="flex flex-col gap-2">
      <PageTitle above={<BackLink workspaceId={props.workspaceId} pullRequests />}>
        {title}
      </PageTitle>
      {pullRequest !== undefined && (
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-meta/4">
          <ChecksState pullRequest={pullRequest} chip />
          {loaded !== undefined && (
            <span className="min-w-0 truncate font-mono text-primary-text">{loaded.branch}</span>
          )}
          <span className="font-medium text-muted-foreground">
            · {filesSaid(pullRequest.changes.files)} · {lineCounts(pullRequest.changes)}
          </span>
        </p>
      )}
      {review === undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">Asking GitHub for the pull request…</p>
      ) : review.kind !== "loaded" ? (
        <div className="mt-2">
          <Notice title="The pull request couldn't be shown">{describeProblem(review).body}</Notice>
        </div>
      ) : (
        <Reviewing
          key={review.data.pullRequest.number}
          sessionId={sessionId}
          review={review.data}
          onEnded={onEnded}
        />
      )}
    </div>
  );
}

function Reviewing(props: {
  sessionId: SessionId;
  review: PullRequestReview;
  onEnded: () => void;
}) {
  const { sessionId, review, onEnded } = props;
  const { pullRequest, files, merge } = review;
  /** The whole description is open, with the files folded into one bar. */
  const [reading, setReading] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [problem, setProblem] = useState<string>();
  const diff = useRef<HTMLDivElement>(null);
  const file = files.find((one) => one.path === chosen) ?? files[0];
  const place = file === undefined ? 0 : files.indexOf(file) + 1;

  const choose = (path: string) => {
    setChosen(path);
    // On a narrow screen the diff is below the tree: it comes into view.
    const top = diff.current?.getBoundingClientRect().top;
    if (top !== undefined && top > window.innerHeight * 0.6) {
      diff.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };

  const end = async (how: Parameters<typeof endPullRequest>[1]) => {
    const ended = await endPullRequest(sessionId, how);
    if (ended.kind !== "loaded") return describeProblem(ended).body;
    onEnded();
    return undefined;
  };

  const mergeNow = async () => {
    setMerging(true);
    setProblem(await end({ kind: "merge", head: pullRequest.head }));
    setMerging(false);
  };

  return (
    <section aria-label="Review" className="mt-2 flex flex-col gap-3">
      <WhatChanged body={review.body} open={reading} onOpen={setReading} />

      {reading ? (
        <div className="flex min-h-13 items-center justify-between gap-3 rounded-card border bg-surface py-2 pr-3 pl-4">
          <p className="text-interface font-semibold">
            {filesSaid(files.length)} changed · {lineCounts(pullRequest.changes)}
          </p>
          <Button variant="outline" size="sm" onClick={() => setReading(false)}>
            View the diff
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:items-start">
          {files.length > 0 ? (
            <FileTree files={files} chosen={file?.path} onChoose={choose} />
          ) : (
            <p className="rounded-card bg-surface p-4 text-sm text-muted-foreground">
              It changes no files.
            </p>
          )}
          <div ref={diff} className="flex min-w-0 scroll-mt-4 flex-col">
            {file !== undefined && <Diff file={file} place={`${place} of ${files.length}`} />}
          </div>
        </div>
      )}

      {pullRequest.state === "open" &&
        (closing ? (
          <ConfirmStep
            question={`Close PR #${pullRequest.number}?`}
            confirmLabel="Close PR"
            onCancel={() => setClosing(false)}
            confirm={() => end({ kind: "close" })}
          >
            It closes on GitHub without merging, and this session ends: its branch and worktree are
            cleared away once no turn is running.
          </ConfirmStep>
        ) : (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-3">
              <ThumbButton
                look="primary"
                grow={3}
                disabled={merge.kind === "refused" || merging}
                aria-describedby={merge.kind === "refused" ? "merge-refused" : undefined}
                onClick={() => void mergeNow()}
              >
                <GitMerge aria-hidden />
                Merge
              </ThumbButton>
              <ThumbButton look="quiet" onClick={() => setClosing(true)}>
                Close PR
              </ThumbButton>
            </div>
            {merge.kind === "refused" && (
              <p id="merge-refused" className="text-meta text-muted-foreground">
                {merge.reason}
              </p>
            )}
            <FormError message={problem} />
          </div>
        ))}
    </section>
  );
}
