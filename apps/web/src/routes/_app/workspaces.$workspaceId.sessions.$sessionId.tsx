import {
  type ModelRef,
  type NewMessage,
  type ProviderId,
  type ProviderList,
  SESSION_TITLE_MAX_LENGTH,
  type SessionDetail,
  type SkillSummary,
} from "@courtyard/contract";
import { createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { Clock, Pencil, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BackLink } from "@/components/buttons/back-link";
import { IconButton } from "@/components/buttons/button";
import { OptionsMenu } from "@/components/buttons/options-menu";
import { JumpToLatest } from "@/components/chat/jump-to-latest";
import { AllowingAllStrip } from "@/components/code/allowing-all";
import { BranchStrip } from "@/components/code/branch-strip";
import { ConfirmStep } from "@/components/forms/confirm-step";
import { FormError } from "@/components/forms/form-error";
import { RenameForm } from "@/components/forms/rename-form";
import { useLayout } from "@/components/frame/handheld";
import { PlaceholderRows } from "@/components/layout/kept";
import { Notice, StatusPill } from "@/components/layout/notice";
import { Page, PageTitle } from "@/components/layout/page";
import { carryOn, continueTurn, deleteSession, stopTurn } from "../../api/worker.ts";
import { renameSession } from "../../api/worker-calls.ts";
import { describeProblem, Problem } from "../../components/layout/problems.tsx";
import { UsageWarningCard } from "../../features/limits/usage-warning.tsx";
import { ReadSession } from "../../features/offline-copy/read-session.tsx";
import {
  ConfirmPreview,
  PreviewButton,
  PreviewPanel,
  usePreview,
} from "../../features/preview/preview.tsx";
import type { Steps } from "../../features/sessions/answer/steps.ts";
import { Composer, type StandIn } from "../../features/sessions/composer/composer.tsx";
import {
  allowAll,
  allowAllOff,
  removeQueued,
  sendMessage,
} from "../../features/sessions/composer/messages.ts";
import type { DocumentsHere } from "../../features/sessions/notes/documents.tsx";
import {
  type QueuedMessage,
  type Turn,
  useSessionTurns,
} from "../../features/sessions/turns/events.ts";
import { useSeen } from "../../features/sessions/turns/seen.ts";
import { SessionTurns } from "../../features/sessions/turns/session-turns.tsx";
import { RunningTaskRows } from "../../features/tasks/task-lines.tsx";
import { NextPill } from "../../features/waiting/next-pill.tsx";

// A code session's pull request, reviewed in place of the conversation (#160): loaded only then.
const Review = lazy(() => import("../../features/pull-requests/review.tsx"));
/** A code workspace's Lead's strip (#347), loaded only on its chat. */
const LeadStrip = lazy(() => import("../../features/sessions/turns/lead-strip.tsx"));
/** An answer's steps one at a time, in place of the conversation (#241): loaded only then. */
const StepByStep = lazy(() => import("../../features/step-by-step/step-by-step.tsx"));
/** Allow all for this task's choice of how long (#428): loaded when it first opens. */
const AllowAllSheet = lazy(() => import("../../components/sheets/allow-all-sheet.tsx"));

export const Route = createFileRoute("/_app/workspaces/$workspaceId/sessions/$sessionId")({
  validateSearch: (search: Record<string, unknown>): { view?: "review" } =>
    search.view === "review" ? { view: "review" } : {},
  // The loader stays in the first load, so it only imports what the page asks for.
  loader: ({ params, context }) =>
    import("../../api/session-page.ts").then((page) =>
      page.loadSessionPage(params, context.reading),
    ),
  component: SessionPage,
});

/** The workspaces the sidebar lists, which name the session's workspace. */
const appRoute = getRouteApi("/_app");

function SessionPage() {
  const { session, providers, skills, offline } = Route.useLoaderData();
  const workspaces = appRoute.useLoaderData();
  if (session.kind !== "loaded") return <Problem result={session} />;
  // Read from the device's copy (#106): the same page, read-only.
  if (offline !== undefined) {
    return <ReadSession key={session.data.id} session={session.data} offline={offline} />;
  }
  const workspace =
    workspaces.kind === "loaded"
      ? workspaces.data.workspaces.find((w) => w.id === session.data.workspaceId)
      : undefined;
  return (
    <Session
      // A new session starts from scratch, even when the router reuses this component.
      key={session.data.id}
      session={session.data}
      {...(workspace?.mode === "planning" && !session.data.workspaceArchived
        ? {
            documents: {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              sessionTitle: session.data.title,
            },
          }
        : {})}
      stepByStep={workspace?.mode === "planning"}
      providers={providers.kind === "loaded" ? providers.data.providers : []}
      {...(skills.kind === "loaded"
        ? {
            skills: {
              workspaceName: workspace?.name ?? "this workspace",
              list: skills.data.skills,
            },
          }
        : {})}
    />
  );
}

function Session(props: {
  session: SessionDetail;
  providers: ProviderList["providers"];
  skills?: { workspaceName: string; list: readonly SkillSummary[] };
  /** Where Save as document saves: a planning workspace that isn't archived. */
  documents?: DocumentsHere;
  /** Its answers with steps offer them one at a time: a planning workspace's (#241). */
  stepByStep: boolean;
}) {
  const { session } = props;
  const {
    turns,
    lastSeq: shownUpTo,
    modelTitle,
    pullRequest,
    allowAllChanged,
    queuedMessages,
    tasks,
    problem,
    reconnecting,
    ready,
  } = useSessionTurns(session.id);
  const removeQueuedMessage = useCallback(
    async (queued: number) => {
      const removed = await removeQueued({ sessionId: session.id, queued });
      // "Gone already" (409) needs no word: it's left the queue as a turn of its own.
      const goneAnyway = removed.kind === "failed" && removed.status === 409;
      return removed.kind === "loaded" || goneAnyway ? undefined : describeProblem(removed).body;
    },
    [session.id],
  );
  /** A queued message taken back into the Reply box to edit (#252), each time a new one. */
  const [draft, setDraft] = useState<{ text: string; key: number }>();
  const editQueuedMessage = useCallback(
    async (queued: QueuedMessage) => {
      const removed = await removeQueued({ sessionId: session.id, queued: queued.seq });
      if (removed.kind !== "loaded") {
        return removed.kind === "failed" && removed.status === 409
          ? "That message has gone already."
          : describeProblem(removed).body;
      }
      setDraft({ text: queued.text, key: queued.seq });
      return undefined;
    },
    [session.id],
  );
  const draftTaken = useCallback(() => setDraft(undefined), []);
  /** Its pull request was merged or closed, so it takes no more messages (#172). */
  const ended =
    pullRequest !== undefined && pullRequest.state !== "open" ? pullRequest.state : undefined;
  const [sendProblem, setSendProblem] = useState<string>();
  /** What the owner is doing to the session itself, if anything. */
  const [tidying, setTidying] = useState<"rename" | "delete">();
  const router = useRouter();
  const navigate = useNavigate();
  /** Its pull request's review shows in place of the conversation (#160). */
  const reviewing = Route.useSearch().view === "review" && session.branch !== undefined;
  const toConversation = useCallback(
    () =>
      navigate({
        to: "/workspaces/$workspaceId/sessions/$sessionId",
        params: { workspaceId: session.workspaceId, sessionId: session.id },
      }),
    [navigate, session.workspaceId, session.id],
  );
  const last = turns.at(-1);
  const running = last?.state.kind === "running";
  /** What's sent while it answers goes into the answer (#252), on a provider that steers. */
  const steers =
    running &&
    props.providers.some(
      (provider) =>
        provider.id === last?.model.provider && provider.available && provider.capabilities.steers,
    );
  // What the page shows, the owner has seen, on whichever device (#334).
  useSeen(session.id, shownUpTo, running);
  /** The latest answer offers suggested replies, so the message box says one's own is welcome too (#154). */
  const suggesting =
    last?.state.kind === "done" && last.replies.length > 0 && !session.workspaceArchived;

  /** The owner has scrolled back from the end to read, so Jump to latest shows (#168). */
  const [away, setAway] = useState(false);
  /** Goes to the end of the session and follows it again, once its turns are drawn. */
  const follow = useRef<() => void>(null);
  const toLatest = useCallback(() => follow.current?.(), []);

  /** The steps the owner is taking one at a time (#241), in place of the conversation. */
  const [stepping, setStepping] = useState<Steps>();
  const stepByStep = useCallback((_turn: Turn, steps: Steps) => setStepping(steps), []);

  const send = useCallback(
    async (message: NewMessage, files: readonly File[]) => {
      const sent = await sendMessage({ sessionId: session.id, message, files });
      if (sent.kind !== "loaded") return describeProblem(sent).body;
      // What the owner just sent is at the end, so that's where they go, out of step by step.
      setStepping(undefined);
      toLatest();
      return undefined;
    },
    [session.id, toLatest],
  );
  const runningTurn = running ? last?.seq : undefined;
  const stop = useCallback(async () => {
    if (runningTurn === undefined) return;
    const stopped = await stopTurn(session.id, runningTurn);
    // "Nothing is running" (409) is fine: the turn ended on its own just before the stop arrived.
    const finishedAnyway = stopped.kind === "failed" && stopped.status === 409;
    setSendProblem(
      stopped.kind === "loaded" || finishedAnyway ? undefined : describeProblem(stopped).body,
    );
  }, [session.id, runningTurn]);
  /** Sends a message with the model and effort of `turn`, the one it retries or answers. */
  const sendAfter = useCallback(
    async (turn: Turn, message: Pick<Turn, "text" | "skill">) => {
      const sent = await sendMessage({
        sessionId: session.id,
        message: {
          text: message.text,
          model: turn.model,
          ...(turn.effort === undefined ? {} : { effort: turn.effort }),
          ...(message.skill === undefined ? {} : { skill: message.skill }),
        },
      });
      setSendProblem(sent.kind === "loaded" ? undefined : describeProblem(sent).body);
      return sent.kind === "loaded";
    },
    [session.id],
  );
  // A retry sends the turn's message again, the skill the owner started with it included.
  const retry = useCallback((turn: Turn) => void sendAfter(turn, turn), [sendAfter]);
  // A suggested reply goes as the owner's message, with no skill tag.
  const reply = useCallback(
    (turn: Turn, text: string) => sendAfter(turn, { text, skill: undefined }),
    [sendAfter],
  );

  const carryOnFrom = useCallback(
    async (turn: Turn) => {
      const carried = await carryOn(session.id, turn.seq);
      return carried.kind === "loaded" ? undefined : describeProblem(carried).body;
    },
    [session.id],
  );

  // Continue (#186): the turn a restart cut off carries on, told so.
  const continueFrom = useCallback(
    async (turn: Turn) => {
      const continued = await continueTurn(session.id, turn.seq);
      return continued.kind === "loaded" ? undefined : describeProblem(continued).body;
    },
    [session.id],
  );

  // Once a turn the owner watched ends on a usage limit, or answers on a model shown at one, the
  // providers are asked again: the model picker shows the limit (or not), and the notice knows
  // where the session can carry on.
  const watchedTurn = useRef<number>(undefined);
  const lastSeq = last?.seq;
  const limitChanged =
    last?.state.kind === "failed"
      ? last.state.reason.kind === "rate-limited"
      : last?.state.kind === "done" &&
        props.providers.some(
          (provider) =>
            provider.available &&
            provider.id === last.model.provider &&
            provider.models.some((model) => model.id === last.model.model && model.limit),
        );
  useEffect(() => {
    if (running) watchedTurn.current = lastSeq;
    else if (watchedTurn.current !== undefined && watchedTurn.current === lastSeq) {
      watchedTurn.current = undefined;
      if (limitChanged) void router.invalidate();
    }
  }, [running, lastSeq, limitChanged, router]);

  /** Allow all for this task's choice of how long is open (#428); `undefined` until it first opens. */
  const [choosingAllowAll, setChoosingAllowAll] = useState<boolean>();
  const openAllowAll = useCallback(() => setChoosingAllowAll(true), []);
  /**
   * The session can allow all (#428): a code session's own, not the Lead's, still taking messages
   * in a workspace that isn't archived.
   */
  const canAllowAll =
    session.branch !== undefined &&
    session.lead !== true &&
    ended === undefined &&
    !session.workspaceArchived;
  // Allow all turned on or off, or the pull request opened or ended (either can end it), once the
  // page has shown the session's events: the worker, which decides whether it's on, is asked again.
  const allowAllKey = `${allowAllChanged} ${pullRequest?.number ?? ""} ${pullRequest?.state ?? ""}`;
  const shownAllowAllKey = useRef<string>(undefined);
  useEffect(() => {
    if (!ready) return;
    if (shownAllowAllKey.current !== undefined && shownAllowAllKey.current !== allowAllKey) {
      void router.invalidate();
    }
    shownAllowAllKey.current = allowAllKey;
  }, [ready, allowAllKey, router]);
  const askAgain = useCallback(() => void router.invalidate(), [router]);
  /** The warning before a limit (#66), above the Reply box, for the provider its message goes to. */
  const usageWarning = useCallback(
    (box: { provider: ProviderId | undefined; switchTo: (model: ModelRef) => void }) => (
      <UsageWarningCard provider={box.provider} onSwitch={box.switchTo} />
    ),
    [],
  );

  // Its preview (#183): a code session's own, not the Lead's, still taking messages.
  const layout = useLayout();
  const { preview, start: startPreview } = usePreview({
    sessionId: session.id,
    tasksRunning: tasks.filter((task) => task.ended === undefined).length,
    asking: canAllowAll,
  });
  /** The preview open beside the chat, by its address, while it serves. */
  const [previewing, setPreviewing] = useState<string>();
  const besideChat = layout === "tablet" && preview?.kind === "serving" ? previewing : undefined;
  /** Start preview's command is waiting for the owner to confirm it, the first time. */
  const [confirmingPreview, setConfirmingPreview] = useState(false);
  const openPreview = useCallback(
    (address: string) => {
      // On the cover screen there's no room beside the chat: a tab of its own.
      if (layout === "cover") window.open(address, "_blank", "noreferrer");
      else setPreviewing(address);
    },
    [layout],
  );

  // A model titled the session after its first answer, after the page loaded it: the new title here
  // and in the sidebar. Once per title, since one the owner gave later differs from it too.
  const loadedTitleOf = useRef<string>(undefined);
  useEffect(() => {
    if (modelTitle === undefined || modelTitle === session.title) return;
    if (loadedTitleOf.current === modelTitle) return;
    loadedTitleOf.current = modelTitle;
    void router.invalidate();
  }, [modelTitle, session.title, router]);

  const above = <BackLink workspaceId={session.workspaceId} />;
  const toggle = (what: "rename" | "delete") =>
    setTidying((was) => (was === what ? undefined : what));

  if (reviewing) {
    // The pull request's page, in place of the conversation (#278): its own heading and ask line.
    return (
      <Suspense>
        <Review
          workspaceId={session.workspaceId}
          of={{ kind: "session", sessionId: session.id }}
          fallbackTitle={session.title}
          pullRequest={pullRequest}
          session={{
            id: session.id,
            // Fix it in a session goes on the model and effort it last used.
            last: last === undefined ? undefined : { model: last.model, effort: last.effort },
          }}
          onShowSession={toConversation}
        />
      </Suspense>
    );
  }

  // The next thing waiting elsewhere (#492), at the end of the chip row, which a session has once
  // it has a branch: nothing above the chat grows when it comes. Asked afresh as events come.
  const nextPill = <NextPill sessionId={session.id} again={shownUpTo} />;
  const header = (
    <>
      {tidying === "rename" ? (
        <div className="flex flex-col gap-2">
          {above}
          <RenameForm
            label="Session title"
            value={session.title}
            maxLength={SESSION_TITLE_MAX_LENGTH}
            large
            save={async (title) => {
              const renamed = await renameSession(session.id, { title });
              if (renamed.kind !== "loaded") return describeProblem(renamed).body;
              // The title here and in the sidebar's list.
              await router.invalidate();
              return undefined;
            }}
            onDone={() => setTidying(undefined)}
          />
        </div>
      ) : (
        <PageTitle
          above={above}
          actions={
            <>
              {canAllowAll && session.allowingAll === undefined && (
                <OptionsMenu
                  label="Session options"
                  menuLabel="Session options"
                  choices={[
                    {
                      icon: <Clock />,
                      name: "Allow all for this task…",
                      note: "Runs commands and edits setup files without asking",
                      onPick: openAllowAll,
                    },
                  ]}
                />
              )}
              <IconButton
                label="Rename session"
                icon={<Pencil />}
                onClick={() => toggle("rename")}
              />
              <IconButton
                label="Delete session"
                icon={<Trash2 />}
                expanded={tidying === "delete"}
                look={tidying === "delete" ? "pressed" : "quiet"}
                onClick={() => toggle("delete")}
              />
            </>
          }
        >
          {session.title}
        </PageTitle>
      )}
      {session.lead === true ? (
        // The Lead builds on no branch of its own: what it runs shows in its place (#347).
        <div className="mt-3">
          <Suspense fallback={<PlaceholderRows count={1} size="tall" />}>
            <LeadStrip workspaceId={session.workspaceId} again={shownUpTo} />
          </Suspense>
        </div>
      ) : (
        session.branch !== undefined && (
          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <BranchStrip
                branch={session.branch}
                pullRequest={pullRequest}
                fixing={running && last?.fixesChecks === true}
                session={{ workspaceId: session.workspaceId, sessionId: session.id }}
                after={nextPill}
              />
            </div>
            <PreviewButton
              preview={preview}
              onOpen={openPreview}
              onStart={startPreview}
              onConfirm={() => setConfirmingPreview(true)}
            />
          </div>
        )
      )}
      {confirmingPreview && preview?.kind === "none" && preview.command !== null && (
        <ConfirmPreview
          command={preview.command}
          onStart={startPreview}
          onCancel={() => setConfirmingPreview(false)}
        />
      )}
      {session.allowingAll !== undefined && ended === undefined && (
        <div className="mt-3">
          <AllowingAllStrip
            allowing={session.allowingAll}
            pullRequestOpen={pullRequest?.state === "open"}
            onPast={askAgain}
            onTurnOff={async () => {
              const off = await allowAllOff(session.id);
              if (off.kind !== "loaded") return describeProblem(off).body;
              await router.invalidate();
              return undefined;
            }}
          />
        </div>
      )}
      {choosingAllowAll !== undefined && (
        <Suspense>
          <AllowAllSheet
            open={choosingAllowAll}
            onClose={() => setChoosingAllowAll(false)}
            onAllow={async (lasts) => {
              const on = await allowAll(session.id, lasts);
              if (on.kind !== "loaded") return describeProblem(on).body;
              await router.invalidate();
              return undefined;
            }}
          />
        </Suspense>
      )}
      {tidying === "delete" && (
        <div className="mt-4">
          <ConfirmStep
            question={`Delete “${session.title}”?`}
            confirmLabel="Delete session"
            busyLabel="Deleting…"
            onCancel={() => setTidying(undefined)}
            confirm={async () => {
              const deleted = await deleteSession(session.id);
              if (deleted.kind !== "loaded") return describeProblem(deleted).body;
              await navigate({
                to: "/workspaces/$workspaceId",
                params: { workspaceId: session.workspaceId },
              });
              return undefined;
            }}
          >
            Everything it recorded goes from Courtyard's data folder. This can't be undone.
          </ConfirmStep>
        </div>
      )}
      {session.workspaceArchived && (
        <div className="mt-4">
          <Notice>
            Its workspace is archived, so this session can be read but not carried on. To bring the
            workspace back, move its folder out of the <code>archived</code> folder in your context
            folder.
          </Notice>
        </div>
      )}
      {ended !== undefined && (
        // Nothing went wrong, so one quiet line rather than a notice (#278).
        <p className="mt-3 text-sm text-muted-foreground">
          Its pull request was {ended}, so this session takes no more messages: start a new session
          to carry on.
        </p>
      )}
      {reconnecting && (
        <div className="mt-4">
          <StatusPill>
            Reconnecting to the worker… The session carries on where it left off.
          </StatusPill>
        </div>
      )}
    </>
  );

  /** The session can be sent a message: a warning before a limit shows above its box (#66). */
  const takesMessages = problem === undefined && !session.workspaceArchived && ended === undefined;

  /** The page's foot: the Reply box, or what stands in for it (step by step's reading line, #241). */
  const footer = (standIn?: StandIn) => (
    <div className="pt-2 pb-3 md:pb-6">
      {away && standIn === undefined && problem === undefined && (
        <JumpToLatest answering={running} onJump={toLatest} />
      )}
      {sendProblem && (
        <div className="mb-3">
          <FormError message={sendProblem} />
        </div>
      )}
      {/* A code session's tasks still running (#182), above the Reply box. */}
      {standIn === undefined && <RunningTaskRows sessionId={session.id} tasks={tasks} />}
      <Composer
        providers={props.providers}
        {...(last ? { initialModel: last.model } : {})}
        {...(last?.effort === undefined ? {} : { initialEffort: last.effort })}
        // While a turn runs, a message goes into its answer (#252), or is queued until it ends
        // (#177) on a provider that can't take it.
        disabled={problem !== undefined || session.workspaceArchived || ended !== undefined}
        {...(running ? { stop } : {})}
        steers={steers}
        {...(draft === undefined ? {} : { draft, onDrafted: draftTaken })}
        placeholder={
          running
            ? steers
              ? "Add to this, it'll take it on board…"
              : "Queue a message…"
            : suggesting
              ? "Or type your own reply…"
              : "Reply…"
        }
        {...(props.skills === undefined ? {} : { skills: props.skills })}
        send={send}
        {...(standIn === undefined ? {} : { standIn })}
        {...(takesMessages ? { above: usageWarning } : {})}
      />
    </div>
  );

  const conversation = (
    <Page header={header} footer={footer()}>
      {problem ? (
        <div className="mt-6">
          <Notice>{problem}</Notice>
        </div>
      ) : !ready ? (
        // Its events are still coming: faint rows in the shape of a turn, the owner's message
        // then the answer, keep the conversation's place, filled in place (nothing jumps in).
        <div className="mt-6 flex flex-col gap-4">
          <PlaceholderRows count={1} />
          <PlaceholderRows count={3} size="text" />
        </div>
      ) : (
        <SessionTurns
          sessionId={session.id}
          turns={turns}
          providers={props.providers}
          onRetry={retry}
          onCarryOn={carryOnFrom}
          onContinue={continueFrom}
          {...(canAllowAll && session.allowingAll === undefined
            ? { onAllowAll: openAllowAll }
            : {})}
          {...(session.workspaceArchived ? {} : { onReply: reply })}
          workspaceId={session.workspaceId}
          {...(props.documents === undefined ? {} : { documents: props.documents })}
          queuedMessages={queuedMessages}
          onRemoveQueued={removeQueuedMessage}
          onEditQueued={editQueuedMessage}
          onAway={setAway}
          follow={follow}
          {...(props.stepByStep ? { onStepByStep: stepByStep } : {})}
        />
      )}
    </Page>
  );

  if (besideChat !== undefined && stepping === undefined) {
    // The preview beside the chat (#183), on the unfolded Fold and a desktop.
    return (
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1">{conversation}</div>
        <PreviewPanel address={besideChat} onClose={() => setPreviewing(undefined)} />
      </div>
    );
  }
  if (stepping === undefined) return conversation;
  return (
    <Suspense fallback={conversation}>
      <StepByStep
        steps={stepping}
        header={header}
        footer={footer}
        onFullAnswer={() => setStepping(undefined)}
      />
    </Suspense>
  );
}
