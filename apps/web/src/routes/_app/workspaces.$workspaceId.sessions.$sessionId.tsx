import { type NewMessage, type ProviderList, SessionSummary } from "@courtyard/contract";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { type Turn, useSessionTurns } from "../../sessions/events.ts";
import { TurnView } from "../../sessions/turn-view.tsx";
import { fromWorker, loadProviders, sendMessage } from "../../worker.ts";

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
  const { turns, problem } = useSessionTurns(session.id);
  const [sendProblem, setSendProblem] = useState<string>();
  const last = turns.at(-1);
  const running = last?.state.kind === "running";
  const end = useRef<HTMLDivElement>(null);

  // Keep the newest text in view as it streams in.
  const answerLength = last?.answer.length ?? 0;
  useEffect(() => {
    if (answerLength >= 0) end.current?.scrollIntoView({ block: "end" });
  }, [answerLength]);

  const send = useCallback(
    async (message: NewMessage) => {
      const sent = await sendMessage(session.id, message);
      return sent.kind === "loaded" ? undefined : describeProblem(sent).body;
    },
    [session.id],
  );
  const retry = useCallback(
    async (turn: Turn) => {
      const sent = await sendMessage(session.id, { text: turn.text, model: turn.model });
      setSendProblem(sent.kind === "loaded" ? undefined : describeProblem(sent).body);
    },
    [session.id],
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col px-4 py-6">
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId: session.workspaceId }}
        className="text-sm text-neutral-600 hover:text-neutral-900"
      >
        ← Back to the workspace
      </Link>
      <h1 className="mt-2 truncate text-xl font-semibold">{session.title}</h1>

      {problem ? (
        <p role="alert" className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          {problem}
        </p>
      ) : (
        <ol aria-label="Session" className="mt-6 space-y-6">
          {turns.map((turn) => (
            <TurnView
              key={turn.seq}
              turn={turn}
              // Only the last turn can be retried, so only it gets the handler.
              {...(turn === last ? { onRetry: retry } : {})}
            />
          ))}
        </ol>
      )}
      {sendProblem && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {sendProblem}
        </p>
      )}
      <div ref={end} />

      <div className="sticky bottom-0 mt-6 bg-white pb-4 pt-2">
        <Composer
          providers={props.providers}
          {...(last ? { initialModel: last.model } : {})}
          disabled={running || problem !== undefined}
          placeholder={running ? "Waiting for the answer…" : "Reply…"}
          send={send}
        />
      </div>
    </main>
  );
}
