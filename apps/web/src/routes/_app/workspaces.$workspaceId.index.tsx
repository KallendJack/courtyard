import {
  ChangeId,
  CONTEXT_FILE_LONG_CHARACTERS,
  CodeSessionList,
  type ContextFile,
  hasLines,
  type OwnerContextShared,
  type SkillSummary,
  WORKSPACE_NAME_MAX_LENGTH,
  type WorkspaceId,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, Pencil } from "lucide-react";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { IconButton } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { ConfirmStep } from "@/components/confirm-step";
import { FactsPlansIdeas } from "@/components/context-lines";
import { IconChooser } from "@/components/icon-chooser";
import { EmptyState, Notice, StatusPill } from "@/components/notice";
import { CARD, Page, PageTitle, SectionTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { useRefreshWhileBusy } from "@/components/session-state";
import { SkillList } from "@/components/skill-list";
import { DocumentsSection } from "../../documents/documents-section.tsx";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { GetToKnow } from "../../sessions/get-to-know.tsx";
import { GrillablePlan } from "../../sessions/grill-plan.tsx";
import { startSession } from "../../sessions/messages.ts";
import { SessionLinks } from "../../sessions/session-links.tsx";
import { ThingsSection } from "../../things/things-section.tsx";
import { archiveWorkspace, changeWorkspace, fromWorker } from "../../worker.ts";

// A code workspace's Home and its tabs (#301), with a stylesheet of its own: loaded only for one.
const CodeHome = lazy(() => import("../../code-home/code-home.tsx"));
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

/** A document or a Thing just deleted from its page, which its section offers to undo. */
type Deleted = {
  readonly kind: "document" | "thing";
  readonly name: string;
  readonly change: ChangeId | undefined;
};

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
  const sessionList = useSessionList(sessions.kind === "loaded" ? sessions.data : undefined);

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
  const above = (
    // The chooser stays outside the words' capitals: its sheet is inside it.
    <div className="flex items-center gap-2">
      <IconChooser
        workspaceName={workspace.name}
        icon={workspace.icon}
        choose={(icon) => change({ icon })}
      />
      <span className="text-meta/4 font-semibold tracking-label text-muted-foreground uppercase">
        {workspace.mode === "code" ? "Code workspace" : "Workspace"}
      </span>
    </div>
  );
  const toggle = (what: "rename" | "archive") =>
    setTidying((was) => (was === what ? undefined : what));
  /** A document or a Thing just deleted from its page, which its section offers to undo. */
  const deleted: Deleted | undefined =
    search.name === undefined
      ? undefined
      : { kind: search.kind ?? "document", name: search.name, change: search.deleted };
  /** Once a delete is undone: the page forgets it and loads its lists again. */
  const undone = async () => {
    await navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: workspace.id },
      search: {},
      replace: true,
    });
    await router.invalidate();
  };

  return (
    // A code workspace's Home ends with its message box, pinned at the foot (#301).
    <Page wide flushBottom={workspace.mode === "code"}>
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
                look={tidying === "archive" ? "pressed" : "quiet"}
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
      {workspace.mode === "code" ? (
        <Suspense fallback={null}>
          <CodeHome
            workspace={workspace}
            description={detail.data.description}
            list={sessionList}
            providers={providers}
            skills={skills}
            hash={hash}
          />
        </Suspense>
      ) : (
        <PlanningHome
          workspace={workspace}
          contextFile={contextFile}
          ownerContextShared={ownerContextShared}
          sessionList={sessionList}
          loaded={{ sessions, providers, skills, documents, things }}
          deleted={deleted}
          onUndone={undone}
        />
      )}
    </Page>
  );
}

/**
 * A planning workspace's page under its title: what it's for, the message box, then its cards:
 * what's been said and known, and its skills, on the left; its Things and documents on the right.
 */
function PlanningHome(props: {
  workspace: WorkspaceSummary;
  contextFile: ContextFile | null;
  ownerContextShared: OwnerContextShared;
  sessionList: CodeSessionList;
  loaded: Pick<
    ReturnType<typeof Route.useLoaderData>,
    "sessions" | "providers" | "skills" | "documents" | "things"
  >;
  deleted: Deleted | undefined;
  onUndone: () => Promise<void>;
}) {
  const { workspace, contextFile, ownerContextShared, sessionList, deleted } = props;
  const { sessions, providers, skills, documents, things } = props.loaded;
  const navigate = useNavigate();
  const undone = props.onUndone;
  return (
    <>
      {contextFile !== null && contextFile.intro !== "" && (
        // One line, as a reminder; the whole file is further down.
        <p className="mt-2 line-clamp-1 text-body text-muted-foreground">{contextFile.intro}</p>
      )}
      {workspace.configProblem !== undefined && (
        <div className="mt-4">
          <Notice>Treated as a planning workspace. {workspace.configProblem}</Notice>
        </div>
      )}
      <div className="mt-6 md:mt-8">
        {providers.kind === "loaded" ? (
          <Composer
            providers={providers.data.providers}
            placeholder="Start a new session…"
            submitLabel="Start"
            {...(skills.kind === "loaded"
              ? { skills: { workspaceName: workspace.name, list: skills.data.skills } }
              : {})}
            send={async (message, files) => {
              const session = await startSession({ workspaceId: workspace.id, message, files });
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
      </div>
      {/*
        The workspace's cards: what's been said and known, and its skills, on the left; what it has
        on the right.
      */}
      <div className="mt-6 grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @3xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {sessions.kind === "loaded" && <SessionLinks list={sessionList} mode="planning" />}
          <section aria-label="Context file" className={CARD}>
            <ContextFileCard
              workspaceId={workspace.id}
              contextFile={contextFile}
              ownerContextShared={ownerContextShared}
            />
          </section>
          {skills.kind === "loaded" && <Skills skills={skills.data.skills} />}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {things.kind === "loaded" && (
            <ThingsSection
              workspaceId={workspace.id}
              list={things.data}
              {...(deleted?.kind === "thing" ? { deleted } : {})}
              onUndone={undone}
            />
          )}
          {documents.kind === "loaded" && (
            <DocumentsSection
              workspaceId={workspace.id}
              documents={documents.data.documents}
              {...(deleted?.kind === "document" ? { deleted } : {})}
              onUndone={undone}
            />
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The context file's card: its sections, or a way to start one, then what else models here read
 * and the ways to look after it (Recent changes, Tidy). Only a planning workspace has one (#301).
 */
function ContextFileCard(props: {
  workspaceId: WorkspaceId;
  contextFile: ContextFile | null;
  ownerContextShared: OwnerContextShared;
}) {
  const { workspaceId, contextFile, ownerContextShared } = props;
  return (
    <>
      <SectionTitle>Context file</SectionTitle>
      {(contextFile === null || !hasLines(contextFile)) && (
        <GetToKnow
          about={{ kind: "workspace", id: workspaceId }}
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
              <StatusPill
                action={
                  <ButtonLink size="sm" to="/tidy" search={{ workspace: workspaceId }}>
                    Tidy
                  </ButtonLink>
                }
              >
                Getting long: it goes with every message, so keep it to what matters.
              </StatusPill>
            </div>
          )}
          <ContextFileSections contextFile={contextFile} workspaceId={workspaceId} />
        </>
      )}
      {ownerContextShared !== "none" && (
        <p className="mt-6 text-sm text-muted-foreground">
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
          search={{ workspace: workspaceId }}
          className="text-foreground underline"
        >
          Recent changes
        </Link>
        , with Undo
        {contextFile !== null &&
          hasLines(contextFile) &&
          contextFile.characters <= CONTEXT_FILE_LONG_CHARACTERS && (
            <>
              {" · "}
              <Link
                to="/tidy"
                search={{ workspace: workspaceId }}
                className="text-foreground underline"
              >
                Tidy
              </Link>
            </>
          )}
      </p>
    </>
  );
}

/**
 * The workspace's skills (ADR 0016), below its context file: each one models here can use, where
 * it comes from, and why any can't be used, then how to add one. Nothing here is a setting:
 * skills are files.
 */
function Skills(props: { skills: readonly SkillSummary[] }) {
  return (
    <section aria-label="Skills" className={CARD}>
      <div className="flex flex-col gap-1">
        <SectionTitle>Skills</SectionTitle>
        <p className="text-sm/5.25 text-muted-foreground">
          What models here can use. Pick one with <span className="md:hidden">Skill</span>
          <span className="max-md:hidden">/</span> in the message box.
        </p>
      </div>
      <div className="mt-2">
        <SkillList skills={props.skills} label="Skills" />
      </div>
      <p className="mt-4 text-sm/5.25 text-muted-foreground">
        Add your own: a folder with a <code>SKILL.md</code>, in an <code>.agents/skills</code>{" "}
        folder in this workspace's folder, or at the top of your context folder for every workspace.
      </p>
    </section>
  );
}

const NO_SESSIONS: CodeSessionList = { sessions: [], running: 0 };

/**
 * The workspace's sessions as the page loaded them, asked for again every few seconds while one is
 * working or needs the owner, so its lists keep saying whose turn it is (#179) and where each pull
 * request stands (#240).
 */
const useSessionList = (loaded: CodeSessionList | undefined) => {
  const [asked, setAsked] = useState<{ from: CodeSessionList; now: CodeSessionList }>();
  const fromPage = loaded ?? NO_SESSIONS;
  // The page's own list until a newer one is asked for, and again whenever the page reloads it.
  const list = asked?.from === fromPage ? asked.now : fromPage;
  const workspaceId = list.sessions[0]?.workspaceId;
  useRefreshWhileBusy(list.sessions, () => {
    if (workspaceId === undefined) return;
    void fromWorker(
      `/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
      CodeSessionList,
    ).then((result) => {
      if (result.kind === "loaded") setAsked({ from: fromPage, now: result.data });
    });
  });
  return list;
};

/**
 * The context file's sections. Its intro is shown under the workspace's title instead. Each plan
 * has Grill this plan.
 */
function ContextFileSections(props: { contextFile: ContextFile; workspaceId: WorkspaceId }) {
  const { contextFile, workspaceId } = props;
  return (
    <div className="mt-4 space-y-6">
      <FactsPlansIdeas
        {...contextFile}
        plan={(plan: string) => <GrillablePlan workspaceId={workspaceId} plan={plan} />}
      />
      {contextFile.other !== "" && (
        <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
          {contextFile.other}
        </pre>
      )}
    </div>
  );
}
