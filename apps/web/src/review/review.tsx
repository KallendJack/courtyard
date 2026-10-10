import type {
  PullRequest,
  PullRequestCheck,
  PullRequestReview,
  SessionId,
} from "@courtyard/contract";
import { Check, GitMerge, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmStep } from "@/components/confirm-step";
import { FileTree, lineCounts } from "@/components/file-tree";
import { FormError } from "@/components/form-error";
import { Notice } from "@/components/notice";
import { ThumbButton } from "@/components/thumb-button";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import { describeProblem } from "../problems.tsx";
import type { FromWorker } from "../worker.ts";
import { endPullRequest, loadReview } from "./api.ts";
import { Diff } from "./diff.tsx";
import css from "./review.css?inline";

// The review's own stylesheet (review.css), added once, when a review is first opened.
addStylesheet("review", css);

const PILL = "flex h-7 items-center gap-1.5 rounded-full px-2.5 font-mono text-xs/4";

/** How each check shows, as a pill: passed in moss, running in violet, failed in red. */
const CHECK_LOOK = {
  passed: { look: "bg-workspace-moss/12 text-code-string", said: "passed" },
  running: { look: "bg-primary/12 text-primary-text", said: "running" },
  failed: { look: "bg-destructive/12 text-destructive", said: "failed" },
  other: { look: "bg-muted text-muted-foreground", said: "skipped" },
} as const;

function CheckPill({ check }: { check: PullRequestCheck }) {
  const { look, said } = CHECK_LOOK[check.outcome];
  return (
    <li className={classes(PILL, look)}>
      {check.outcome === "passed" && <Check aria-hidden className="size-3.5" />}
      {check.outcome === "failed" && <X aria-hidden className="size-3.5" />}
      {check.outcome === "running" && (
        <span aria-hidden className="size-1.75 animate-pulse rounded-full bg-primary" />
      )}
      {check.name}
      <span className={check.outcome === "running" || check.outcome === "failed" ? "" : "sr-only"}>
        {` ${said}`}
      </span>
    </li>
  );
}

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

/**
 * A code session's pull request, reviewed on the phone (#160; Paper, Handheld · 18 and 04): its
 * checks, the files it changes as a small tree, the chosen file's diff, and Close PR and Merge in
 * thumb reach, Merge greyed out with its reason until it can merge. On a narrow screen the tree,
 * diff and buttons stack; from tablet width up, the tree sits beside the diff. Asking for changes
 * is a message in the session, from the message box below. Loaded only when it's opened, with its
 * own stylesheet.
 */
export default function Review(props: {
  sessionId: SessionId;
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
  const [chosen, setChosen] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [problem, setProblem] = useState<string>();
  const diff = useRef<HTMLDivElement>(null);

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

  if (review === undefined) {
    return (
      <div data-review="">
        <p className="mt-4 text-sm text-muted-foreground">Asking GitHub for the pull request…</p>
      </div>
    );
  }
  if (review.kind !== "loaded") {
    return (
      <div data-review="">
        <div className="mt-4">
          <Notice title="The pull request couldn't be shown">{describeProblem(review).body}</Notice>
        </div>
      </div>
    );
  }
  const { pullRequest, files, checks, merge } = review.data;
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
    // Where the review's own classes apply (review.css).
    <div data-review="">
      <section aria-label="Review" className="mt-4 flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {checks.length > 0 && (
            <ul aria-label="Checks" className="contents">
              {checks.map((check) => (
                <CheckPill key={check.name} check={check} />
              ))}
            </ul>
          )}
          <p className="px-1 font-mono text-xs/4 text-muted-foreground">
            {lineCounts(pullRequest.changes)}
          </p>
          <p className="min-w-0 truncate px-1 font-mono text-xs/4 text-placeholder max-md:basis-full">
            {review.data.branch} → {review.data.base}
          </p>
        </div>

        <div className="grid gap-3.5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:items-start">
          {files.length > 0 ? (
            <FileTree files={files} chosen={file?.path} onChoose={choose} />
          ) : (
            <p className="rounded-card bg-surface p-4 text-sm text-muted-foreground">
              It changes no files.
            </p>
          )}
          <div ref={diff} className="flex min-w-0 scroll-mt-4 flex-col gap-3.5">
            {file !== undefined && <Diff file={file} place={`${place} of ${files.length}`} />}

            {pullRequest.state === "open" &&
              (closing ? (
                <ConfirmStep
                  question={`Close PR #${pullRequest.number}?`}
                  confirmLabel="Close PR"
                  onCancel={() => setClosing(false)}
                  confirm={() => end({ kind: "close" })}
                >
                  It closes on GitHub without merging, and this session ends: its branch and
                  worktree are cleared away once no turn is running.
                </ConfirmStep>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2.5">
                    <ThumbButton look="quiet" onClick={() => setClosing(true)}>
                      Close PR
                    </ThumbButton>
                    <ThumbButton
                      look="main"
                      grow={1.6}
                      disabled={merge.kind === "refused" || merging}
                      aria-describedby={merge.kind === "refused" ? "merge-refused" : undefined}
                      onClick={() => void mergeNow()}
                    >
                      <GitMerge aria-hidden />
                      Merge
                    </ThumbButton>
                  </div>
                  {merge.kind === "refused" && (
                    <p
                      id="merge-refused"
                      className="text-right text-xs/[18px] text-muted-foreground"
                    >
                      {merge.reason}
                    </p>
                  )}
                  <FormError message={problem} />
                </div>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}
