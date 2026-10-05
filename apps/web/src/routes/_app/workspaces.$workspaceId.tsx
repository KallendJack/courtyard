import { type ContextFile, WorkspaceDetail } from "@courtyard/contract";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Problem } from "../../problems.tsx";
import { fromWorker } from "../../worker.ts";

export const Route = createFileRoute("/_app/workspaces/$workspaceId")({
  loader: ({ params }) =>
    fromWorker(`/workspaces/${encodeURIComponent(params.workspaceId)}`, WorkspaceDetail),
  component: Workspace,
});

function Workspace() {
  const detail = Route.useLoaderData();

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
      {contextFile === null ? (
        <p className="mt-4 text-neutral-600">
          No context file yet. Add a <code>CONTEXT.md</code> to this workspace's folder so every
          model starts out knowing its facts, plans and ideas.
        </p>
      ) : (
        <ContextFileSections contextFile={contextFile} />
      )}
    </main>
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
