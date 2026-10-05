import { type NewMessage, ProviderList, SessionSummary } from "@courtyard/contract";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { type Turn, useSessionTurns } from "../../sessions/events.ts";
import { TurnView } from "../../sessions/turn-view.tsx";
import { fromWorker, sendMessage } from "../../worker.ts";

export const Route = createFileRoute("/_app/workspaces/$workspaceId/sessions/$sessionId")({
  loader: async ({ params }) => {
    const [session, providers] = await Promise.all([
      fromWorker(`/sessions/${encodeURIComponent(params.sessionId)}`, SessionSummary),
      fromWorker("/providers", ProviderList),
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
      session={session.data}
      providers={providers.kind === "loaded" ? providers.data.providers : []}
    />
  );
}

function Session(props: { session: SessionSummary; providers: ProviderList["providers"] }) {
  const { session } = props;
  const turns = useSessionTurns(session.id);
  const last = turns.at(-1);
  const running = last?.state.kind === "running";
  const end = useRef<HTMLDivElement>(null);

  // Keep the newest text in view as it streams in.
  const answerLength = last?.answer.length ?? 0;
  useEffect(() => {
    if (answerLength >= 0) end.current?.scrollIntoView({ block: "end" });
  }, [answerLength]);

  const send = async (message: NewMessage) => {
    const sent = await sendMessage(session.id, message);
    return sent.kind === "loaded" ? undefined : describeProblem(sent).body;
  };
  const retry = useCallback(
    (turn: Turn) => {
      void sendMessage(session.id, { text: turn.text, model: turn.model });
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

      <ol aria-label="Conversation" className="mt-6 space-y-6">
        {turns.map((turn) => (
          <TurnView
            key={turn.seq}
            turn={turn}
            // Only the last turn can be retried, so only it gets the handler.
            {...(turn === last ? { onRetry: retry } : {})}
          />
        ))}
      </ol>
      <div ref={end} />

      <div className="sticky bottom-0 mt-6 bg-white pb-4 pt-2">
        <Composer
          providers={props.providers}
          {...(last ? { initialModel: last.model } : {})}
          disabled={running}
          placeholder={running ? "Waiting for the answer…" : "Reply…"}
          send={send}
        />
      </div>
    </main>
  );
}
