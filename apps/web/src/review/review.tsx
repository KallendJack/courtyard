import type {
  ModelRef,
  PullRequest,
  PullRequestReview,
  PullRequestSessionStart,
  SessionId,
  WorkspaceId,
} from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { Check, GitMerge, Info, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AskLine } from "@/components/ask-line";
import { BackLink } from "@/components/back-link";
import { Button, IconButton } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { CapsLabel } from "@/components/caps-label";
import { ConfirmStep } from "@/components/confirm-step";
import { FileTree, lineCounts } from "@/components/file-tree";
import { FormError } from "@/components/form-error";
import { type Layout, useLayout } from "@/components/handheld";
import { Notice } from "@/components/notice";
import { ThumbButton } from "@/components/thumb-button";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import { useAction } from "@/lib/use-action";
import { startLiveUpdate } from "../live/api.ts";
import { updateOffer, useLive } from "../live/main-build.tsx";
import { describeProblem } from "../problems.tsx";
import { Answer } from "../sessions/answer.tsx";
import type { Turn } from "../sessions/events.ts";
import { type FromWorker, loadProviders } from "../worker.ts";
import {
  bringUpToDate,
  codingModelIn,
  endPullRequest,
  loadReview,
  type ReviewOf,
  startOnPullRequest,
} from "./api.ts";
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
        pullRequest.conflicts,
      ]);

const filesSaid = (count: number) => (count === 1 ? "1 file" : `${count} files`);

/**
 * How often the page of a pull request no session opened asks for it again while it's open (#329),
 * as no session's events say when it changes.
 */
const FOLLOW_EVERY_MS = 15 * 1000;

/**
 * Where the answers to what the owner asks from a PR page start, for each session: how many turns
 * it had when last asked (#278). Kept while the app is open, so the answer still shows once the
 * page is opened again, or opened for a session the ask line just started.
 */
const askedFrom = new Map<SessionId, number>();

/** The session a pull request is from, for its page's ask line and the answers it shows. */
export type AskingSession = {
  readonly id: SessionId;
  readonly turns: readonly Turn[];
  /** Sends a message on the model the session last used: an error to show, or nothing. */
  readonly send: (text: string) => Promise<string | undefined>;
};

/**
 * A pull request's page (#160, #240, #278; Paper, "PR page: checks passed, ask line",
 * "conflicts" and "merged, folded"), for a session's own or one no session opened. From a tablet
 * up it fits one screen and never scrolls as a whole: its title, where it stands and its main
 * action stay in view, What changed takes one line, and the changed files' tree and the chosen
 * file's diff take the height that's left, each scrolling inside. A desktop has Close PR and the
 * main action beside the title and the latest answer in a card above the ask line; a tablet has
 * them as thumb buttons at the foot, the answer in What changed's place. Merged or closed, it folds
 * to one card with what to do next. On a phone it stacks and scrolls, as its agreed board has it.
 * Loaded only when it's opened, with its own stylesheet.
 */
export default function Review(props: {
  workspaceId: WorkspaceId;
  of: ReviewOf;
  /** The title until GitHub has given one: the session's, or the pull request's number. */
  fallbackTitle: string;
  /**
   * The pull request as its session's events have it now, once they've arrived: the review is
   * asked for again as it changes.
   */
  pullRequest?: PullRequest | undefined;
  /** The session it's from, when one is: what the ask line asks, and its answers. */
  session?: AskingSession;
  /** Shows the session's conversation: Bring up to date has sent it a message. */
  onShowSession?: () => void;
}) {
  const { of } = props;
  const [changes, setChanges] = useState(0);
  const version = versionOf(props.pullRequest);
  const [review, setReview] = useState<FromWorker<PullRequestReview>>();
  const key = of.kind === "session" ? of.sessionId : `${of.workspaceId}#${of.number}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again each time the pull request changes, or once it's merged or closed from here
  useEffect(() => {
    let current = true;
    void loadReview(of).then((loaded) => {
      if (current) setReview(loaded);
    });
    return () => {
      current = false;
    };
  }, [key, version, changes]);

  const loaded = review?.kind === "loaded" ? review.data : undefined;
  // One no session opened is asked for again every so often while it's open, so its checks and
  // Merge follow GitHub; one that can't be asked for just now keeps showing as it was.
  const following = of.kind === "number" && loaded?.pullRequest.state === "open";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `of` is the same pull request while `key` is
  useEffect(() => {
    if (!following) return;
    let current = true;
    const timer = setInterval(() => {
      void loadReview(of).then((again) => {
        if (current && again.kind === "loaded") setReview(again);
      });
    }, FOLLOW_EVERY_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [key, following]);
  const pullRequest = loaded?.pullRequest ?? props.pullRequest;
  const title =
    pullRequest === undefined
      ? props.fallbackTitle
      : `#${pullRequest.number} ${pullRequest.title ?? props.fallbackTitle}`;

  return (
    // Where the review's own classes apply (review.css): inside it, so not on itself.
    <div data-review="" className="contents">
      <main className="mx-auto flex w-full flex-col px-4 pt-6 pb-6 md:h-full md:min-h-0 md:px-4.5 md:pt-5 md:pb-4 xl:px-7">
        {review === undefined || review.kind !== "loaded" ? (
          <div className="flex flex-col gap-2">
            <BackLink workspaceId={props.workspaceId} pullRequests />
            <h1 className="display-title text-xl/7.5 wrap-anywhere xl:text-title">{title}</h1>
            {review === undefined ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Asking GitHub for the pull request…
              </p>
            ) : (
              <div className="mt-2">
                <Notice title="The pull request couldn't be shown">
                  {describeProblem(review).body}
                </Notice>
              </div>
            )}
          </div>
        ) : (
          <Reviewing
            key={review.data.pullRequest.number}
            {...props}
            title={title}
            review={review.data}
            onChanged={() => setChanges((was) => was + 1)}
          />
        )}
      </main>
    </div>
  );
}

/** The quick asks beside the ask line, for where the pull request stands. */
const quickAsks = (review: PullRequestReview) => {
  const { pullRequest } = review;
  if (pullRequest.conflicts) return ["Why does it conflict?", "Explain this change"];
  switch (pullRequest.checks.kind) {
    case "failed":
      return ["Fix the failing check", "Explain this change"];
    case "passed":
      return ["Explain this change", "What could break?"];
    default:
      return ["Can this be merged?", "Explain this change"];
  }
};

/**
 * The first model that codes, which a session started on a pull request works with: the one a new
 * session would start with, among those that code.
 */
const codingModel = async () => {
  const providers = await loadProviders();
  return providers.kind === "loaded" ? codingModelIn(providers.data.providers) : undefined;
};

/** A session about to start on a pull request no session opened, shown before it starts. */
type Starting = {
  readonly start: PullRequestSessionStart;
  readonly model: { readonly ref: ModelRef; readonly label: string };
};

function Reviewing(props: {
  workspaceId: WorkspaceId;
  of: ReviewOf;
  title: string;
  review: PullRequestReview;
  session?: AskingSession;
  onShowSession?: () => void;
  /** It was merged or closed from here: it's asked for again. */
  onChanged: () => void;
}) {
  const { of, review, session } = props;
  const { pullRequest, files, merge } = review;
  const layout = useLayout();
  const navigate = useNavigate();
  /** The whole description is open, with the files folded into one bar. */
  const [reading, setReading] = useState(false);
  /** Merged or closed, its changes are shown again. */
  const [unfolded, setUnfolded] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState<Starting>();
  /** Merge was tapped while it can't merge: why shows beside it, until it can (#329). */
  const [askedWhy, setAskedWhy] = useState(false);
  const [, setDismissed] = useState(0);
  const diff = useRef<HTMLDivElement>(null);
  const file = files.find((one) => one.path === chosen) ?? files[0];
  const place = file === undefined ? 0 : files.indexOf(file) + 1;
  const open = pullRequest.state === "open";
  const conflicts = open && pullRequest.conflicts === true;
  const desktop = layout === "desktop";

  const choose = (path: string) => {
    setChosen(path);
    // On a narrow screen the diff is below the tree: it comes into view.
    const top = diff.current?.getBoundingClientRect().top;
    if (top !== undefined && top > window.innerHeight * 0.6) {
      diff.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };

  /** Merges or closes it, then asks for it again: an error to show, or nothing once it's done. */
  const endNow = async (how: Parameters<typeof endPullRequest>[1]) => {
    const ended = await endPullRequest(of, how);
    if (ended.kind !== "loaded") return describeProblem(ended).body;
    setClosing(false);
    props.onChanged();
    return undefined;
  };
  const end = useAction(endNow);

  /** Asks a session started on this pull request's branch, once the owner has seen what starts. */
  const offerStart = async (start: (model: ModelRef) => PullRequestSessionStart) => {
    const model = await codingModel();
    if (model === undefined) return "No model that codes is available right now.";
    setStarting({ start: start(model.ref), model: { ref: model.ref, label: model.label } });
    return undefined;
  };

  const bring = useAction(async () => {
    if (session === undefined) {
      return offerStart((model) => ({ kind: "bring-up-to-date", model }));
    }
    const brought = await bringUpToDate(session.id);
    if (brought.kind !== "loaded") return describeProblem(brought).body;
    props.onShowSession?.();
    return undefined;
  });

  const ask = async (text: string) => {
    if (session === undefined) return offerStart((model) => ({ kind: "ask", text, model }));
    const before = session.turns.length;
    const problem = await session.send(text);
    if (problem === undefined) {
      askedFrom.set(session.id, before);
      setDismissed((was) => was + 1);
    }
    return problem;
  };

  const start = useAction(async () => {
    if (starting === undefined || of.kind !== "number") return undefined;
    const started = await startOnPullRequest(of, starting.start);
    if (started.kind !== "loaded") return describeProblem(started).body;
    const id = started.data.id;
    const asking = starting.start.kind === "ask";
    if (asking) askedFrom.set(id, 0);
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: props.workspaceId, sessionId: id },
      // The answer to a question shows on the pull request's page; bringing it up to date, in
      // the session.
      search: asking ? { view: "review" } : {},
    });
    return undefined;
  });

  const baseline = session === undefined ? undefined : askedFrom.get(session.id);
  const answering =
    session === undefined || baseline === undefined
      ? undefined
      : { turn: session.turns[baseline], queued: session.turns.length <= baseline };
  const dismiss = () => {
    if (session !== undefined) askedFrom.delete(session.id);
    setDismissed((was) => was + 1);
  };
  const answer =
    answering === undefined ? undefined : (
      <AnswerCard
        turn={answering.turn}
        passed={pullRequest.checks.kind === "passed" && !conflicts}
        layout={layout}
        onDismiss={dismiss}
      />
    );

  const mainAction = conflicts ? (
    <ThumbButton
      look="primary"
      grow={3}
      fit={desktop}
      disabled={bring.busy}
      onClick={() => void bring.run()}
    >
      <RefreshCw aria-hidden />
      Bring up to date
    </ThumbButton>
  ) : (
    // Greyed out while it can't merge, but a tap says why rather than nothing.
    <ThumbButton
      look="primary"
      grow={3}
      fit={desktop}
      disabled={end.busy}
      aria-disabled={merge.kind === "refused" ? true : undefined}
      aria-describedby={merge.kind === "refused" ? "merge-refused" : undefined}
      onClick={() =>
        merge.kind === "refused"
          ? setAskedWhy(true)
          : void end.run({ kind: "merge", head: pullRequest.head })
      }
    >
      <GitMerge aria-hidden />
      Merge
    </ThumbButton>
  );
  const whyWaits = askedWhy && !conflicts && merge.kind === "refused" && (
    <p
      role="status"
      aria-label="Why Merge waits"
      className="text-sm font-medium text-muted-foreground"
    >
      {merge.reason}
    </p>
  );
  const closeAction = (
    <ThumbButton look="quiet" fit={desktop} onClick={() => setClosing(true)}>
      Close PR
    </ThumbButton>
  );
  const actions = open && !closing && starting === undefined;
  const problem = end.error ?? bring.error;

  const status = (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-meta/4">
      <ChecksState pullRequest={pullRequest} base={review.base} chip />
      <span className="min-w-0 truncate font-mono text-primary-text">{review.branch}</span>
      <span className="font-medium text-muted-foreground">
        · {filesSaid(pullRequest.changes.files)} · {lineCounts(pullRequest.changes)}
      </span>
      {open && !conflicts && merge.kind === "refused" && (
        <span id="merge-refused" className="font-medium text-muted-foreground">
          · {merge.reason}
        </span>
      )}
    </p>
  );

  return (
    <section aria-label="Review" className="flex flex-col gap-3.5 md:min-h-0 md:flex-1">
      <div className="flex shrink-0 items-end gap-4 pt-0.5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <BackLink workspaceId={props.workspaceId} pullRequests />
          <h1 className="display-title text-xl/7.5 wrap-anywhere xl:text-title">{props.title}</h1>
          {status}
        </div>
        {desktop && actions && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex gap-2.5">
              {closeAction}
              {mainAction}
            </div>
            {whyWaits}
          </div>
        )}
      </div>

      {!open && !unfolded ? (
        <Folded
          workspaceId={props.workspaceId}
          review={review}
          fromSession={session !== undefined}
          onUnfold={() => setUnfolded(true)}
        />
      ) : (
        <>
          {closing && (
            <ConfirmStep
              question={`Close PR #${pullRequest.number}?`}
              confirmLabel="Close PR"
              onCancel={() => setClosing(false)}
              confirm={() => endNow({ kind: "close" })}
            >
              It closes on GitHub without merging
              {session === undefined
                ? "."
                : ", and its session ends: its branch and worktree are cleared away once no turn is running."}
            </ConfirmStep>
          )}

          {/* On a tablet or phone, the latest answer takes What changed's place (✕ goes back). */}
          {answer !== undefined && !desktop ? (
            answer
          ) : (
            <WhatChanged body={review.body} open={reading} onOpen={setReading} />
          )}

          {reading ? (
            <div className="flex min-h-13 shrink-0 items-center justify-between gap-3 rounded-card border bg-surface py-2 pr-3 pl-4">
              <p className="text-interface font-semibold">
                {filesSaid(files.length)} changed · {lineCounts(pullRequest.changes)}
              </p>
              <Button variant="outline" size="sm" onClick={() => setReading(false)}>
                View the diff
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[12.25rem_minmax(0,1fr)] xl:grid-cols-[16.25rem_minmax(0,1fr)]">
              {files.length > 0 ? (
                <FileTree files={files} chosen={file?.path} onChoose={choose} />
              ) : (
                <p className="rounded-card bg-surface p-4 text-sm text-muted-foreground">
                  It changes no files.
                </p>
              )}
              <div ref={diff} className="flex min-w-0 scroll-mt-4 flex-col md:min-h-0">
                {file !== undefined && <Diff file={file} place={`${place} of ${files.length}`} />}
              </div>
            </div>
          )}

          {desktop && answer}

          {starting !== undefined ? (
            <StartSession
              branch={review.branch}
              starting={starting}
              busy={start.busy}
              error={start.error}
              onStart={() => void start.run()}
              onCancel={() => setStarting(undefined)}
            />
          ) : (
            open && (
              <AskLine
                label="Ask about this PR"
                placeholder="Ask about this PR…"
                quick={quickAsks(review)}
                ask={ask}
              />
            )
          )}

          {!desktop && actions && (
            <div className="flex shrink-0 flex-col gap-1.5">
              <div className="flex gap-3">
                {mainAction}
                {closeAction}
              </div>
              {whyWaits}
            </div>
          )}
          <FormError message={problem} />
        </>
      )}
    </section>
  );
}

/**
 * The latest answer to what the owner asked from the page (#278): the question, then the answer
 * as it comes, in a card whose height is capped, scrolling inside it. A check when the pull
 * request's checks passed, else an i.
 */
function AnswerCard(props: {
  turn: Turn | undefined;
  passed: boolean;
  layout: Layout;
  onDismiss: () => void;
}) {
  const { turn } = props;
  return (
    <section
      aria-label="Answer"
      className="flex max-h-40 shrink-0 items-start gap-3 rounded-card border border-primary/25 bg-primary/8 py-3 pr-2.5 pl-3.5 xl:pl-4"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-text [&_svg]:size-3.5">
        {props.passed ? <Check aria-hidden /> : <Info aria-hidden />}
      </span>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 self-stretch">
        <CapsLabel tone="muted">{turn?.text ?? "Asked"}</CapsLabel>
        <div className="min-h-0 overflow-y-auto text-interface font-medium">
          {turn === undefined ? (
            <p className="text-muted-foreground">Asks once the turn running now ends.</p>
          ) : turn.answer === "" ? (
            <p className="text-muted-foreground">
              {turn.state.kind === "running" ? "Asking the session…" : "No answer came."}
            </p>
          ) : (
            <Answer
              text={turn.answer}
              running={turn.state.kind === "running"}
              replayed={turn.answer.length}
              compact
            />
          )}
        </div>
      </div>
      <IconButton label="Close the answer" icon={<X />} size="md" onClick={props.onDismiss} />
    </section>
  );
}

/**
 * What starts before it starts (AGENTS.md, Tap or talk): a session on the pull request's branch,
 * the model it works with, and its first message.
 */
function StartSession(props: {
  branch: string;
  starting: Starting;
  busy: boolean;
  error: string | undefined;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { start } = props.starting;
  return (
    <section
      aria-label="Start a session"
      className="flex shrink-0 flex-col gap-3 rounded-card border border-primary/25 bg-primary/8 px-4 py-3.5"
    >
      <p className="text-interface">
        <span className="font-semibold">No session is on this pull request.</span> Start one on{" "}
        <span className="font-mono text-primary-text">{props.branch}</span> with{" "}
        {props.starting.model.label},{" "}
        {start.kind === "ask" ? `asking “${start.text}”` : "to merge main in and fix the conflict"}?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={props.busy} onClick={props.onStart}>
          Start the session
        </Button>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
      <FormError message={props.error} />
    </section>
  );
}

/** "at 19:42" today, else "on 2 Oct". */
const whenSaid = (iso: string) => {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? `at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : `on ${date.toLocaleDateString([], { day: "numeric", month: "short" })}`;
};

/**
 * A merged or closed pull request, folded to one card (#278; Paper, "PR page: merged, folded"):
 * what happened, how much it changed, and what to do next: Update Courtyard when the worker is a
 * live copy that main has moved on from (quiet while main's build runs, gone if it failed, #249),
 * Start a new session, and Show the changes.
 */
function Folded(props: {
  workspaceId: WorkspaceId;
  review: PullRequestReview;
  fromSession: boolean;
  onUnfold: () => void;
}) {
  const { review } = props;
  const merged = review.pullRequest.state === "merged";
  const navigate = useNavigate();
  // Update follows main's build as the home page's does (#249): offered once it has passed.
  const [live] = useLive(merged);
  const offer = updateOffer(live?.kind === "loaded" ? live.data : undefined);
  const update = useAction(async () => {
    const started = await startLiveUpdate();
    // Already running, from another device: the home page follows that one.
    if (started.kind !== "loaded" && !(started.kind === "failed" && started.status === 409)) {
      return describeProblem(started).body;
    }
    // The home page says how the update goes, and carries on once Courtyard is back.
    await navigate({ to: "/" });
    return undefined;
  });
  const offersUpdate = offer === "ready" || offer === "waiting";
  const what = merged
    ? `Merged into ${review.base}${review.mergedAt === undefined ? "" : ` ${whenSaid(review.mergedAt)}`}`
    : "Closed without merging";
  const size = `${filesSaid(review.pullRequest.changes.files)} · ${lineCounts(review.pullRequest.changes)}`;

  return (
    <section
      aria-label={merged ? "Merged" : "Closed"}
      className={classes(
        "flex w-full max-w-145 flex-col gap-4.5 rounded-tile border px-6 py-5.5",
        merged ? "border-success/25 bg-success/8" : "bg-surface",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={classes(
            "flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-4.5",
            merged ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <GitMerge aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-lg/5.5 font-bold">{what}</p>
          <p
            className={classes(
              "text-sm font-medium",
              merged ? "text-success" : "text-muted-foreground",
            )}
          >
            {size}
            {props.fromSession && " · its session has ended"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {offersUpdate && (
          <Button
            size="lg"
            variant={offer === "ready" ? "primary" : "outline"}
            disabled={offer !== "ready" || update.busy}
            onClick={() => void update.run()}
          >
            <RefreshCw aria-hidden />
            Update Courtyard
          </Button>
        )}
        <ButtonLink
          to="/workspaces/$workspaceId"
          params={{ workspaceId: props.workspaceId }}
          variant={offersUpdate ? "outline" : "primary"}
          size="lg"
        >
          Start a new session
        </ButtonLink>
        <Button variant="quietPrimary" size="lg" onClick={props.onUnfold}>
          Show the changes
        </Button>
      </div>
      <FormError message={update.error} />
    </section>
  );
}
