import {
  ChangeId,
  CONTEXT_FILE_LONG_CHARACTERS,
  type ContextFile,
  hasLines,
  SessionList,
  type SessionSummary,
  type SkillSummary,
  WORKSPACE_NAME_MAX_LENGTH,
  WorkspaceDetail,
  WorkspaceId,
  type WorkspaceMode,
} from "@courtyard/contract";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, Pencil } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { ConfirmStep } from "@/components/confirm-step";
import { FactsPlansIdeas } from "@/components/context-lines";
import { EmptyState, Notice, StatusPill } from "@/components/notice";
import { LIST_ROW, Page, PageTitle, SectionTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { SkillList } from "@/components/skill-list";
import { ColourChooser } from "@/components/workspace-colour";
import { DocumentsSection } from "../../documents/documents-section.tsx";
import { describeProblem, Problem } from "../../problems.tsx";
import { Composer } from "../../sessions/composer.tsx";
import { GetToKnow } from "../../sessions/get-to-know.tsx";
import { GrillablePlan } from "../../sessions/grill-plan.tsx";
import { startSession } from "../../sessions/messages.ts";
import { describeWhen } from "../../when.ts";
import {
  archiveWorkspace,
  changeWorkspace,
  fromWorker,
  loadProviders,
  loadSkills,
  NOT_FOUND,
} from "../../worker.ts";

export const Route = createFileRoute("/_app/workspaces/$workspaceId/")({
  // A document just deleted from its page, which this page offers to undo (ADR 0020).
  validateSearch: (search: Record<string, unknown>) => {
    const deleted = ChangeId.safeParse(search.deleted);
    const name = typeof search.name === "string" ? search.name : undefined;
    return {
      ...(deleted.success ? { deleted: deleted.data } : {}),
      ...(name === undefined ? {} : { name }),
    };
  },
  loader: async ({ params }) => {
    const id = encodeURIComponent(params.workspaceId);
    const workspaceId = WorkspaceId.safeParse(params.workspaceId);
    const [detail, sessions, providers, skills, documents] = await Promise.all([
      fromWorker(`/workspaces/${id}`, WorkspaceDetail),
      fromWorker(`/workspaces/${id}/sessions`, SessionList),
      loadProviders(),
      workspaceId.success ? loadSkills(workspaceId.data) : NOT_FOUND,
      // Imported here, so documents' schemas stay off the first load.
      workspaceId.success
        ? import("../../documents/api.ts").then((api) => api.loadDocuments(workspaceId.data))
        : NOT_FOUND,
    ]);
    return { detail, sessions, providers, skills, documents };
  },
  component: Workspace,
});

function Workspace() {
  const { detail, sessions, providers, skills, documents } = Route.useLoaderData();
  const search = Route.useSearch();
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
              <StatusPill
                action={
                  <ButtonLink size="sm" to="/tidy" search={{ workspace: workspace.id }}>
                    Tidy
                  </ButtonLink>
                }
              >
                Getting long: it goes with every message, so keep it to what matters.
              </StatusPill>
            </div>
          )}
          <ContextFileSections
            contextFile={contextFile}
            {...(workspace.mode === "planning" && { workspaceId: workspace.id })}
          />
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
        , with Undo
        {contextFile !== null &&
          hasLines(contextFile) &&
          contextFile.characters <= CONTEXT_FILE_LONG_CHARACTERS && (
            <>
              {" · "}
              <Link
                to="/tidy"
                search={{ workspace: workspace.id }}
                className="text-foreground underline"
              >
                Tidy
              </Link>
            </>
          )}
      </p>
      {workspace.mode === "planning" && documents.kind === "loaded" && (
        <DocumentsSection
          workspaceId={workspace.id}
          documents={documents.data.documents}
          {...(search.name === undefined
            ? {}
            : { deleted: { name: search.name, change: search.deleted } })}
          onUndone={async () => {
            await navigate({
              to: "/workspaces/$workspaceId",
              params: { workspaceId: workspace.id },
              search: {},
              replace: true,
            });
            await router.invalidate();
          }}
        />
      )}
      {skills.kind === "loaded" && <Skills skills={skills.data.skills} mode={workspace.mode} />}
    </Page>
  );
}

/**
 * The workspace's skills (ADR 0016), below its context file: each one models here can use, where
 * it comes from, and why any can't be used, then how to add one. Nothing here is a setting:
 * skills are files.
 */
function Skills(props: { skills: readonly SkillSummary[]; mode: WorkspaceMode }) {
  return (
    <section aria-label="Skills" className="mt-12">
      <div className="flex flex-col gap-1">
        <SectionTitle>Skills</SectionTitle>
        <p className="text-sm/[21px] text-muted-foreground">
          What models here can use. Pick one with <span className="md:hidden">Skill</span>
          <span className="max-md:hidden">/</span> in the message box.
        </p>
      </div>
      <div className="mt-2">
        <SkillList skills={props.skills} label="Skills" />
      </div>
      <p className="mt-4 text-sm/[21px] text-muted-foreground">
        Add your own: a folder with a <code>SKILL.md</code>, in an <code>.agents/skills</code>{" "}
        folder in this workspace's folder, {props.mode === "code" && "or its repo's, "}or at the top
        of your context folder for every workspace.
      </p>
    </section>
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

/**
 * The context file's sections. Its intro is shown under the workspace's title instead. Given the
 * workspace (a planning one), each plan has Grill this plan.
 */
function ContextFileSections(props: { contextFile: ContextFile; workspaceId?: WorkspaceId }) {
  const { contextFile, workspaceId } = props;
  return (
    <div className="mt-4 space-y-6">
      <FactsPlansIdeas
        {...contextFile}
        {...(workspaceId !== undefined && {
          plan: (plan: string) => <GrillablePlan workspaceId={workspaceId} plan={plan} />,
        })}
      />
      {contextFile.other !== "" && (
        <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
          {contextFile.other}
        </pre>
      )}
    </div>
  );
}
