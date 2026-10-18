import type {
  ChangeId,
  CodeSessionList,
  ContextFile,
  DocumentList,
  DuePlan,
  OwnerContextShared,
  ProviderList,
  SkillList,
  ThingList,
  WorkspaceSummary,
} from "@courtyard/contract";
import { hasLines } from "@courtyard/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Notice } from "@/components/layout/notice";
import { NotKept, OfflineLine } from "@/components/layout/offline";
import { Page, type TitleBeside } from "@/components/layout/page";
import { type WorkspaceTab, WorkspaceTabs } from "@/components/workspace/workspace-tabs";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import type { FromWorker } from "../../api/worker.ts";
import type { OfflinePage } from "../../api/workspace-page.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { DocumentsSection } from "../documents/documents-section.tsx";
import { Composer } from "../sessions/composer/composer.tsx";
import { startSession } from "../sessions/composer/messages.ts";
import { SessionLinks } from "../sessions/session-links.tsx";
import { ThingsSection } from "../things/things-section.tsx";
import { WhatCourtyardKnows } from "./knows.tsx";
import { NextUp } from "./next-up.tsx";
import css from "./planning-home.css?inline";

// The Home's own stylesheet (planning-home.css), added once, when a planning workspace's page first
// opens.
addStylesheet("planning-home", css);

/** The places a planning workspace's page shows by its hash: its tabs, and What Courtyard knows. */
type Place = "" | "sessions" | "things" | "docs" | "knows";

const placeIn = (hash: string): Place =>
  hash === "sessions" || hash === "things" || hash === "docs" || hash === "knows" ? hash : "";

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
 * A planning workspace's page under its name (#300; Paper, "Tablet · Planning workspace Home" and
 * its Sessions, Things and Docs tabs): its tabs (Home · Sessions · Things · Docs), each but Home
 * shown once it has something, with its count, by the address's hash; on Home, Next up, then the
 * one row for What Courtyard knows, then the message box at the foot, which starts a new session.
 * An empty workspace shows only its name, one line and the box. Nothing on it is a warning or a
 * nudge: a planning workspace stays calm (AGENTS.md).
 */
export default function PlanningHome(props: {
  /** The page's title, given a line to put under the name and the tabs beside it. */
  header: (beside: TitleBeside) => ReactNode;
  workspace: WorkspaceSummary;
  contextFile: ContextFile | null;
  ownerContextShared: OwnerContextShared;
  duePlans: readonly DuePlan[];
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

  const thingCount =
    offline?.notKept.things ?? (things.kind === "loaded" ? things.data.things.length : 0);
  const docCount =
    offline?.notKept.documents ??
    (documents.kind === "loaded" ? documents.data.documents.length : 0);
  const faint = offline === undefined ? {} : { faint: true };
  const tabs: WorkspaceTab[] = [
    { hash: "", label: "Home" },
    ...(list.sessions.length > 0
      ? [{ hash: "sessions", label: "Sessions", count: list.sessions.length }]
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
      : asked === "knows" || tabs.some((tab) => tab.hash === asked)
        ? asked
        : "";
  const empty = tabs.length === 1 && (contextFile === null || !hasLines(contextFile));

  // Its own classes apply inside each part (planning-home.css), but not to the page's title around
  // them: a line under the name while it's empty, else the tabs beside it (#503). In What
  // Courtyard knows, Home is the way back.
  const showsTabs = !empty && (tabs.length > 1 || place === "knows");
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
          : {}),
        ...(showsTabs
          ? {
              tabs: (
                <div data-planning-home="">
                  <WorkspaceTabs workspaceId={workspace.id} tabs={tabs} chosen={place} />
                </div>
              ),
            }
          : {}),
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
          ) : place === "knows" ? (
            <WhatCourtyardKnows
              workspaceId={workspace.id}
              contextFile={contextFile}
              ownerContextShared={props.ownerContextShared}
              skills={skills.kind === "loaded" ? skills.data.skills : undefined}
              readOnly={offline !== undefined}
            />
          ) : (
            <>
              {/* A new workspace is only its name, one line and the box. */}
              {!empty && (
                <NextUp
                  workspaceId={workspace.id}
                  sessions={list.sessions}
                  duePlans={props.duePlans}
                />
              )}
              {!empty && (
                <Link
                  to="/workspaces/$workspaceId"
                  params={{ workspaceId: workspace.id }}
                  hash="knows"
                  className="flex h-11 items-center gap-2.5 rounded-row border bg-surface px-3.5 text-sm font-bold text-foreground/90 outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="grow">What Courtyard knows</span>
                  <ChevronRight aria-hidden className="size-4 text-placeholder" />
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

/** Whether some of the workspace's Things files can't be read, which its Things tab says. */
const hasProblems = (things: FromWorker<ThingList>) =>
  things.kind === "loaded" && things.data.problems.length > 0;
