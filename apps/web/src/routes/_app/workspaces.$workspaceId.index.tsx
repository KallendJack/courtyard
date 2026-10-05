import {
  type ContextFile,
  SessionList,
  type SessionSummary,
  WorkspaceDetail,
} from "@courtyard/contract";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { fromWorker, loadProviders, startSession } from "../../worker.ts";

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

  if (detail.kind === "not-found") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-semibold">No such workspace</h1>
        <Link to="/" className="mt-2 inline-block text-neutral-600 underline">
          All workspaces
        </Link>
      </main>
    );
  }
  if (detail.kind !== "loaded") return <Problem result={detail} />;
  const { workspace, contextFile } = detail.data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{workspace.name}</h1>
      {workspace.configProblem !== undefined && (
        <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Treated as a planning workspace. {workspace.configProblem}
        </p>
      )}

      <section aria-label="Sessions" className="mt-6">
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
          <p className="text-sm text-neutral-600">{describeProblem(providers).body}</p>
        )}
        {sessions.kind === "loaded" && <SessionLinks sessions={sessions.data.sessions} />}
      </section>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-neutral-500">
        Context file
      </h2>
      {contextFile === null ? (
        <p className="mt-2 text-neutral-600">
          No context file yet. Add a <code>CONTEXT.md</code> to this workspace's folder so every
          model starts out knowing its facts, plans and ideas.
        </p>
      ) : (
        <ContextFileSections contextFile={contextFile} />
      )}
    </main>
  );
}

function SessionLinks({ sessions }: { sessions: readonly SessionSummary[] }) {
  if (sessions.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            to="/workspaces/$workspaceId/sessions/$sessionId"
            params={{ workspaceId: session.workspaceId, sessionId: session.id }}
            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50"
          >
            <span className="truncate">{session.title}</span>
            <span className="shrink-0 text-xs text-neutral-500">
              {session.busy ? "Running…" : new Date(session.updatedAt).toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ContextFileSections({ contextFile }: { contextFile: ContextFile }) {
  return (
    <div className="mt-4 space-y-6">
      {contextFile.intro !== "" && (
        <p className="whitespace-pre-wrap text-neutral-700">{contextFile.intro}</p>
      )}
      <Section title="Facts" hint="True now" lines={contextFile.facts} />
      <Section title="Plans" hint="Decided, not done" lines={contextFile.plans} />
      <Section title="Ideas" hint="Being considered" lines={contextFile.ideas} />
      {contextFile.other !== "" && (
        <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-600">
          {contextFile.other}
        </pre>
      )}
    </div>
  );
}

function Section({ title, hint, lines }: { title: string; hint: string; lines: string[] }) {
  return (
    <section aria-label={title}>
      <h2 className="text-lg font-semibold">
        {title} <span className="text-sm font-normal text-neutral-500">{hint}</span>
      </h2>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-500">Nothing yet.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's position is its identity here
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
