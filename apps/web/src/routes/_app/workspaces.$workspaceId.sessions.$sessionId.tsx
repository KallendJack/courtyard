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
import { useCallback, useEffect, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { BranchStrip } from "@/components/branch-strip";
import { IconButton } from "@/components/button";
import { ConfirmStep } from "@/components/confirm-step";
import { FormError } from "@/components/form-error";
import { Notice, StatusPill } from "@/components/notice";
import { Page, PageTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import type { DocumentsHere } from "../../sessions/documents.tsx";
import { type Turn, useSessionTurns } from "../../sessions/events.ts";
import { sendMessage } from "../../sessions/messages.ts";
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

export const Route = createFileRoute("/_app/workspaces/$workspaceId/sessions/$sessionId")({
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
  const { turns, modelTitle, pullRequest, problem, reconnecting } = useSessionTurns(session.id);
  /** Its pull request was merged or closed, so it takes no more messages (#172). */
  const ended =
    pullRequest !== undefined && pullRequest.state !== "open" ? pullRequest.state : undefined;
  const [sendProblem, setSendProblem] = useState<string>();
  /** What the owner is doing to the session itself, if anything. */
  const [tidying, setTidying] = useState<"rename" | "delete">();
  const router = useRouter();
  const navigate = useNavigate();
  const last = turns.at(-1);
  const running = last?.state.kind === "running";
  /** The latest answer offers suggested replies, so the message box says one's own is welcome too (#154). */
  const suggesting =
    last?.state.kind === "done" && last.replies.length > 0 && !session.workspaceArchived;

  const send = useCallback(
    async (message: NewMessage, files: readonly File[]) => {
      const sent = await sendMessage({ sessionId: session.id, message, files });
      return sent.kind === "loaded" ? undefined : describeProblem(sent).body;
    },
    [session.id],
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
      {session.branch !== undefined && (
        <div className="mt-3">
          <BranchStrip
            branch={session.branch}
            pullRequest={pullRequest}
            fixing={running && last?.fixesChecks === true}
          />
        </div>
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
        <div className="mt-4">
          <Notice>
            Its pull request was {ended}, so this session can be read but takes no more messages.
            Its branch and worktree are cleared away. Start a new session to carry on.
          </Notice>
        </div>
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
        />
      )}
      {sendProblem && (
        <div className="mt-3">
          <FormError message={sendProblem} />
        </div>
      )}

      <div className="sticky bottom-0 mt-6 bg-card pt-2 pb-[calc(--spacing(3)+env(safe-area-inset-bottom))] md:pb-[calc(--spacing(6)+env(safe-area-inset-bottom))]">
        <Composer
          providers={props.providers}
          {...(last ? { initialModel: last.model } : {})}
          {...(last?.effort === undefined ? {} : { initialEffort: last.effort })}
          disabled={
            running || problem !== undefined || session.workspaceArchived || ended !== undefined
          }
          {...(running ? { stop } : {})}
          placeholder={
            running ? "Waiting for the answer…" : suggesting ? "Or type your own reply…" : "Reply…"
          }
          compactOnNarrow
          {...(props.skills === undefined ? {} : { skills: props.skills })}
          send={send}
        />
      </div>
    </Page>
  );
}
