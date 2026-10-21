import type {
  ChangeId,
  CodeSessionList,
  ContextFile,
  DocumentList,
  OwnerContextShared,
  Project,
  ProviderList,
  SkillList,
  ThingList,
  WorkspaceSummary,
} from "@courtyard/contract";
import { hasLines } from "@courtyard/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, FileText, Image, Tag } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/buttons/button";
import { useFilePicker } from "@/components/forms/file-picker";
import { CardDialog } from "@/components/layout/card-dialog";
import { useKept } from "@/components/layout/kept";
import { Notice } from "@/components/layout/notice";
import { NotKept, OfflineLine } from "@/components/layout/offline";
import { Page, type TitleBeside } from "@/components/layout/page";
import { type WorkspaceTab, WorkspaceTabs } from "@/components/workspace/workspace-tabs";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import type { FromWorker } from "../../api/worker.ts";
import type { OfflinePage } from "../../api/workspace-page.ts";
import { useDock } from "../../components/frame/handheld.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { DocumentsSection } from "../documents/documents-section.tsx";
import { projectInHash } from "../projects/api.ts";
import { ProjectView } from "../projects/project-view.tsx";
import { ProjectsBlock } from "../projects/projects-block.tsx";
import { Composer } from "../sessions/composer/composer.tsx";
import { startSession } from "../sessions/composer/messages.ts";
import { SessionLinks } from "../sessions/session-links.tsx";
import { ThingsSection } from "../things/things-section.tsx";
import { KEPT_HOME, loadKeptHome } from "./api.ts";
import { HomeSubjectBlock } from "./home-subject.tsx";
import { WhatCourtyardKnows } from "./knows.tsx";
import css from "./planning-home.css?inline";

// The Home's own stylesheet (planning-home.css), added once, when a planning workspace's page first
// opens.
addStylesheet("planning-home", css);

/**
 * The places a planning workspace's page shows by its hash: its tabs, What Courtyard knows, and a
 * project (`project/<slug>`, #603). Home is `#new` too, as the frame's New session opens it, with
 * the box open.
 */
type Place = "" | "sessions" | "things" | "docs" | "knows" | "project";

const placeIn = (hash: string): Place =>
  hash === "sessions" || hash === "things" || hash === "docs" || hash === "knows"
    ? hash
    : projectInHash(hash) !== undefined
      ? "project"
      : "";

/** A document or a Thing just deleted from its page, which its tab offers to undo. */
export type Deleted = {
  readonly kind: "document" | "thing";
  readonly name: string;
  readonly change: ChangeId | undefined;
};

/** What the page loaded for Home and its tabs. */
export type PlanningLoaded = {
  readonly providers: FromWorker<ProviderList>;
  readonly skills: FromWorker<SkillList>;
  readonly documents: FromWorker<DocumentList>;
  readonly things: FromWorker<ThingList>;
};

/**
 * A planning workspace's page under its name (#300, #603; Paper, "Tablet · Mountain biking Home:
 * the bike, then projects (#603)"). Its header: the name with its ⋯, and pills for + New ·
 * History · Things · Docs, each tab once it has something, with its count, by the address's hash.
 * Home leads with the workspace's main subject (the drawn bike, or a room's floor plan), then its
 * projects, then the box that starts a new session; not a chat. An empty workspace shows only its
 * name, one line and the box. Nothing on it is a warning or a nudge: a planning workspace stays
 * calm (AGENTS.md).
 */
export default function PlanningHome(props: {
  /** The page's title, given a line to put under the name, its tabs and its photo. */
  header: (beside: TitleBeside) => ReactNode;
  workspace: WorkspaceSummary;
  contextFile: ContextFile | null;
  ownerContextShared: OwnerContextShared;
  list: CodeSessionList;
  loaded: PlanningLoaded;
  /** The address's hash: the tab, or `knows`. */
  hash: string;
  deleted: Deleted | undefined;
  onUndone: () => Promise<void>;
  /**
   * Read from the device's copy (#106; Paper, "Cover · Workspace, offline"): read-only, its Things
   * and Docs faint (not kept), and the grey line saying it's a copy in place of the message box.
   */
  offline?: OfflinePage;
}) {
  const { workspace, contextFile, list, deleted, offline } = props;
  const { providers, skills, documents, things } = props.loaded;
  const navigate = useNavigate();
  const dock = useDock();
  const home = useKept(KEPT_HOME, {
    key: workspace.id,
    load: () => loadKeptHome(workspace.id),
    asking: offline === undefined,
  });
  /** What's put in the box: nothing, to type in (+ New), words to go on, or a photo or doc to send. */
  const [draft, setDraft] = useState<{ text: string; files?: readonly File[]; key: number }>();
  /** The rail's Add, asking what to add, and Add Thing's form, opened from it. */
  const [adding, setAdding] = useState(false);
  const [addingThing, setAddingThing] = useState(false);

  const allThings = things.kind === "loaded" ? things.data.things : [];
  const thingCount = offline?.notKept.things ?? allThings.length;
  const docCount =
    offline?.notKept.documents ??
    (documents.kind === "loaded" ? documents.data.documents.length : 0);
  const faint = offline === undefined ? {} : { faint: true };
  const tabs: WorkspaceTab[] = [
    ...(list.sessions.length > 0
      ? [{ hash: "sessions", label: "History", count: list.sessions.length }]
      : []),
    // A tab whose last one was just deleted stays, with its Undo.
    ...(thingCount > 0 || deleted?.kind === "thing" || hasProblems(things)
      ? [{ hash: "things", label: "Things", count: thingCount, ...faint }]
      : []),
    ...(docCount > 0 || deleted?.kind === "document"
      ? [{ hash: "docs", label: "Docs", count: docCount, ...faint }]
      : []),
  ];
  const asked = placeIn(props.hash);
  // A document or Thing deleted from its page comes back to its tab, with Undo.
  const place: Place =
    asked === "" && deleted !== undefined
      ? deleted.kind === "thing"
        ? "things"
        : "docs"
      : asked === "knows" ||
          asked === "project" ||
          (asked === "things" && addingThing) ||
          tabs.some((tab) => tab.hash === asked)
        ? asked
        : "";
  const empty = tabs.length === 0 && (contextFile === null || !hasLines(contextFile));
  // Add Thing's form opens once, from Add: back on another tab, it's closed.
  useEffect(() => {
    if (place !== "things") setAddingThing(false);
  }, [place]);

  /** A photo or a doc goes in the box, for a new session about it. */
  const toSend = (file: File) => {
    setAdding(false);
    setDraft({ text: "", files: [file], key: Date.now() });
  };
  /**
   * Opens the box, to start a session: + New. It opens while the tap is still the browser's, so
   * the keyboard can follow it in.
   */
  const startNew = () => {
    flushSync(() => dock?.open());
    setDraft({ text: "", key: Date.now() });
  };
  const photoPicker = useFilePicker({ accept: "image/*", onPick: toSend });
  const docPicker = useFilePicker({ accept: "application/pdf,image/*", onPick: toSend });
  // The rail's Add (#481): a Thing, a photo or a doc. On the rail before the first paint, so
  // Settings under it never moves (#398).
  useLayoutEffect(() => {
    if (offline !== undefined) return;
    return dock?.offerAdd(() => setAdding(true));
  }, [dock, offline]);

  const homeNow = offline === undefined ? home : undefined;
  /** The project the page shows (#603), by the hash's name for it, once Home has it. */
  const projectSlug = place === "project" ? projectInHash(props.hash) : undefined;
  const project = homeNow?.projects.find(({ slug }) => slug === projectSlug);

  // Its own classes apply inside each part (planning-home.css), but not to the page's title around
  // them: a line under the name while it's empty, else the pills under it.
  const header = (
    <>
      {props.header({
        ...(empty
          ? {
              under: (
                <div data-planning-home="">
                  <p className="text-body text-muted-foreground">
                    Tell Courtyard about this, by voice or photo
                  </p>
                </div>
              ),
            }
          : {
              under: (
                <div data-planning-home="">
                  <WorkspaceTabs
                    workspaceId={workspace.id}
                    tabs={tabs}
                    chosen={place === "knows" || place === "project" ? "" : place}
                    pills={{
                      action: {
                        label: "+ New",
                        onClick: () => {
                          startNew();
                          void navigate({
                            to: "/workspaces/$workspaceId",
                            params: { workspaceId: workspace.id },
                            hash: "new",
                          });
                        },
                      },
                    }}
                  />
                </div>
              ),
            }),
      })}
      {workspace.configProblem !== undefined && (
        <div data-planning-home="">
          <div className="mt-4">
            <Notice>Treated as a planning workspace. {workspace.configProblem}</Notice>
          </div>
        </div>
      )}
    </>
  );

  // On a touch screen the message box docks in the frame, so the foot keeps no room of its own.
  const footer = (
    <div data-planning-home="">
      <div>
        {offline !== undefined ? (
          <div className="pt-2 pb-3 md:pb-6">
            <OfflineLine at={offline.at} />
          </div>
        ) : providers.kind === "loaded" ? (
          <Composer
            providers={providers.data.providers}
            placeholder="Talk or type to start a session…"
            submitLabel="Start"
            {...(draft === undefined ? {} : { draft })}
            {...(skills.kind === "loaded"
              ? { skills: { workspaceName: workspace.name, list: skills.data.skills } }
              : {})}
            send={async (message, files) => {
              // From a project's page, the session belongs to it (#603).
              const session = await startSession({
                workspaceId: workspace.id,
                message: project === undefined ? message : { ...message, project: project.slug },
                files,
              });
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
    </div>
  );

  return (
    <Page wide fill={place === ""} header={header} footer={footer}>
      <div data-planning-home="">
        <div
          className={classes("mt-4 flex flex-col gap-3.5", place === "" && "md:min-h-0 md:flex-1")}
        >
          {place === "sessions" ? (
            <SessionLinks
              list={list}
              mode="planning"
              {...(offline === undefined ? {} : { kept: offline.conversations })}
            />
          ) : offline !== undefined && (place === "things" || place === "docs") ? (
            <NotKept />
          ) : place === "things" ? (
            things.kind === "loaded" && (
              <ThingsSection
                workspaceId={workspace.id}
                list={things.data}
                {...(deleted?.kind === "thing" ? { deleted } : {})}
                onUndone={props.onUndone}
                adding={addingThing}
              />
            )
          ) : place === "docs" ? (
            documents.kind === "loaded" && (
              <DocumentsSection
                workspaceId={workspace.id}
                documents={documents.data.documents}
                {...(deleted?.kind === "document" ? { deleted } : {})}
                onUndone={props.onUndone}
              />
            )
          ) : place === "project" ? (
            project !== undefined ? (
              <ProjectView workspaceId={workspace.id} project={project} />
            ) : (
              homeNow !== undefined && (
                <p className="text-body text-muted-foreground">This project isn't here any more.</p>
              )
            )
          ) : place === "knows" ? (
            <WhatCourtyardKnows
              workspaceId={workspace.id}
              contextFile={contextFile}
              ownerContextShared={props.ownerContextShared}
              skills={skills.kind === "loaded" ? skills.data.skills : undefined}
              readOnly={offline !== undefined}
            />
          ) : offline !== undefined ? (
            // Read from the copy, with no ⋯ to open it from: What Courtyard knows, as one row.
            <Link
              to="/workspaces/$workspaceId"
              params={{ workspaceId: workspace.id }}
              hash="knows"
              className="flex h-11 items-center gap-2.5 rounded-row border bg-surface px-3.5 text-sm font-bold text-foreground/90 outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="grow">What Courtyard knows</span>
              <ChevronRight aria-hidden className="size-4 text-placeholder" />
            </Link>
          ) : (
            homeNow !== undefined && (
              <>
                {/* With projects and no subject to show, the projects fill Home (#603). */}
                {(homeNow.subject !== null || !hasActive(homeNow.projects)) && (
                  <HomeSubjectBlock workspaceId={workspace.id} subject={homeNow.subject} />
                )}
                <ProjectsBlock
                  workspaceId={workspace.id}
                  projects={homeNow.projects}
                  alone={homeNow.subject === null}
                />
              </>
            )
          )}
        </div>
      </div>
      {/* Outside the Home's scope: the card's classes are the first load's. */}
      <CardDialog
        title="Add"
        note={`To ${workspace.name}`}
        open={adding}
        onClose={() => setAdding(false)}
      >
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setAdding(false);
              setAddingThing(true);
              void navigate({
                to: "/workspaces/$workspaceId",
                params: { workspaceId: workspace.id },
                hash: "things",
              });
            }}
          >
            <Tag aria-hidden />A Thing
          </Button>
          <Button variant="outline" size="lg" onClick={photoPicker.open}>
            <Image aria-hidden />A photo
          </Button>
          <Button variant="outline" size="lg" onClick={docPicker.open}>
            <FileText aria-hidden />A doc
          </Button>
        </div>
        {photoPicker.picker}
        {docPicker.picker}
      </CardDialog>
    </Page>
  );
}

/** Whether any of the workspace's projects is being carried on, so Home lists it (#603). */
const hasActive = (projects: readonly Project[]) =>
  projects.some((project) => project.status === "active");

/** Whether some of the workspace's Things files can't be read, which its Things tab says. */
const hasProblems = (things: FromWorker<ThingList>) =>
  things.kind === "loaded" && things.data.problems.length > 0;
