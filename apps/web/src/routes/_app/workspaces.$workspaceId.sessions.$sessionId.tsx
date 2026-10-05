import { type NewMessage, type ProviderList, SessionSummary } from "@courtyard/contract";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Page, PageTitle } from "@/components/page";
import { WorkspaceDot, workspaceColours } from "@/components/workspace-colour";
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
        <p
          role="status"
          className="mt-4 flex w-fit items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium"
        >
          <span aria-hidden className="size-2 rounded-full bg-workspace-bracken" />
          Reconnecting to the worker… The session carries on where it left off.
        </p>
      )}

      {problem ? (
        <p
          role="alert"
          className="mt-6 rounded-md bg-destructive-soft px-3.5 py-3 text-sm text-destructive-text"
        >
          {problem}
        </p>
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
          send={send}
        />
      </div>
    </Page>
  );
}

/** The session's workspace, in its colour: also the way back to it. */
function WorkspaceChip(props: { workspaceId: string }) {
  const workspaces = loggedIn.useLoaderData();
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];
  const name = list.find((w) => w.id === props.workspaceId)?.name ?? props.workspaceId;
  return (
    <Link
      to="/workspaces/$workspaceId"
      params={{ workspaceId: props.workspaceId }}
      aria-label={`Back to ${name}`}
      className="flex w-fit items-center gap-2 text-[13px] font-medium text-primary-text hover:underline"
    >
      <WorkspaceDot colour={workspaceColours(list).get(props.workspaceId) ?? "heather"} small />
      {name}
    </Link>
  );
}
