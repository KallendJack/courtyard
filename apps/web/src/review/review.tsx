import type {
  Effort,
  ModelRef,
  ProviderList,
  PullRequest,
  PullRequestReview,
  QuickLine,
  QuickQuestions,
  SessionId,
  WorkspaceId,
} from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { GitMerge, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AskLine } from "@/components/ask-line";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { ConfirmStep } from "@/components/confirm-step";
import { FileTree, lineCounts } from "@/components/file-tree";
import { FormError } from "@/components/form-error";
import { useLayout } from "@/components/handheld";
import { createKept, PlaceholderRows, useKept } from "@/components/kept";
import { Notice } from "@/components/notice";
import { Select } from "@/components/select";
import { ThumbButton } from "@/components/thumb-button";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import { useAction } from "@/lib/use-action";
import { startLiveUpdate } from "../live/api.ts";
import { updateOffer, useLive } from "../live/main-build.tsx";
import { describeProblem } from "../problems.tsx";
import { loadProviders } from "../worker.ts";
import {
  askingModelIn,
  askQuickQuestion,
  bringUpToDate,
  codingModelIn,
  endPullRequest,
  fixInSession,
  loadQuickQuestions,
  loadReview,
  type ReviewOf,
  startOnPullRequest,
} from "./api.ts";
import { ChecksState } from "./checks.tsx";
import { Diff } from "./diff.tsx";
import { QuickQuestionsPanel } from "./quick-questions.tsx";
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

/** Each pull request's review as last known, for the tab's lifetime, by its session or number. */
const KEPT_REVIEWS = createKept<PullRequestReview>();

const filesSaid = (count: number) => (count === 1 ? "1 file" : `${count} files`);

/**
 * The session a pull request is from: Bring up to date and Fix it in a session go to it, on the
 * model it last used.
 */
export type PullRequestSession = {
  readonly id: SessionId;
  /** The model and effort it last used, once it has one. */
  readonly last: { readonly model: ModelRef; readonly effort?: Effort | undefined } | undefined;
};

/**
 * A pull request's page (#160, #240, #278, #327; Paper, "PR page: checks passed, ask line",
 * "conflicts", "merged, folded" and "quick questions"), for a session's own or one no session
 * opened. From a tablet up it fits one screen and never scrolls as a whole: its title, where it
 * stands and its main action stay in view, What changed takes one line, and the changed files'
 * tree and the chosen file's diff take the height that's left, each scrolling inside. A desktop
 * has Close PR and the main action beside the title; a tablet has them as thumb buttons at the
 * foot. The ask line asks quick questions, which open beside the diff (see `QuickQuestionsPanel`).
 * Merged or closed, it folds to one card with what to do next. On a phone it stacks and scrolls,
 * as its agreed board has it. Loaded only when it's opened, with its own stylesheet.
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
  /** The session it's from, when one is. */
  session?: PullRequestSession;
  /** Shows the session's conversation: Bring up to date or Fix it in a session sent it a message. */
  onShowSession?: () => void;
}) {
  const { of } = props;
  const [changes, setChanges] = useState(0);
  const version = versionOf(props.pullRequest);
  const key = of.kind === "session" ? of.sessionId : `${of.workspaceId}#${of.number}`;
  /** Why the review couldn't be shown, the last time it was asked for, and whose it was. */
  const [problem, setProblem] = useState<{ key: string; why: string }>();
  // The last review known shows at once, asked for again quietly each time the pull request
  // changes, or once it's merged or closed from here (owner, 2026-10-12: nothing jumps in).
  const loaded = useKept(KEPT_REVIEWS, {
    key,
    load: async () => {
      const asked = await loadReview(of);
      if (asked.kind === "loaded") return asked.data;
      setProblem({ key, why: describeProblem(asked).body });
      return undefined;
    },
    again: `${version}:${changes}`,
  });
  const failed = loaded === undefined && problem?.key === key ? problem.why : undefined;
  const pullRequest = loaded?.pullRequest ?? props.pullRequest;
  const title =
    pullRequest === undefined
      ? props.fallbackTitle
      : `#${pullRequest.number} ${pullRequest.title ?? props.fallbackTitle}`;

  return (
    // Where the review's own classes apply (review.css): inside it, so not on itself.
    <div data-review="" className="contents">
      <main className="mx-auto flex w-full flex-col px-4 pt-6 pb-6 md:h-full md:min-h-0 md:px-4.5 md:pt-5 md:pb-4 xl:px-7">
        {loaded === undefined ? (
          <div className="flex flex-col gap-3.5 md:min-h-0 md:flex-1">
            {/* Laid out as the review's own heading is, so the title stays put when it comes. */}
            <div className="flex shrink-0 flex-col gap-2 pt-0.5">
              <BackLink workspaceId={props.workspaceId} pullRequests />
              <h1 className="display-title text-xl/7.5 wrap-anywhere xl:text-title">{title}</h1>
              {failed === undefined && <PlaceholderRows count={1} size="label" />}
            </div>
            {failed === undefined ? (
              // Nothing known yet: faint rows in the page's shape, What changed then its files,
              // filled in place once GitHub answers.
              <>
                <PlaceholderRows count={1} />
                <PlaceholderRows count={1} size="panel" />
              </>
            ) : (
              <Notice title="The pull request couldn't be shown">{failed}</Notice>
            )}
          </div>
        ) : (
          <Reviewing
            key={loaded.pullRequest.number}
            {...props}
            title={title}
            review={loaded}
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
      return ["Why did the check fail?", "Explain this change"];
    case "passed":
      return ["Explain this change", "What could break?"];
    default:
      return ["Can this be merged?", "Explain this change"];
  }
};

/** The quick ask beside a follow-up, once quick questions are open. */
const FOLLOW_UP_ASKS = ["What could break?"];

/**
 * The first model that codes, which a session started on a pull request works with: the one a new
 * session would start with, among those that code.
 */
const codingModel = async () => {
  const providers = await loadProviders();
  return providers.kind === "loaded" ? codingModelIn(providers.data.providers) : undefined;
};

/**
 * A session about to start on a pull request no session opened, shown before it starts: to bring
 * it up to date, or to fix what came up in its quick questions (#327).
 */
type Starting = {
  readonly kind: "bring-up-to-date" | "fix";
  readonly model: { readonly ref: ModelRef; readonly label: string };
};

function Reviewing(props: {
  workspaceId: WorkspaceId;
  of: ReviewOf;
  title: string;
  review: PullRequestReview;
  session?: PullRequestSession;
  onShowSession?: () => void;
  /** It was merged or closed from here: it's asked for again. */
  onChanged: () => void;
}) {
  const { review, session } = props;
  const { pullRequest, files, merge } = review;
  const pull = { workspaceId: props.workspaceId, number: pullRequest.number };
  const layout = useLayout();
  const navigate = useNavigate();
  /** The whole description is open, with the files folded into one bar. */
  const [reading, setReading] = useState(false);
  /** Merged or closed, its changes are shown again. */
  const [unfolded, setUnfolded] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState<Starting>();
  /** The quick questions asked so far (#327), and whether they're open on the page. */
  const [questions, setQuestions] = useState<QuickQuestions>({ model: null, asked: [] });
  const [asking, setAsking] = useState(false);
  /** A question asked whose answer hasn't come yet. */
  const [pending, setPending] = useState<string>();
  /** The line an answer pointed at, shown marked in the diff. */
  const [marked, setMarked] = useState<QuickLine>();
  const [providers, setProviders] = useState<ProviderList["providers"]>();
  const diff = useRef<HTMLDivElement>(null);
  const file = files.find((one) => one.path === chosen) ?? files[0];
  const place = file === undefined ? 0 : files.indexOf(file) + 1;
  const open = pullRequest.state === "open";
  const conflicts = open && pullRequest.conflicts === true;
  const desktop = layout === "desktop";
  const cover = layout === "cover";
  const panelOpen = open && asking;
  const asked = questions.asked.length > 0;

  // What was asked before, kept by the worker, and the models to ask with.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once for each pull request
  useEffect(() => {
    let current = true;
    void loadQuickQuestions(pull).then((loaded) => {
      if (!current || loaded.kind !== "loaded") return;
      setQuestions(loaded.data);
      // Kept from before, they open again, except over a phone's diff.
      if (loaded.data.asked.length > 0 && layout !== "cover") setAsking(true);
    });
    void loadProviders().then((loaded) => {
      if (current && loaded.kind === "loaded") setProviders(loaded.data.providers);
    });
    return () => {
      current = false;
    };
  }, [pull.workspaceId, pull.number]);

  const askingModel =
    providers === undefined ? undefined : askingModelIn(providers, questions.model);

  const choose = (path: string) => {
    setChosen(path);
    setMarked(undefined);
    // On a narrow screen the diff is below the tree: it comes into view.
    const top = diff.current?.getBoundingClientRect().top;
    if (top !== undefined && top > window.innerHeight * 0.6) {
      diff.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };

  /** Shows a line an answer points at, marked, in the diff; on a phone the sheet makes way. */
  const point = (line: QuickLine) => {
    setChosen(line.path);
    setMarked(line);
    if (cover) setAsking(false);
  };

  /** Merges or closes it, then asks for it again: an error to show, or nothing once it's done. */
  const endNow = async (how: Parameters<typeof endPullRequest>[1]) => {
    const ended = await endPullRequest(props.of, how);
    if (ended.kind !== "loaded") return describeProblem(ended).body;
    setClosing(false);
    props.onChanged();
    return undefined;
  };
  const end = useAction(endNow);

  /** Asks a session started on this pull request's branch, once the owner has seen what starts. */
  const offerStart = async (kind: Starting["kind"]) => {
    const model = await codingModel();
    if (model === undefined) return "No model that codes is available right now.";
    setStarting({ kind, model: { ref: model.ref, label: model.label } });
    return undefined;
  };

  const bring = useAction(async () => {
    if (session === undefined) return offerStart("bring-up-to-date");
    const brought = await bringUpToDate(session.id);
    if (brought.kind !== "loaded") return describeProblem(brought).body;
    props.onShowSession?.();
    return undefined;
  });

  /** A quick question (#327): the conversation opens on the page, and the answer comes into it. */
  const ask = async (text: string) => {
    const model = askingModel ?? (await askingModelNow(questions));
    if (model === undefined) return "No model is available to ask right now.";
    setAsking(true);
    setReading(false);
    setPending(text);
    const answered = await askQuickQuestion(pull, { text, model: model.ref });
    setPending(undefined);
    if (answered.kind !== "loaded") return describeProblem(answered).body;
    setQuestions(answered.data);
    return undefined;
  };

  /**
   * Fix it in a session (#327): the conversation carried over to the pull request's session, on
   * the model it last used; or, with none, to a new one on its branch once the owner has seen it.
   */
  const fix = useAction(async () => {
    if (session === undefined) return offerStart("fix");
    if (session.last === undefined) return "This session has no model to send it with yet.";
    const { model, effort } = session.last;
    const fixed = await fixInSession(pull, { model, ...(effort === undefined ? {} : { effort }) });
    if (fixed.kind !== "loaded") return describeProblem(fixed).body;
    props.onShowSession?.();
    return undefined;
  });

  const start = useAction(async () => {
    if (starting === undefined) return undefined;
    const started =
      starting.kind === "fix"
        ? await fixInSession(pull, { model: starting.model.ref })
        : await startOnPullRequest(pull, { kind: "bring-up-to-date", model: starting.model.ref });
    if (started.kind !== "loaded") return describeProblem(started).body;
    const sessionId = "sessionId" in started.data ? started.data.sessionId : started.data.id;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: props.workspaceId, sessionId },
    });
    return undefined;
  });

  const mainAction = conflicts ? (
    <ThumbButton
      look="primary"
      grow={3}
      fit={desktop}
      busy={bring.busy}
      busyLabel="Bringing up to date…"
      onClick={() => void bring.run()}
    >
      <RefreshCw aria-hidden />
      Bring up to date
    </ThumbButton>
  ) : (
    <ThumbButton
      look="primary"
      grow={3}
      fit={desktop}
      disabled={merge.kind === "refused"}
      busy={end.busy}
      busyLabel="Merging…"
      aria-describedby={merge.kind === "refused" ? "merge-refused" : undefined}
      onClick={() => void end.run({ kind: "merge", head: pullRequest.head })}
    >
      <GitMerge aria-hidden />
      Merge
    </ThumbButton>
  );
  const closeAction = (
    <ThumbButton
      look="quiet"
      fit={desktop}
      waiting={end.busy || bring.busy}
      onClick={() => setClosing(true)}
    >
      Close PR
    </ThumbButton>
  );
  // On a phone the quick questions' sheet covers the foot, so they come back once it closes.
  const actions = open && !closing && starting === undefined && !(cover && panelOpen);
  const problem = end.error ?? bring.error ?? fix.error;

  const askLine = (
    <AskLine
      label="Ask about this PR"
      placeholder={asked ? "Ask a follow-up…" : "Ask about this PR…"}
      quick={asked ? FOLLOW_UP_ASKS : quickAsks(review)}
      actions={[
        ...(asked && !panelOpen ? [{ label: "Quick questions", run: () => setAsking(true) }] : []),
        ...(asked
          ? [
              {
                label: "Fix it in a session",
                run: () => void fix.run(),
                busy: fix.busy,
                busyLabel: "Starting…",
              },
            ]
          : []),
      ]}
      ask={ask}
    />
  );

  const panel = panelOpen ? (
    <QuickQuestionsPanel
      look={cover ? "sheet" : "panel"}
      model={askingModel?.name}
      asked={questions.asked}
      pending={pending}
      onClose={() => setAsking(false)}
      onPoint={point}
      {...(cover && starting === undefined ? { foot: askLine } : {})}
    />
  ) : null;

  // On a tablet the quick questions take the file list's place, which folds into a switcher
  // above the diff; on a desktop they sit beside both; on a phone they're a sheet over them.
  const folded = panelOpen && layout === "tablet";
  const placeShown =
    folded && files.length > 1 && file !== undefined ? (
      <Select
        look="pill"
        label="Choose a file"
        shown={`${place} of ${files.length} files`}
        options={files.map((one) => ({ value: one.path, label: one.path }))}
        value={file.path}
        onChange={choose}
      />
    ) : (
      `${place} of ${files.length}`
    );

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
          <div className="flex shrink-0 gap-2.5">
            {closeAction}
            {mainAction}
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
              busyLabel="Closing…"
              onCancel={() => setClosing(false)}
              confirm={() => endNow({ kind: "close" })}
            >
              It closes on GitHub without merging
              {session === undefined
                ? "."
                : ", and its session ends: its branch and worktree are cleared away once no turn is running."}
            </ConfirmStep>
          )}

          {/* On a tablet the quick questions take What changed's room too. */}
          {!folded && <WhatChanged body={review.body} open={reading} onOpen={setReading} />}

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
            <div
              className={classes(
                "grid gap-3 md:min-h-0 md:flex-1",
                folded
                  ? "md:grid-cols-2"
                  : panelOpen && desktop
                    ? "md:grid-cols-[12.25rem_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[16.25rem_minmax(0,1.25fr)_minmax(0,1fr)]"
                    : "md:grid-cols-[12.25rem_minmax(0,1fr)] xl:grid-cols-[16.25rem_minmax(0,1fr)]",
              )}
            >
              {folded && panel}
              {!folded &&
                (files.length > 0 ? (
                  <FileTree files={files} chosen={file?.path} onChoose={choose} />
                ) : (
                  <p className="rounded-card bg-surface p-4 text-sm text-muted-foreground">
                    It changes no files.
                  </p>
                ))}
              <div ref={diff} className="flex min-w-0 scroll-mt-4 flex-col md:min-h-0">
                {file !== undefined && (
                  <Diff
                    file={file}
                    place={placeShown}
                    marked={marked?.path === file.path ? marked.line : undefined}
                  />
                )}
              </div>
              {desktop && panel}
            </div>
          )}

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
            open && !(cover && panelOpen) && askLine
          )}

          {!desktop && actions && (
            <div className="flex shrink-0 gap-3">
              {mainAction}
              {closeAction}
            </div>
          )}
          <FormError message={problem} />
          {cover && panel}
        </>
      )}
    </section>
  );
}

/** The model to ask, from the providers asked for now: when the page hadn't had them yet. */
const askingModelNow = async (questions: QuickQuestions) => {
  const providers = await loadProviders();
  return providers.kind === "loaded"
    ? askingModelIn(providers.data.providers, questions.model)
    : undefined;
};

/**
 * What starts before it starts (AGENTS.md, Tap or talk): a session on the pull request's branch,
 * the model it works with, and what it's told to do.
 */
function StartSession(props: {
  branch: string;
  starting: Starting;
  busy: boolean;
  error: string | undefined;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { starting } = props;
  return (
    <section
      aria-label="Start a session"
      className="flex shrink-0 flex-col gap-3 rounded-card border border-primary/25 bg-primary/8 px-4 py-3.5"
    >
      <p className="text-interface">
        <span className="font-semibold">No session is on this pull request.</span> Start one on{" "}
        <span className="font-mono text-primary-text">{props.branch}</span> with{" "}
        {starting.model.label},{" "}
        {starting.kind === "fix"
          ? "carrying the quick questions over, to make the change they came to?"
          : "to merge main in and fix the conflict?"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button busy={props.busy} busyLabel="Starting…" onClick={props.onStart}>
          Start the session
        </Button>
        <Button variant="outline" waiting={props.busy} onClick={props.onCancel}>
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
            disabled={offer !== "ready"}
            busy={update.busy}
            busyLabel="Updating…"
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
