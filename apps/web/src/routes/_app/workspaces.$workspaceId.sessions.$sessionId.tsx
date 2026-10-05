import {
  type NewMessage,
  type ProviderList,
  SessionSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Notice, StatusPill } from "@/components/notice";
import { Page, PageTitle } from "@/components/page";
import { useWorkspaceColours, WorkspaceDot } from "@/components/workspace-colour";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { type Turn, useSessionTurns } from "../../sessions/events.ts";
import { SessionTurns } from "../../sessions/session-turns.tsx";
import { fromWorker, loadProviders, sendMessage, stopTurn } from "../../worker.ts";

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/workspaces/$workspaceId/sessions/$sessionId")({
  loader: async ({ params }) => {
    const [session, providers] = await Promise.all([
      fromWorker(`/sessions/${encodeURIComponent(params.sessionId)}`, SessionSummary),
      loadProviders(),
    ]);
    return { session, providers };
  },
  component: SessionPage,
});

function SessionPage() {
  const { session, providers } = Route.useLoaderData();
  if (session.kind !== "loaded") return <Problem result={session} />;
  return (
    <Session
      // A new session starts from scratch, even when the router reuses this component.
      key={session.data.id}
      session={session.data}
      providers={providers.kind === "loaded" ? providers.data.providers : []}
    />
  );
}

function Session(props: { session: SessionSummary; providers: ProviderList["providers"] }) {
  const { session } = props;
  const { turns, problem, reconnecting } = useSessionTurns(session.id);
  const [sendProblem, setSendProblem] = useState<string>();
  const last = turns.at(-1);
  const running = last?.state.kind === "running";

  const send = useCallback(
    async (message: NewMessage) => {
      const sent = await sendMessage(session.id, message);
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
  const retry = useCallback(
    async (turn: Turn) => {
      const sent = await sendMessage(session.id, { text: turn.text, model: turn.model });
      setSendProblem(sent.kind === "loaded" ? undefined : describeProblem(sent).body);
    },
    [session.id],
  );

  return (
    <Page flushBottom>
      <PageTitle above={<WorkspaceChip workspaceId={session.workspaceId} />}>
        {session.title}
      </PageTitle>
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
        <SessionTurns turns={turns} onRetry={retry} />
      )}
      {sendProblem && (
        <p role="alert" className="mt-3 text-sm text-destructive-text">
          {sendProblem}
        </p>
      )}

      <div className="sticky bottom-0 mt-6 bg-card pt-2 pb-3 md:pb-6">
        <Composer
          providers={props.providers}
          {...(last ? { initialModel: last.model } : {})}
          disabled={running || problem !== undefined}
          {...(running ? { stop } : {})}
          placeholder={running ? "Waiting for the answer…" : "Reply…"}
          compactOnNarrow
          send={send}
        />
      </div>
    </Page>
  );
}

/** The session's workspace, in its colour: also the way back to it. */
function WorkspaceChip(props: { workspaceId: WorkspaceId }) {
  const workspaces = loggedIn.useLoaderData();
  const colourOf = useWorkspaceColours();
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];
  const name = list.find((w) => w.id === props.workspaceId)?.name ?? props.workspaceId;
  return (
    <Link
      to="/workspaces/$workspaceId"
      params={{ workspaceId: props.workspaceId }}
      aria-label={`Back to ${name}`}
      className="flex w-fit items-center gap-2 text-xs font-medium text-primary-text hover:underline"
    >
      <WorkspaceDot colour={colourOf(props.workspaceId)} small />
      {name}
    </Link>
  );
}
