import type {
  CodeSessionList,
  MattSetup,
  NextUpIssue,
  ProviderList,
  SkillList,
  WorkspaceConnections,
  WorkspaceSummary,
} from "@courtyard/contract";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ConnectionsLine } from "@/components/connections-line";
import { useLayout } from "@/components/handheld";
import { createKept, PlaceholderRows, useKept } from "@/components/kept";
import { type WorkspaceTab, WorkspaceTabs } from "@/components/workspace-tabs";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import { loadMattSetup } from "../matt-setup/api.ts";
import { describeProblem } from "../problems.tsx";
import PullRequests, { useOpenPullRequests } from "../review/pull-requests.tsx";
import { Composer } from "../sessions/composer.tsx";
import { startSession } from "../sessions/messages.ts";
import { SessionLinks } from "../sessions/session-links.tsx";
import type { FromWorker } from "../worker.ts";
import { loadConnections, loadNextUp } from "./api.ts";
import css from "./code-home.css?inline";
import { ConnectionsSheet } from "./connections.tsx";
import { MainRow } from "./main-row.tsx";
import { NeedsYou, needsOf } from "./needs-you.tsx";
import { NextUp } from "./next-up.tsx";
import { Running } from "./running.tsx";

// The Home's own stylesheet (code-home.css), added once, when a code workspace's page first opens.
addStylesheet("code-home", css);

// Where a code session would start, so the owner knows to sign in to GitHub first (#99).
const SignIns = lazy(() => import("../sign-ins/sign-ins.tsx"));

/** The tabs a code workspace's page has, by their hash; Home has none (#301). */
const TABS = { sessions: "Sessions", prs: "PRs" } as const;
type Tab = keyof typeof TABS | "";

const tabIn = (hash: string): Tab => (hash === "sessions" || hash === "prs" ? hash : "");

/** Each workspace's connections, setup check and Next up as last known, for the tab's lifetime. */
const KEPT_CONNECTIONS = createKept<WorkspaceConnections>();
const KEPT_SETUP = createKept<MattSetup>();
const KEPT_NEXT_UP = createKept<readonly NextUpIssue[]>();

const NO_SETUP: MattSetup = { state: "none" };

/** What the worker answered, or nothing to keep when it didn't. */
const known = <T,>(loaded: FromWorker<T>) => (loaded.kind === "loaded" ? loaded.data : undefined);

/**
 * A code workspace's page under its name (#301; Paper, "Code workspace Home", desktop, tablet and
 * cover screen): its one line and its connections line (#308), its tabs (Home · Sessions · PRs),
 * and on Home, in a fixed order, Needs you, Running, Next up, Main, then the message box at the
 * foot. From a tablet up it's exactly the screen tall and never scrolls (#335): the blocks share
 * the height left, each keeping its place, empty or not (#283), and scroll inside their cards.
 * Its knowledge lives in its repository, so it has no context file, Things or skills here.
 */
export default function CodeHome(props: {
  workspace: WorkspaceSummary;
  description: string | undefined;
  list: CodeSessionList;
  providers: FromWorker<ProviderList>;
  skills: FromWorker<SkillList>;
  /** The address's hash: the tab, or `connections` to open the Connections sheet. */
  hash: string;
}) {
  const { workspace, list, providers } = props;
  const navigate = useNavigate();
  const router = useRouter();
  const layout = useLayout();
  const tab = tabIn(props.hash);
  /** Asked again when the page has changed something (merged, approved). */
  const [again, setAgain] = useState(0);
  // What loads after the page shows the last answer known at once, and is asked for again
  // quietly (owner, 2026-10-12: nothing jumps in late); unknown, its block keeps its place.
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
  const [connecting, setConnecting] = useState(false);
  const line = useRef<HTMLButtonElement>(null);

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

  const pulls = open?.pullRequests ?? [];
  const needs = needsOf({ sessions: list.sessions, pulls, setup });
  /** Whether what Needs you shows is still to come, on a first visit. */
  const needsPending = open === undefined;
  const tabs: WorkspaceTab[] = [
    { hash: "", label: "Home" },
    ...(list.sessions.length > 0
      ? [{ hash: "sessions", label: TABS.sessions, count: list.sessions.length }]
      : []),
    ...(pulls.length > 0 || list.sessions.some((session) => session.pullRequest !== undefined)
      ? [{ hash: "prs", label: TABS.prs, count: pulls.length }]
      : []),
  ];
  // The tabs keep their row until the pull requests are known, so a PRs tab never pushes in.
  const showsTabs = tabs.length > 1 || open === undefined;
  const chosen = tabs.some((each) => each.hash === tab) ? tab : "";

  return (
    <div data-code-home="">
      <div className="mt-2 flex flex-col gap-2">
        {props.description !== undefined && (
          <p className="line-clamp-1 text-interface font-medium text-muted-foreground">
            {props.description}
          </p>
        )}
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
      <Suspense fallback={null}>
        <SignIns part="github-notice" />
      </Suspense>

      {showsTabs && (
        <div className="mt-3.5">
          <WorkspaceTabs workspaceId={workspace.id} tabs={tabs} chosen={chosen} />
        </div>
      )}

      {/* From a tablet up the page is the screen's height (#335): the tabs' lists scroll here. */}
      {chosen === "sessions" ? (
        <div className="mt-4 flex flex-col gap-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
          <SessionLinks list={list} mode="code" />
        </div>
      ) : chosen === "prs" ? (
        <div className="mt-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
          <PullRequests workspaceId={workspace.id} sessions={list.sessions} open={open} />
        </div>
      ) : (
        // On Home the blocks share the height between the tabs and Main, each keeping its place;
        // one with more rows than fit scrolls inside its card (#335, #283).
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
              <Running workspaceId={workspace.id} sessions={list.sessions} running={list.running} />
            </div>
            {providers.kind === "loaded" && (
              <NextUp
                workspaceId={workspace.id}
                issues={nextUp}
                providers={providers.data.providers}
              />
            )}
          </div>
          <div className="shrink-0">
            <MainRow workspaceId={workspace.id} />
          </div>
        </div>
      )}

      {/* On a touch screen the message box docks in the frame, so this keeps no room of its own. */}
      <div
        className={classes(
          "sticky bottom-0 mt-auto shrink-0 bg-card",
          layout === "desktop" && "pt-6 pb-6",
        )}
      >
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
}
