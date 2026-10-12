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
import { type WorkspaceTab, WorkspaceTabs } from "@/components/workspace-tabs";
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

/**
 * A code workspace's page under its name (#301; Paper, "Code workspace Home", desktop, tablet and
 * cover screen): its one line and its connections line (#308), its tabs (Home · Sessions · PRs),
 * and on Home, in a fixed order, Needs you, Running, Next up, then the message box at the foot.
 * Each block hides when it's empty, so a new workspace shows only its name, its line and the box.
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
  const open = useOpenPullRequests(workspace.id, list.sessions, true, again);
  const [connections, setConnections] = useState<WorkspaceConnections>();
  const [nextUp, setNextUp] = useState<readonly NextUpIssue[]>([]);
  const [setup, setSetup] = useState<MattSetup>({ state: "none" });
  const [connecting, setConnecting] = useState(false);
  const line = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    void loadConnections(workspace.id).then((loaded) => {
      if (current && loaded.kind === "loaded") setConnections(loaded.data);
    });
    void loadMattSetup(workspace.id).then((loaded) => {
      if (current && loaded.kind === "loaded") setSetup(loaded.data);
    });
    return () => {
      current = false;
    };
  }, [workspace.id]);

  // Next up is asked for again once a session there changes, so a Build that started shows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again as its sessions change
  useEffect(() => {
    let current = true;
    void loadNextUp(workspace.id).then((loaded) => {
      if (current) setNextUp(loaded.kind === "loaded" ? loaded.data.issues : []);
    });
    return () => {
      current = false;
    };
  }, [workspace.id, list.sessions.length]);

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
  const tabs: WorkspaceTab[] = [
    { hash: "", label: "Home" },
    ...(list.sessions.length > 0
      ? [{ hash: "sessions", label: TABS.sessions, count: list.sessions.length }]
      : []),
    ...(pulls.length > 0 || list.sessions.some((session) => session.pullRequest !== undefined)
      ? [{ hash: "prs", label: TABS.prs, count: pulls.length }]
      : []),
  ];
  const chosen = tabs.some((each) => each.hash === tab) ? tab : "";
  const anyLeft =
    needs.length > 0 ||
    setup.state === "opened" ||
    list.sessions.some((session) => session.now.kind === "working");
  const beside = layout !== "cover" && anyLeft && nextUp.length > 0;

  return (
    <div data-code-home="">
      <div className="mt-2 flex flex-col gap-2">
        {props.description !== undefined && (
          <p className="line-clamp-1 text-interface font-medium text-muted-foreground">
            {props.description}
          </p>
        )}
        {connections !== undefined && (
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
              onConnected={setConnections}
              anchor={line}
            />
          </>
        )}
      </div>
      <Suspense fallback={null}>
        <SignIns part="github-notice" />
      </Suspense>

      {tabs.length > 1 && (
        <div className="mt-3.5">
          <WorkspaceTabs workspaceId={workspace.id} tabs={tabs} chosen={chosen} />
        </div>
      )}

      {chosen === "sessions" ? (
        <div className="mt-4 flex flex-col gap-4">
          <SessionLinks list={list} mode="code" />
        </div>
      ) : chosen === "prs" ? (
        <div className="mt-4">
          <PullRequests workspaceId={workspace.id} sessions={list.sessions} open={open} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col items-stretch gap-3.5 md:flex-row md:items-start">
            {anyLeft && (
              <div className="flex min-w-0 grow basis-0 flex-col gap-3.5">
                <NeedsYou
                  workspaceId={workspace.id}
                  needs={needs}
                  setup={setup}
                  onSetup={setSetup}
                  onChanged={changed}
                />
                <Running
                  workspaceId={workspace.id}
                  sessions={list.sessions}
                  running={list.running}
                />
              </div>
            )}
            {providers.kind === "loaded" && (
              <NextUp
                workspaceId={workspace.id}
                issues={nextUp}
                providers={providers.data.providers}
                beside={beside}
              />
            )}
          </div>
        </div>
      )}

      <div className="sticky bottom-0 mt-auto bg-card pt-6 pb-3 md:pb-6">
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
