import {
  builderIn,
  type CodeSessionList,
  type LeadStatus,
  type MattSetup,
  type NextUp as NextUpAnswer,
  type ProviderList,
  type SkillList,
  type WorkspaceConnections,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { Page, type TitleBeside } from "@courtyard/ui/layout/page.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { ButtonLink } from "@/components/buttons/button-link";
import { ConnectionsLine } from "@/components/code/connections-line";
import { BlockColumn } from "@/components/layout/home-block";
import { InfoBox } from "@/components/layout/notice";
import { useAnchorName } from "@/components/layout/place-under";
import { type WorkspaceTab, WorkspaceTabs } from "@/components/workspace/workspace-tabs";
import { addStylesheet } from "@/lib/stylesheet";
import type { FromWorker } from "../../api/worker.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { KEPT_LEAD, useLead } from "../builders/api.ts";
import { BuildersBoard, needsTheOwner } from "../builders/builders-board.tsx";
import { Designs } from "../designs/designs.tsx";
import { UsageLines } from "../limits/usage-lines.tsx";
import { loadMattSetup } from "../matt-setup/api.ts";
import PullRequests, { useOpenPullRequests } from "../pull-requests/pull-requests.tsx";
import { Composer } from "../sessions/composer/composer.tsx";
import { startSession } from "../sessions/composer/messages.ts";
import { SessionLinks } from "../sessions/session-links.tsx";
import { WorkspaceStatusLine } from "../status-line/status-line.tsx";
import { loadConnections, loadNextUp } from "./api.ts";
import css from "./code-home.css?inline";
import { ConnectionsSheet } from "./connections.tsx";
import { MainRow } from "./main-row.tsx";
import { NeedsYou, needsOf, onTheBoard } from "./needs-you.tsx";
import { NextUp } from "./next-up.tsx";
import { Roadmap } from "./roadmap.tsx";

// The Home's own stylesheet (code-home.css), added once, when a code workspace's page first opens.
addStylesheet("code-home", css);

/**
 * Where a code session would start: that its sessions can't reach GitHub until Courtyard is signed
 * in to it (#99), with the way to Connections.
 */
function GitHubNotice() {
  return (
    <InfoBox label="GitHub isn't connected">
      <span className="min-w-60 flex-1">
        A session here can work, but can't push its branch or open a pull request until Courtyard is
        signed in to GitHub.
      </span>
      <ButtonLink size="sm" to="/settings" hash="connections">
        Sign in to GitHub
      </ButtonLink>
    </InfoBox>
  );
}

/** The tabs a code workspace's page has, by their hash; Home has none (#301). */
const TABS = { roadmap: "Roadmap", sessions: "Sessions", prs: "PRs", designs: "Designs" } as const;
type Tab = keyof typeof TABS | "";

const tabIn = (hash: string): Tab =>
  hash === "roadmap" || hash === "sessions" || hash === "prs" || hash === "designs" ? hash : "";

/** Each workspace's connections, setup check and Next up as last known, for the tab's lifetime. */
const KEPT_CONNECTIONS = createKept<WorkspaceConnections>();
const KEPT_SETUP = createKept<MattSetup>();
const KEPT_NEXT_UP = createKept<NextUpAnswer>();

const NO_SETUP: MattSetup = { state: "none" };

/** What the worker answered, or nothing to keep when it didn't. */
const known = <T,>(loaded: FromWorker<T>) => (loaded.kind === "loaded" ? loaded.data : undefined);

/**
 * A code workspace's page under its name (#301; Paper, "Code workspace Home", desktop, tablet and
 * cover screen): its connections line (#308), its tabs (Home · Roadmap · Sessions · PRs · Designs;
 * the Roadmap, #532, its milestones and their issues; Designs, #522, its Paper file's boards), and
 * on Home, in a fixed order, the Builders
 * board (#592), Needs you, Next up, Main, then the message box at the foot. From a tablet
 * up it's exactly the screen tall and never scrolls (#335): the blocks share the height left, each
 * keeping its place, empty or not (#283), and scroll inside their cards. Its one line, What it's
 * for, stays in its workspace.json for the home chat and turns, never on the page (#333). Its
 * knowledge lives in its repository, so it has no context file, Things or skills.
 */
export default function CodeHome(props: {
  /** The page's title, given the connections line to put under the name and the tabs beside it. */
  header: (beside: TitleBeside) => ReactNode;
  workspace: WorkspaceSummary;
  list: CodeSessionList;
  providers: FromWorker<ProviderList>;
  skills: FromWorker<SkillList>;
  /**
   * The address's hash: the tab, `connections` to open the Connections sheet, or a builder's row
   * to put in view on Home's Builders board, as its notification opens it (#593).
   */
  hash: string;
}) {
  const { workspace, list, providers } = props;
  const navigate = useNavigate();
  const router = useRouter();
  const tab = tabIn(props.hash);
  /** Asked again when the page has changed something (merged, approved). */
  const [again, setAgain] = useState(0);
  // What loads after the page shows the last answer known at once, and is asked for again
  // quietly (owner, 2026-10-12: nothing jumps in late), then kept fresh the shared way (#387);
  // unknown, its block keeps its place.
  const open = useOpenPullRequests(workspace.id, list.sessions, true, again);
  const connections = useKept(KEPT_CONNECTIONS, {
    key: workspace.id,
    load: async () => known(await loadConnections(workspace.id)),
  });
  const setup =
    useKept(KEPT_SETUP, {
      key: workspace.id,
      load: async () => known(await loadMattSetup(workspace.id)),
    }) ?? NO_SETUP;
  // Asked for again once a session there changes, so a Build that started shows.
  const nextUp = useKept(KEPT_NEXT_UP, {
    key: workspace.id,
    load: async () => {
      const loaded = await loadNextUp(workspace.id);
      // Not signed in, say: there's nothing to offer. A read GitHub refused comes as an answer,
      // the last list known with why (#519).
      return loaded.kind === "offline"
        ? undefined
        : loaded.kind === "loaded"
          ? loaded.data
          : { issues: [] };
    },
    again: list.sessions.length,
  });
  // The Lead (#347) and its builders' statuses (#590), asked for again as its sessions change.
  const lead = useLead(
    workspace.id,
    `${list.sessions.length}-${list.sessions.filter((session) => session.busy).length}-${again}`,
  );
  const [connecting, setConnecting] = useState(false);
  const line = useAnchorName();

  // Right after New workspace → Code (#308), the Connections sheet offers Paper; skippable.
  useEffect(() => {
    if (props.hash === "connections" && connections !== undefined) setConnecting(true);
  }, [props.hash, connections]);

  const closeSheet = () => {
    setConnecting(false);
    if (props.hash === "connections") {
      void navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: workspace.id },
        replace: true,
      });
    }
  };

  /** Something on Home changed on GitHub or in a session: its lists are asked for again. */
  const changed = () => {
    setAgain((was) => was + 1);
    void router.invalidate();
  };

  /** The Lead started, woke or paused: shown at once, and the lists asked for again. */
  const leadChanged = (now: LeadStatus) => {
    KEPT_LEAD.set(workspace.id, now);
    changed();
  };

  const pulls = open?.pullRequests ?? [];
  // A Lead's builder that needs the owner shows on the Builders board only (#592).
  const needs = needsOf({ sessions: list.sessions, pulls, setup, lead }).filter(
    (need) => !onTheBoard(need, lead),
  );
  const boardNeedsYou = lead?.statuses.some(needsTheOwner) === true;
  /** Whether what Needs you shows is still to come, on a first visit. */
  const needsPending = open === undefined;
  // Opened on PRs before they're known, it stays on PRs, its list in its faint place.
  const hasPulls =
    pulls.length > 0 ||
    list.sessions.some((session) => session.pullRequest !== undefined) ||
    (open === undefined && tab === "prs");
  const tabs: WorkspaceTab[] = [
    { hash: "", label: "Home" },
    // Every code workspace has its Roadmap (#532): its milestones on GitHub, or why there are none.
    { hash: "roadmap", label: TABS.roadmap },
    ...(list.sessions.length > 0
      ? [{ hash: "sessions", label: TABS.sessions, count: list.sessions.length }]
      : []),
    // Without pull requests, or before they're known, PRs keeps its place (#503).
    hasPulls
      ? { hash: "prs", label: TABS.prs, count: open === undefined ? "unknown" : pulls.length }
      : { hash: "prs", label: TABS.prs, count: 0, held: true },
    // Its Paper file's boards (#522), or how to connect one.
    { hash: "designs", label: TABS.designs },
  ];
  const chosen = tabs.some((each) => each.hash === tab && each.held !== true) ? tab : "";

  // Its own classes apply inside each part (code-home.css), but not to the page's title around
  // them: the status line (#256) and the connections line under the name, and the tabs beside it
  // (#503).
  const under = (
    <div data-code-home="">
      <div className="flex flex-col gap-2">
        <WorkspaceStatusLine
          workspaceId={workspace.id}
          again={`${list.sessions.length}-${list.sessions.filter(({ busy }) => busy).length}`}
        />
        {connections === undefined ? (
          <PlaceholderRows count={1} size="text" />
        ) : (
          <>
            <ConnectionsLine
              connections={connections}
              open={connecting}
              onOpen={() => setConnecting(true)}
              anchor={line}
            />
            <ConnectionsSheet
              open={connecting}
              onClose={closeSheet}
              workspaceId={workspace.id}
              workspaceName={workspace.name}
              connections={connections}
              onConnected={(now) => KEPT_CONNECTIONS.set(workspace.id, now)}
              anchor={line}
            />
          </>
        )}
      </div>
    </div>
  );
  const header = (
    <>
      {props.header({
        under,
        tabs: (
          <div data-code-home="">
            <WorkspaceTabs workspaceId={workspace.id} tabs={tabs} chosen={chosen} />
          </div>
        ),
      })}
      {/* With the connections line, so it never comes on its own and pushes the rest down. */}
      {connections?.github.kind === "signed-out" && (
        <div data-code-home="">
          <GitHubNotice />
        </div>
      )}
    </>
  );

  // On a touch screen the message box docks in the frame, so the foot keeps no room of its own.
  const footer = (
    <div data-code-home="">
      <div>
        {providers.kind === "loaded" ? (
          <Composer
            providers={providers.data.providers}
            placeholder="Talk or type to start a session…"
            submitLabel="Start"
            {...(props.skills.kind === "loaded"
              ? { skills: { workspaceName: workspace.name, list: props.skills.data.skills } }
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
    // From a tablet up the middle is exactly the room left and never scrolls (#335): the tabs'
    // lists scroll inside it, and on Home the blocks share it, their rows scrolling in their cards.
    <Page wide fill header={header} footer={footer}>
      <div data-code-home="">
        {chosen === "roadmap" ? (
          <Roadmap
            workspaceId={workspace.id}
            paperFileId={
              connections?.paper.kind === "connected" ? connections.paper.fileId : undefined
            }
          />
        ) : chosen === "sessions" ? (
          <Scroller from="tablet" className="mt-4 flex flex-col gap-4 md:min-h-0 md:flex-1">
            <SessionLinks list={list} mode="code" />
          </Scroller>
        ) : chosen === "prs" ? (
          <Scroller from="tablet" className="mt-4 md:min-h-0 md:flex-1">
            <PullRequests workspaceId={workspace.id} sessions={list.sessions} open={open} />
          </Scroller>
        ) : chosen === "designs" ? (
          <Designs
            workspaceId={workspace.id}
            paperFileId={
              connections === undefined
                ? undefined
                : connections.paper.kind === "connected"
                  ? connections.paper.fileId
                  : null
            }
            onConnect={() => setConnecting(true)}
          />
        ) : (
          // On Home the blocks share the height above Main, each keeping its place; one with more
          // rows than fit scrolls inside its card (#335, #283).
          <div className="mt-4 flex flex-col gap-3 md:min-h-0 md:flex-1">
            <div className="flex flex-col items-stretch gap-3.5 md:min-h-0 md:flex-1 md:flex-row">
              <BlockColumn>
                <BuildersBoard
                  workspaceId={workspace.id}
                  inView={builderIn(props.hash)}
                  lead={lead}
                  sessions={list.sessions}
                  issues={nextUp?.issues}
                  providers={providers.kind === "loaded" ? providers.data.providers : undefined}
                  onLead={leadChanged}
                  onChanged={changed}
                />
                <NeedsYou
                  workspaceId={workspace.id}
                  needs={needs}
                  pending={needsPending}
                  setup={setup}
                  onSetup={(now) => KEPT_SETUP.set(workspace.id, now)}
                  onChanged={changed}
                  {...(boardNeedsYou ? { nothing: "Nothing else needs you" } : {})}
                />
              </BlockColumn>
              {providers.kind === "loaded" && (
                <NextUp
                  workspaceId={workspace.id}
                  issues={nextUp?.issues}
                  {...(nextUp?.unread === undefined ? {} : { unread: nextUp.unread })}
                  providers={providers.data.providers}
                  lead={lead}
                />
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-3">
              {/* Near a plan's limit (#66): a gold line above Main; nothing while there's room. */}
              <UsageLines />
              <MainRow workspaceId={workspace.id} again={again} />
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
