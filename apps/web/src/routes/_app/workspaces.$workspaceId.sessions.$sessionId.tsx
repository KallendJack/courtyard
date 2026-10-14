import {
  type NewMessage,
  type ProviderList,
  SESSION_TITLE_MAX_LENGTH,
  SessionDetail,
  type SkillSummary,
  WorkspaceId,
} from "@courtyard/contract";
import { createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { BranchStrip } from "@/components/branch-strip";
import { IconButton } from "@/components/button";
import { ConfirmStep } from "@/components/confirm-step";
import { FormError } from "@/components/form-error";
import { JumpToLatest } from "@/components/jump-to-latest";
import { PlaceholderRows } from "@/components/kept";
import { Notice, StatusPill } from "@/components/notice";
import { Page, PageTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import type { DocumentsHere } from "../../sessions/documents.tsx";
import { type Turn, useSessionTurns } from "../../sessions/events.ts";
import { removeQueued, sendMessage } from "../../sessions/messages.ts";
import { useSeen } from "../../sessions/seen.ts";
import { SessionTurns } from "../../sessions/session-turns.tsx";
import {
  carryOn,
  deleteSession,
  fromWorker,
  loadProviders,
  loadSkills,
  NOT_FOUND,
  renameSession,
  stopTurn,
} from "../../worker.ts";

// A code session's pull request, reviewed in place of the conversation (#160): loaded only then.
const Review = lazy(() => import("../../review/review.tsx"));
/** A code workspace's Lead's strip (#347), loaded only on its chat. */
const LeadStrip = lazy(() => import("../../sessions/lead-strip.tsx"));

export const Route = createFileRoute("/_app/workspaces/$workspaceId/sessions/$sessionId")({
  validateSearch: (search: Record<string, unknown>): { view?: "review" } =>
    search.view === "review" ? { view: "review" } : {},
  loader: async ({ params }) => {
    const workspaceId = WorkspaceId.safeParse(params.workspaceId);
    const [session, providers, skills] = await Promise.all([
      fromWorker(`/sessions/${encodeURIComponent(params.sessionId)}`, SessionDetail),
      loadProviders(),
      workspaceId.success ? loadSkills(workspaceId.data) : NOT_FOUND,
    ]);
    return { session, providers, skills };
  },
  component: SessionPage,
});

/** The workspaces the sidebar lists, which name the session's workspace. */
const appRoute = getRouteApi("/_app");

function SessionPage() {
  const { session, providers, skills } = Route.useLoaderData();
  const workspaces = appRoute.useLoaderData();
  if (session.kind !== "loaded") return <Problem result={session} />;
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
}) {
  const { session } = props;
  const {
    turns,
    lastSeq: shownUpTo,
    modelTitle,
    pullRequest,
    queuedMessages,
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

  const send = useCallback(
    async (message: NewMessage, files: readonly File[]) => {
      const sent = await sendMessage({ sessionId: session.id, message, files });
      if (sent.kind !== "loaded") return describeProblem(sent).body;
      // What the owner just sent is at the end, so that's where they go.
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

  return (
    <Page flushBottom>
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
          <div className="mt-3">
            <BranchStrip
              branch={session.branch}
              pullRequest={pullRequest}
              fixing={running && last?.fixesChecks === true}
              session={{ workspaceId: session.workspaceId, sessionId: session.id }}
            />
          </div>
        )
      )}
      {tidying === "delete" && (
        <div className="mt-4">
          <ConfirmStep
            question={`Delete “${session.title}”?`}
            confirmLabel="Delete session"
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
          {...(session.workspaceArchived ? {} : { onReply: reply })}
          workspaceId={session.workspaceId}
          {...(props.documents === undefined ? {} : { documents: props.documents })}
          queuedMessages={queuedMessages}
          onRemoveQueued={removeQueuedMessage}
          onAway={setAway}
          follow={follow}
        />
      )}
      {sendProblem && (
        <div className="mt-3">
          <FormError message={sendProblem} />
        </div>
      )}

      {/* Pinned to the foot of the page's panel, which keeps clear of a phone's gesture bar (#266). */}
      <div className="sticky bottom-0 mt-6 bg-card pt-2 pb-3 md:pb-6">
        {away && problem === undefined && <JumpToLatest answering={running} onJump={toLatest} />}
        <Composer
          providers={props.providers}
          {...(last ? { initialModel: last.model } : {})}
          {...(last?.effort === undefined ? {} : { initialEffort: last.effort })}
          // While a turn runs, a message is queued until it ends (#177).
          disabled={problem !== undefined || session.workspaceArchived || ended !== undefined}
          {...(running ? { stop } : {})}
          placeholder={
            running ? "Queue a message…" : suggesting ? "Or type your own reply…" : "Reply…"
          }
          compactOnNarrow
          {...(props.skills === undefined ? {} : { skills: props.skills })}
          send={send}
        />
      </div>
    </Page>
  );
}
