import {
  CONTEXT_FILE_LONG_CHARACTERS,
  type ContextFile,
  hasLines,
  SessionList,
  type SessionSummary,
  WORKSPACE_NAME_MAX_LENGTH,
  WorkspaceDetail,
} from "@courtyard/contract";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, Pencil } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/button";
import { ConfirmStep } from "@/components/confirm-step";
import { FactsPlansIdeas } from "@/components/context-lines";
import { EmptyState, Notice, StatusPill } from "@/components/notice";
import { LIST_ROW, Page, PageTitle, SectionTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { ColourChooser } from "@/components/workspace-colour";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { GetToKnow } from "../../sessions/get-to-know.tsx";
import { describeWhen } from "../../when.ts";
import {
  archiveWorkspace,
  changeWorkspace,
  fromWorker,
  loadProviders,
  startSession,
} from "../../worker.ts";

export const Route = createFileRoute("/_app/workspaces/$workspaceId/")({
  loader: async ({ params }) => {
    const id = encodeURIComponent(params.workspaceId);
    const [detail, sessions, providers] = await Promise.all([
      fromWorker(`/workspaces/${id}`, WorkspaceDetail),
      fromWorker(`/workspaces/${id}/sessions`, SessionList),
      loadProviders(),
    ]);
    return { detail, sessions, providers };
  },
  component: Workspace,
});

function Workspace() {
  const { detail, sessions, providers } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  /** What the owner is doing to the workspace itself, if anything. */
  const [tidying, setTidying] = useState<"rename" | "archive">();

  if (detail.kind === "not-found") {
    return (
      <Page>
        <PageTitle>No such workspace</PageTitle>
        <Link to="/" className="mt-3 w-fit text-muted-foreground underline">
          All workspaces
        </Link>
      </Page>
    );
  }
  if (detail.kind !== "loaded") return <Problem result={detail} />;
  const { workspace, contextFile, ownerContextShared } = detail.data;

  const change = async (wanted: { name: string } | { colour: typeof workspace.colour }) => {
    const changed = await changeWorkspace(workspace.id, wanted);
    if (changed.kind !== "loaded") return describeProblem(changed).body;
    // Every list of workspaces shows the change.
    await router.invalidate();
    return undefined;
  };
  const above = (
    <div className="flex items-center gap-2 text-xs font-medium text-primary-text">
      <ColourChooser colour={workspace.colour} choose={(colour) => change({ colour })} />
      {workspace.mode === "code" ? "Code workspace" : "Workspace"}
    </div>
  );
  const toggle = (what: "rename" | "archive") =>
    setTidying((was) => (was === what ? undefined : what));

  return (
    <Page>
      {tidying === "rename" ? (
        <div className="flex flex-col gap-2">
          {above}
          <RenameForm
            label="Workspace name"
            value={workspace.name}
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            large
            save={(name) => change({ name })}
            onDone={() => setTidying(undefined)}
          />
        </div>
      ) : (
        <PageTitle
          above={above}
          actions={
            <>
              <IconButton
                label="Rename workspace"
                icon={<Pencil />}
                onClick={() => toggle("rename")}
              />
              <IconButton
                label="Archive workspace"
                icon={<Archive />}
                expanded={tidying === "archive"}
                active={tidying === "archive"}
                onClick={() => toggle("archive")}
              />
            </>
          }
        >
          {workspace.name}
        </PageTitle>
      )}
      {tidying === "archive" && (
        <div className="mt-4">
          <ConfirmStep
            question={`Archive ${workspace.name}?`}
            confirmLabel="Archive workspace"
            onCancel={() => setTidying(undefined)}
            confirm={async () => {
              const archived = await archiveWorkspace(workspace.id);
              if (archived.kind !== "loaded") return describeProblem(archived).body;
              // Away first, so this page doesn't reload its now-archived workspace.
              await navigate({ to: "/" });
              await router.invalidate();
              return undefined;
            }}
          >
            It leaves every list, and its folder moves to the <code>archived</code> folder in your
            context folder, so nothing in it is lost. Its sessions are kept, to read but not carry
            on. Move the folder back to bring it back.
          </ConfirmStep>
        </div>
      )}
      {contextFile !== null && contextFile.intro !== "" && (
        // One line, as a reminder; the whole file is further down.
        <p className="mt-2 line-clamp-1 text-[15px]/[23px] text-muted-foreground">
          {contextFile.intro}
        </p>
      )}
      {workspace.configProblem !== undefined && (
        <div className="mt-4">
          <Notice>Treated as a planning workspace. {workspace.configProblem}</Notice>
        </div>
      )}

      <section aria-label="Sessions" className="mt-8">
        {providers.kind === "loaded" ? (
          <Composer
            providers={providers.data.providers}
            placeholder="Start a new session…"
            submitLabel="Start"
            send={async (message) => {
              const session = await startSession(workspace.id, message);
              if (session.kind !== "loaded") return describeProblem(session).body;
              await navigate({
                to: "/workspaces/$workspaceId/sessions/$sessionId",
                params: { workspaceId: workspace.id, sessionId: session.data.id },
              });
              return undefined;
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{describeProblem(providers).body}</p>
        )}
        {sessions.kind === "loaded" && <SessionLinks sessions={sessions.data.sessions} />}
      </section>

      <div className="mt-12">
        <SectionTitle>Context file</SectionTitle>
      </div>
      {workspace.mode === "planning" && (contextFile === null || !hasLines(contextFile)) && (
        <GetToKnow
          about={{ kind: "workspace", id: workspace.id }}
          label="Get to know this workspace"
        >
          You're asked a few questions about it, and what you say is saved here.
        </GetToKnow>
      )}
      {contextFile === null ? (
        <EmptyState>
          No context file yet. One is made the first time something's saved, or add a{" "}
          <code>CONTEXT.md</code> to this workspace's folder yourself.
        </EmptyState>
      ) : (
        <>
          {contextFile.characters > CONTEXT_FILE_LONG_CHARACTERS && (
            <div className="mt-3">
              <StatusPill>
                Getting long: it goes with every message, so keep it to what matters.
              </StatusPill>
            </div>
          )}
          <ContextFileSections contextFile={contextFile} />
        </>
      )}
      {ownerContextShared !== "none" && (
        <p className="mt-8 text-sm text-muted-foreground">
          Also reads{" "}
          <Link to="/" className="text-foreground underline">
            {ownerContextShared === "all"
              ? "your owner context"
              : "how you like answers (from your owner context)"}
          </Link>
          .
        </p>
      )}
      <p className="mt-4 text-sm text-muted-foreground">
        <Link
          to="/changes"
          search={{ workspace: workspace.id }}
          className="text-foreground underline"
        >
          Recent changes
        </Link>
        , with Undo.
      </p>
    </Page>
  );
}

function SessionLinks({ sessions }: { sessions: readonly SessionSummary[] }) {
  if (sessions.length === 0) return null;
  return (
    <div className="mt-10">
      <SectionTitle>Sessions</SectionTitle>
      <ul className="mt-2 divide-y">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link
              to="/workspaces/$workspaceId/sessions/$sessionId"
              params={{ workspaceId: session.workspaceId, sessionId: session.id }}
              className={LIST_ROW}
            >
              <span className="truncate font-medium">{session.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {session.busy ? "Running…" : describeWhen(session.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The context file's sections. Its intro is shown under the workspace's title instead. */
function ContextFileSections({ contextFile }: { contextFile: ContextFile }) {
  return (
    <div className="mt-4 space-y-6">
      <FactsPlansIdeas {...contextFile} />
      {contextFile.other !== "" && (
        <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
          {contextFile.other}
        </pre>
      )}
    </div>
  );
}
