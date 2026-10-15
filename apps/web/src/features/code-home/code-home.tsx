import type {
  CodeSessionList,
  LeadStatus,
  MattSetup,
  NextUpIssue,
  ProviderList,
  SkillList,
  WorkspaceConnections,
  WorkspaceSummary,
} from "@courtyard/contract";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { ConnectionsLine } from "@/components/connections-line";
import { createKept, PlaceholderRows, useKept } from "@/components/kept";
import { InfoBox } from "@/components/notice";
import { Page } from "@/components/page";
import { useAnchorName } from "@/components/place-under";
import { Scroller } from "@/components/scroller";
import { type WorkspaceTab, WorkspaceTabs } from "@/components/workspace-tabs";
import { addStylesheet } from "@/lib/stylesheet";
import type { FromWorker } from "../../api/worker.ts";
import { describeProblem } from "../../components/problems.tsx";
import { loadMattSetup } from "../matt-setup/api.ts";
import PullRequests, { useOpenPullRequests } from "../pull-requests/pull-requests.tsx";
import { Composer } from "../sessions/composer.tsx";
import { startSession } from "../sessions/messages.ts";
import { SessionLinks } from "../sessions/session-links.tsx";
import { loadConnections, loadLead, loadNextUp } from "./api.ts";
import css from "./code-home.css?inline";
import { ConnectionsSheet } from "./connections.tsx";
import { MainRow } from "./main-row.tsx";
import { NeedsYou, needsOf } from "./needs-you.tsx";
import { NextUp } from "./next-up.tsx";
import { Running } from "./running.tsx";

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
const TABS = { sessions: "Sessions", prs: "PRs" } as const;
type Tab = keyof typeof TABS | "";

const tabIn = (hash: string): Tab => (hash === "sessions" || hash === "prs" ? hash : "");

/** Each workspace's connections, setup check and Next up as last known, for the tab's lifetime. */
const KEPT_CONNECTIONS = createKept<WorkspaceConnections>();
const KEPT_SETUP = createKept<MattSetup>();
const KEPT_NEXT_UP = createKept<readonly NextUpIssue[]>();
const KEPT_LEAD = createKept<LeadStatus>();

const NO_SETUP: MattSetup = { state: "none" };

/** What the worker answered, or nothing to keep when it didn't. */
const known = <T,>(loaded: FromWorker<T>) => (loaded.kind === "loaded" ? loaded.data : undefined);

/**
 * A code workspace's page under its name (#301; Paper, "Code workspace Home", desktop, tablet and
 * cover screen): its connections line (#308), its tabs (Home · Sessions · PRs), and on Home, in a
 * fixed order, Needs you, Running, Next up, Main, then the message box at the foot. From a tablet
 * up it's exactly the screen tall and never scrolls (#335): the blocks share the height left, each
 * keeping its place, empty or not (#283), and scroll inside their cards. Its one line, What it's
 * for, stays in its workspace.json for the home chat and turns, never on the page (#333). Its
 * knowledge lives in its repository, so it has no context file, Things or skills.
 */
export default function CodeHome(props: {
  /** The page's title and what goes with it, pinned above the line and the tabs. */
  header: ReactNode;
  workspace: WorkspaceSummary;
  list: CodeSessionList;
  providers: FromWorker<ProviderList>;
  skills: FromWorker<SkillList>;
  /** The address's hash: the tab, or `connections` to open the Connections sheet. */
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
      // Not signed in, say: there's no Next up, so its block goes.
      return loaded.kind === "offline"
        ? undefined
        : loaded.kind === "loaded"
          ? loaded.data.issues
          : [];
    },
    again: list.sessions.length,
  });
  // The Lead (#347), asked for again as its sessions change, as Next up is.
  const lead = useKept(KEPT_LEAD, {
    key: workspace.id,
    load: async () => known(await loadLead(workspace.id)),
    again: `${list.sessions.length}-${list.sessions.filter((session) => session.busy).length}-${again}`,
  });
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
  const needs = needsOf({ sessions: list.sessions, pulls, setup, lead });
  /** Whether what Needs you shows is still to come, on a first visit. */
  const needsPending = open === undefined;
  const tabs: WorkspaceTab[] = [
    { hash: "", label: "Home" },
    ...(list.sessions.length > 0
      ? [{ hash: "sessions", label: TABS.sessions, count: list.sessions.length }]
      : []),
    // Opened on PRs before they're known, it stays on PRs, its list in its faint place.
    ...(pulls.length > 0 ||
    list.sessions.some((session) => session.pullRequest !== undefined) ||
    (open === undefined && tab === "prs")
      ? [{ hash: "prs", label: TABS.prs, ...(open === undefined ? {} : { count: pulls.length }) }]
      : []),
  ];
  // The tabs keep their row until the pull requests are known, so a PRs tab never pushes in.
  const showsTabs = tabs.length > 1 || open === undefined;
  const chosen = tabs.some((each) => each.hash === tab) ? tab : "";

  // Its own classes apply inside each part (code-home.css), but not to the page's title above.
  const header = (
    <>
      {props.header}
      <div data-code-home="">
        <div className="mt-2 flex flex-col gap-2">
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
        {/* With the connections line, so it never comes on its own and pushes the rest down. */}
        {connections?.github.kind === "signed-out" && <GitHubNotice />}

        {showsTabs && (
          <div className="mt-3.5">
            <WorkspaceTabs workspaceId={workspace.id} tabs={tabs} chosen={chosen} />
          </div>
        )}
      </div>
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
        {chosen === "sessions" ? (
          <Scroller from="tablet" className="mt-4 flex flex-col gap-4 md:min-h-0 md:flex-1">
            <SessionLinks list={list} mode="code" />
          </Scroller>
        ) : chosen === "prs" ? (
          <Scroller from="tablet" className="mt-4 md:min-h-0 md:flex-1">
            <PullRequests workspaceId={workspace.id} sessions={list.sessions} open={open} />
          </Scroller>
        ) : (
          // On Home the blocks share the height above Main, each keeping its place; one with more
          // rows than fit scrolls inside its card (#335, #283).
          <div className="mt-4 flex flex-col gap-3 md:min-h-0 md:flex-1">
            <div className="flex flex-col items-stretch gap-3.5 md:min-h-0 md:flex-1 md:flex-row">
              <div className="flex min-w-0 grow basis-0 flex-col gap-3.5 md:min-h-0">
                <NeedsYou
                  workspaceId={workspace.id}
                  needs={needs}
                  pending={needsPending}
                  setup={setup}
                  onSetup={(now) => KEPT_SETUP.set(workspace.id, now)}
                  onChanged={changed}
                />
                <Running
                  workspaceId={workspace.id}
                  sessions={list.sessions}
                  running={list.running}
                  lead={lead}
                  providers={providers.kind === "loaded" ? providers.data.providers : undefined}
                  onLead={leadChanged}
                />
              </div>
              {providers.kind === "loaded" && (
                <NextUp
                  workspaceId={workspace.id}
                  issues={nextUp}
                  providers={providers.data.providers}
                  lead={lead}
                  onLead={leadChanged}
                />
              )}
            </div>
            <div className="shrink-0">
              <MainRow workspaceId={workspace.id} again={again} />
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
