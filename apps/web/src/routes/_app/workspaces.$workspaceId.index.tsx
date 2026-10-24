import { ChangeId, type CodeSessionList, WORKSPACE_NAME_MAX_LENGTH } from "@courtyard/contract";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, Pencil } from "lucide-react";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { IconButton } from "@/components/button";
import { ConfirmStep } from "@/components/confirm-step";
import { IconChooser } from "@/components/icon-chooser";
import { Page, PageTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { WorkspaceMenu } from "@/components/workspace-menu";
import type { Deleted } from "../../planning-home/planning-home.tsx";
import { describeProblem, Problem } from "../../problems.tsx";
import { KEPT_SESSIONS, loadSessions, useFreshSessions } from "../../sessions/kept-sessions.ts";
import { archiveWorkspace, changeWorkspace } from "../../worker.ts";

// A code workspace's Home and its tabs (#301), with a stylesheet of its own: loaded only for one.
const CodeHome = lazy(() => import("../../code-home/code-home.tsx"));
// A planning workspace's Home and its tabs (#300), the same way.
const PlanningHome = lazy(() => import("../../planning-home/planning-home.tsx"));
// A pull request no session opened (#278): loaded only when one is opened.
const Review = lazy(() =>
  import("../../review/pull-requests.tsx").then((module) => ({ default: module.PullRequestPage })),
);

/**
 * The pull request no session opened that the page shows in its place (#278), named by the
 * address's hash (`#pr-306`): a hash, not a search value, since the router validates searches on
 * the first load, which has no room for one more.
 */
const pullRequestIn = (hash: string) => {
  const number = /^pr-([1-9]\d*)$/.exec(hash)?.[1];
  return number === undefined ? undefined : Number(number);
};

export const Route = createFileRoute("/_app/workspaces/$workspaceId/")({
  // A document or a Thing just deleted from its page, which this page offers to undo (ADR 0020).
  validateSearch: (search: Record<string, unknown>) => {
    const deleted = ChangeId.safeParse(search.deleted);
    const name = typeof search.name === "string" ? search.name : undefined;
    return {
      ...(deleted.success ? { deleted: deleted.data } : {}),
      ...(name === undefined ? {} : { name }),
      ...(search.kind === "thing" ? { kind: "thing" as const } : {}),
    };
  },
  // The loader stays in the first load, so it only imports what the page asks for.
  loader: ({ params }) =>
    import("../../workspace-page.ts").then((page) => page.loadWorkspacePage(params.workspaceId)),
  component: Workspace,
});

function Workspace() {
  const { detail, sessions, providers, skills, documents, things } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  // Followed from the router itself: its hooks for the address would add to the first load.
  const hash = useSyncExternalStore(
    (changed) => router.subscribe("onResolved", changed),
    () => router.state.location.hash,
  );
  /** What the owner is doing to the workspace itself, if anything. */
  const [tidying, setTidying] = useState<"rename" | "archive">();
  const params = Route.useParams();
  const sessionList = useSessionList(
    params.workspaceId,
    sessions.kind === "loaded" ? sessions.data : undefined,
  );

  const pr = pullRequestIn(hash);
  if (pr !== undefined && detail.kind === "loaded") {
    // A pull request no session opened, on a page of its own (#278).
    const workspaceId = detail.data.workspace.id;
    return (
      <Suspense>
        <Review
          key={pr}
          workspaceId={workspaceId}
          of={{ kind: "number", workspaceId, number: pr }}
          fallbackTitle={`#${pr}`}
        />
      </Suspense>
    );
  }
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

  const change = async (wanted: { name: string } | { icon: typeof workspace.icon }) => {
    const changed = await changeWorkspace(workspace.id, wanted);
    if (changed.kind !== "loaded") return describeProblem(changed).body;
    // Every list of workspaces shows the change.
    await router.invalidate();
    return undefined;
  };
  /** A planning workspace's line above its name: its icon, to change it, and "Workspace". */
  const above = (
    // The chooser stays outside the words' capitals: its sheet is inside it.
    <div className="flex items-center gap-2">
      <IconChooser
        workspaceName={workspace.name}
        icon={workspace.icon}
        choose={(icon) => change({ icon })}
      />
      <span className="text-meta/4 font-semibold tracking-label text-muted-foreground uppercase">
        Workspace
      </span>
    </div>
  );
  const toggle = (what: "rename" | "archive") =>
    setTidying((was) => (was === what ? undefined : what));
  // A code workspace's title is its name alone, with rename, its icon and archive behind one ⋯
  // (#333; Paper, "Code workspace Home"); a planning workspace's keeps its line and buttons.
  const code = workspace.mode === "code";
  const actions = code ? (
    <WorkspaceMenu
      workspaceName={workspace.name}
      icon={workspace.icon}
      choose={(icon) => change({ icon })}
      onRename={() => setTidying("rename")}
      onArchive={() => setTidying("archive")}
    />
  ) : (
    <>
      <IconButton label="Rename workspace" icon={<Pencil />} onClick={() => toggle("rename")} />
      <IconButton
        label="Archive workspace"
        icon={<Archive />}
        expanded={tidying === "archive"}
        look={tidying === "archive" ? "pressed" : "quiet"}
        onClick={() => toggle("archive")}
      />
    </>
  );
  /** A document or a Thing just deleted from its page, which its section offers to undo. */
  const deleted: Deleted | undefined =
    search.name === undefined
      ? undefined
      : { kind: search.kind ?? "document", name: search.name, change: search.deleted };
  /** Once a delete is undone: the page forgets it and loads its lists again, on its tab (#300). */
  const undone = async () => {
    await navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: workspace.id },
      search: {},
      hash: deleted?.kind === "thing" ? "things" : "docs",
      replace: true,
    });
    await router.invalidate();
  };

  return (
    // A workspace's Home ends with its message box, pinned at the foot (#301, #300); a code
    // workspace's is the screen's height from a tablet up, and never scrolls (#335).
    <Page wide flushBottom fill={workspace.mode === "code"}>
      {tidying === "rename" ? (
        <div className="flex flex-col gap-2">
          {!code && above}
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
        <PageTitle {...(code ? {} : { above })} actions={actions}>
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
      {code ? (
        <Suspense fallback={null}>
          <CodeHome
            workspace={workspace}
            list={sessionList}
            providers={providers}
            skills={skills}
            hash={hash}
          />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <PlanningHome
            workspace={workspace}
            contextFile={contextFile}
            ownerContextShared={ownerContextShared}
            duePlans={detail.data.duePlans ?? []}
            list={sessionList}
            loaded={{ providers, skills, documents, things }}
            hash={hash}
            deleted={deleted}
            onUndone={undone}
          />
        </Suspense>
      )}
    </Page>
  );
}

const NO_SESSIONS: CodeSessionList = { sessions: [], running: 0 };

/**
 * The workspace's sessions as the page loaded them, kept fresh the shared way (#387): every few
 * seconds while one is working or needs the owner, so its lists keep saying whose turn it is
 * (#179) and where each pull request stands (#240), and every 30 seconds otherwise, so one started
 * from another device shows. What it hears is kept for the workspace's tiles too.
 */
const useSessionList = (workspaceId: string, loaded: CodeSessionList | undefined) => {
  const [asked, setAsked] = useState<{ from: CodeSessionList; now: CodeSessionList }>();
  const fromPage = loaded ?? NO_SESSIONS;
  // The page's own list until a newer one is asked for, and again whenever the page reloads it.
  const list = asked?.from === fromPage ? asked.now : fromPage;
  useFreshSessions(list.sessions, async () => {
    const now = await loadSessions(workspaceId);
    if (now === undefined) return;
    setAsked({ from: fromPage, now });
    KEPT_SESSIONS.set(workspaceId, now);
  });
  return list;
};
