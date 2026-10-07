import {
  type NewMessage,
  type ProviderList,
  SESSION_TITLE_MAX_LENGTH,
  SessionDetail,
} from "@courtyard/contract";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { BackLink } from "@/components/back-link";
import { IconButton } from "@/components/button";
import { ConfirmStep } from "@/components/confirm-step";
import { FormError } from "@/components/form-error";
import { Notice, StatusPill } from "@/components/notice";
import { Page, PageTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { type Turn, useSessionTurns } from "../../sessions/events.ts";
import { SessionTurns } from "../../sessions/session-turns.tsx";
import {
  deleteSession,
  fromWorker,
  loadProviders,
  renameSession,
  sendMessage,
  stopTurn,
} from "../../worker.ts";

export const Route = createFileRoute("/_app/workspaces/$workspaceId/sessions/$sessionId")({
  loader: async ({ params }) => {
    const [session, providers] = await Promise.all([
      fromWorker(`/sessions/${encodeURIComponent(params.sessionId)}`, SessionDetail),
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

function Session(props: { session: SessionDetail; providers: ProviderList["providers"] }) {
  const { session } = props;
  const { turns, problem, reconnecting } = useSessionTurns(session.id);
  const [sendProblem, setSendProblem] = useState<string>();
  /** What the owner is doing to the session itself, if anything. */
  const [tidying, setTidying] = useState<"rename" | "delete">();
  const router = useRouter();
  const navigate = useNavigate();
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
                active={tidying === "delete"}
                onClick={() => toggle("delete")}
              />
            </>
          }
        >
          {session.title}
        </PageTitle>
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
        <SessionTurns sessionId={session.id} turns={turns} onRetry={retry} />
      )}
      {sendProblem && (
        <div className="mt-3">
          <FormError message={sendProblem} />
        </div>
      )}

      <div className="sticky bottom-0 mt-6 bg-card pt-2 pb-3 md:pb-6">
        <Composer
          providers={props.providers}
          {...(last ? { initialModel: last.model } : {})}
          disabled={running || problem !== undefined || session.workspaceArchived}
          {...(running ? { stop } : {})}
          placeholder={running ? "Waiting for the answer…" : "Reply…"}
          compactOnNarrow
          send={send}
        />
      </div>
    </Page>
  );
}
