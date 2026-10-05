import {
  type ContextFile,
  SessionList,
  type SessionSummary,
  WorkspaceDetail,
} from "@courtyard/contract";
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Page, PageTitle, SectionTitle } from "@/components/page";
import { WorkspaceDot, workspaceColours } from "@/components/workspace-colour";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { describeWhen } from "../../when.ts";
import { fromWorker, loadProviders, startSession } from "../../worker.ts";

const loggedIn = getRouteApi("/_app");

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
  const workspaces = loggedIn.useLoaderData();

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
  const { workspace, contextFile } = detail.data;
  const colour =
    workspaces.kind === "loaded"
      ? (workspaceColours(workspaces.data.workspaces).get(workspace.id) ?? "heather")
      : "heather";

  return (
    <Page>
      <PageTitle
        above={
          <span className="flex items-center gap-2 text-[13px] font-medium text-primary-text">
            <WorkspaceDot colour={colour} small />
            {workspace.mode === "code" ? "Code workspace" : "Workspace"}
          </span>
        }
      >
        {workspace.name}
      </PageTitle>
      {contextFile !== null && contextFile.intro !== "" && (
        <p className="mt-2 text-[15px]/[23px] whitespace-pre-wrap text-muted-foreground">
          {contextFile.intro}
        </p>
      )}
      {workspace.configProblem !== undefined && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-destructive-soft px-3.5 py-3 text-sm text-destructive-text"
        >
          Treated as a planning workspace. {workspace.configProblem}
        </p>
      )}

      <section aria-label="Sessions" className="mt-8">
        {providers.kind === "loaded" ? (
          <Composer
            providers={providers.data.providers}
            placeholder={`Start a session in ${workspace.name}…`}
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
      {contextFile === null ? (
        <p className="mt-2 text-muted-foreground">
          No context file yet. Add a <code>CONTEXT.md</code> to this workspace's folder so every
          model starts out knowing its facts, plans and ideas.
        </p>
      ) : (
        <ContextFileSections contextFile={contextFile} />
      )}
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
              className="-mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-3.5 hover:bg-muted/60"
            >
              <span className="truncate font-medium">{session.title}</span>
              <span className="shrink-0 text-[13px] text-muted-foreground">
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
      <Section title="Facts" hint="True now" lines={contextFile.facts} />
      <Section title="Plans" hint="Decided, not done" lines={contextFile.plans} />
      <Section title="Ideas" hint="Being considered" lines={contextFile.ideas} />
      {contextFile.other !== "" && (
        <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
          {contextFile.other}
        </pre>
      )}
    </div>
  );
}

function Section({ title, hint, lines }: { title: string; hint: string; lines: string[] }) {
  return (
    <section aria-label={title}>
      <h3 className="flex items-baseline gap-2 font-semibold">
        {title} <span className="text-[13px] font-normal text-muted-foreground">{hint}</span>
      </h3>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-primary-text">
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's position is its identity here
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
