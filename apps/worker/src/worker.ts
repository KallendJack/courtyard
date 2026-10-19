import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type AllowedCommand,
  AllowedCommandRemoval,
  type AllowedCommands,
  ATTACHMENTS,
  type ContextBackup,
  type Health,
  type LiveStatus,
  LiveUpdateRequest,
  type LiveUpdateStarted,
  type MattSetup,
  MattSetupAnswer,
  NewRepo,
  type NewRepoMade,
  type NewRepoOffer,
  NewWorkspace,
  type OwnerContextDetail,
  type SetupPaper,
  type SkillList,
  WorkspaceChange,
  type WorkspaceDetail,
  WorkspaceId,
  type WorkspaceList,
  type WorkspaceMain,
  WorkspaceOrder,
  type WorkspaceSummary,
  workspaceNameFrom,
} from "@courtyard/contract";
import { HOUSE_SKILLS_FOLDER } from "@courtyard/skills";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createOwner } from "./auth/owner/index.ts";
import { loginRoutes, ownerLoggedIn, requireLogin, sameSiteJsonOnly } from "./auth/owner/routes.ts";
import { createSignIns } from "./auth/sign-ins/index.ts";
import { signInRoutes } from "./auth/sign-ins/routes.ts";
import { type Environment, readSettings } from "./config/settings.ts";
import { changeRoutes } from "./features/changes/routes.ts";
import { allowsOf, createCode, namedAs } from "./features/code/index.ts";
import { createConnections, makePaperFile } from "./features/connections/index.ts";
import { connectionRoutes } from "./features/connections/routes.ts";
import { plansDue } from "./features/context-file/index.ts";
import {
  createContextFolder,
  WORKSPACES_ARRANGED,
  workspaceChange,
} from "./features/context-folder/index.ts";
import { documentRoutes } from "./features/documents/routes.ts";
import { createFreshStart } from "./features/fresh-start/index.ts";
import { freshStartRoutes } from "./features/fresh-start/routes.ts";
import { createLead } from "./features/lead/index.ts";
import { leadRoutes } from "./features/lead/routes.ts";
import { rememberingLimits } from "./features/limits/index.ts";
import { usageRoutes } from "./features/limits/routes.ts";
import { createUsage } from "./features/limits/usage.ts";
import { createLive, runUpdateTask, type UpdateCommand } from "./features/live/index.ts";
import { createMattSetup } from "./features/matt-setup/index.ts";
import {
  createMattSkills,
  type FetchMattSkills,
  fetchFromGitHub,
  type MattPin,
} from "./features/matt-skills/index.ts";
import { createModelDefaults } from "./features/model-defaults/index.ts";
import { modelDefaultRoutes } from "./features/model-defaults/routes.ts";
import { createNextUp } from "./features/next-up/index.ts";
import { nextUpRoutes } from "./features/next-up/routes.ts";
import { createNotifications, type SendPush } from "./features/notifications/index.ts";
import { notificationRoutes } from "./features/notifications/routes.ts";
import { sendWebPush } from "./features/notifications/web-push.ts";
import { createOfflineCopy } from "./features/offline-copy/index.ts";
import { offlineCopyRoutes } from "./features/offline-copy/routes.ts";
import { readOwnerContext, startOwnerContext } from "./features/owner-context/index.ts";
import { createHomePicks } from "./features/planning-home/index.ts";
import { planningHomeRoutes } from "./features/planning-home/routes.ts";
import { createPreviews } from "./features/preview/index.ts";
import { previewRoutes } from "./features/preview/routes.ts";
import type { Screenshot } from "./features/preview/screenshot.ts";
import { createPullRequests } from "./features/pull-requests/index.ts";
import { pullRequestRoutes } from "./features/pull-requests/routes.ts";
import { createQuickQuestions } from "./features/quick-questions/index.ts";
import { quickQuestionRoutes } from "./features/quick-questions/routes.ts";
import { createRedMain } from "./features/red-main/index.ts";
import { createRepos } from "./features/repos/index.ts";
import { repoProblem, repoRoutes } from "./features/repos/routes.ts";
import { type Background, createSessions } from "./features/sessions/index.ts";
import { MESSAGE_ROUTES, sessionRoutes } from "./features/sessions/routes.ts";
import { skillList, workspaceSkills } from "./features/skills/index.ts";
import { taskRoutes } from "./features/tasks/routes.ts";
import { THING_PHOTO_ROUTES, thingRoutes } from "./features/things/routes.ts";
import { createTidying } from "./features/tidy/index.ts";
import { tidyRoutes } from "./features/tidy/routes.ts";
import { createVersionBumps } from "./features/version-bumps/index.ts";
import { waitingRoutes } from "./features/waiting/routes.ts";
import { createWanted } from "./features/wanted/index.ts";
import { wantedRoutes } from "./features/wanted/routes.ts";
import { createWorkspaceMain } from "./features/workspace-main/index.ts";
import {
  archiveWorkspace,
  arrangeWorkspaces,
  changeWorkspace,
  checkNewName,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  removeAllowed,
  type Workspace,
  type WorkspaceError,
} from "./features/workspaces/index.ts";
import { createGitHubApi, type GitHubApi } from "./integrations/github/api.ts";
import { createGitHub, KEEP_FRESH_EVERY_MS } from "./integrations/github/index.ts";
import { gitHubProblem, gitHubRoutes } from "./integrations/github/routes.ts";
import { createPaperFiles, type PaperFiles } from "./integrations/paper/files.ts";
import { apiError, contextError, readBody } from "./lib/http.ts";
import { ok, type Result } from "./lib/result.ts";
import { sharedOwnerContext } from "./prompts/index.ts";
import {
  createClaudeProvider,
  createCodexProvider,
  createFakeProvider,
  type Provider,
} from "./providers/index.ts";

export type { Environment, UpdateCommand };

/** A code workspace's Allowed commands (#185), as its list shows them: newest first. */
const allowedCommandsOf = (workspace: Workspace): AllowedCommands => ({
  commands: workspace.allowlist.always
    .map(
      ({ command, at, session, title }): AllowedCommand => ({
        allows: allowsOf(command),
        at,
        ...(session === undefined || title === undefined ? {} : { from: { session, title } }),
      }),
    )
    .reverse(),
});

export type Worker = {
  readonly app: Hono;
  readonly port: number;
};

/** The largest request body the API reads; nothing it accepts comes close. */
const MAX_BODY_BYTES = 16 * 1024;

/** The largest message with files attached (#78): five of the largest, and room for the form. */
const MAX_MESSAGE_WITH_FILES_BYTES = ATTACHMENTS.perMessage * ATTACHMENTS.pdfMaxBytes + 1024 * 1024;

/** The largest Thing's photo upload: the largest photo a message takes, and room for the form. */
const MAX_THING_PHOTO_BYTES = ATTACHMENTS.photoMaxBytes + 64 * 1024;

/** A route's path under `/api` as a pattern, each `:param` standing for one part of a path. */
const pathOf = (route: string) => new RegExp(`^/api${route.replace(/:[^/]+/g, "[^/]+")}$`);

/** A request a multipart form may be sent with: its method, and its path as a pattern. */
type FormRequest = { readonly method: string; readonly path: RegExp };

/** The requests that take a message. */
const MESSAGE_REQUESTS: readonly FormRequest[] = Object.values(MESSAGE_ROUTES).map((route) => ({
  method: "POST",
  path: pathOf(route),
}));

/** The requests that may send a Thing's photo (ADR 0020). */
const THING_PHOTO_REQUESTS: readonly FormRequest[] = THING_PHOTO_ROUTES.map(
  ({ method, route }) => ({ method, path: pathOf(route) }),
);

/** Whether a request is a multipart form sent as one of these requests. */
const formTo = (c: Context, requests: readonly FormRequest[]) =>
  requests.some(({ method, path }) => c.req.method === method && path.test(c.req.path)) &&
  (c.req.header("content-type")?.startsWith("multipart/form-data") ?? false);

/** Whether a request is a message sent with files attached (#78). */
const sendsMessageFiles = (c: Context) => formTo(c, MESSAGE_REQUESTS);

/** Whether a request sends a Thing's photo, on its own or with the form's fields (ADR 0020). */
const sendsThingPhoto = (c: Context) => formTo(c, THING_PHOTO_REQUESTS);

/** Whether a request takes files: a message's, or a Thing's photo. */
const takesFiles = (c: Context) => sendsMessageFiles(c) || sendsThingPhoto(c);

/** How long the fake's pretend sign-in takes to finish, when it acts signed out. */
const FAKE_SIGN_IN_MS = 5000;

/**
 * How often code sessions' pull requests are looked at on GitHub (#172), besides as soon as a
 * turn in one ends: often enough to see checks run, well inside GitHub's limits.
 */
const FOLLOW_PULL_REQUESTS_EVERY_MS = 30_000;

/**
 * How often each code workspace's main is looked at for a red build (#355): a build takes about 3
 * minutes, so a failure is re-run within one of it ending.
 */
const WATCH_MAIN_EVERY_MS = 60_000;

/**
 * How often each code workspace's Lead looks at its builders and the build order (#347): as often
 * as pull requests are followed, so a ready one is told soon after its checks pass.
 */
const WATCH_LEADS_EVERY_MS = 30_000;

/**
 * How often a waiting Update looks again at main's build and the sessions mid-turn (#186), so it
 * runs moments after the last of them is clear.
 */
const WATCH_UPDATE_EVERY_MS = 10_000;

/** How often the context folder's hand edits are committed and a failed backup retried. */
const KEEP_UP_EVERY_MS = 10 * 60 * 1000;

/** How often each provider's plan usage is read while no turn ends (#66), so Home's line stays fresh. */
const READ_USAGE_EVERY_MS = 15 * 60 * 1000;

/** Runs a job now and every `everyMs`, never overlapping itself. */
export type Repeat = (everyMs: number, job: () => Promise<void>) => void;

const repeatForever: Repeat = (everyMs, job) => {
  let busy = false;
  const once = async () => {
    if (busy) return;
    busy = true;
    try {
      await job();
    } catch (error) {
      console.error(error);
    } finally {
      busy = false;
    }
  };
  void once();
  // Never keeps the process alive on its own.
  setInterval(() => void once(), everyMs).unref();
};

/**
 * Builds the worker from its settings, or returns a message naming what's wrong with them.
 * The API lives under `/api`; everything else is the web app, on the same origin (ADR 0001).
 * `now` is the clock, passed in so tests can move time.
 */
export const createWorker = (options: {
  env: Environment;
  now?: () => number;
  /** The providers to offer. Tests pass their own; otherwise the settings decide. */
  providers?: readonly Provider[];
  /** Starts an update of the live copy. Tests watch it; otherwise Task Scheduler runs it. */
  startUpdate?: (command: UpdateCommand) => void | Promise<void>;
  /** Runs a job now and every `everyMs`. Tests run it themselves when they want it. */
  repeat?: Repeat;
  /** The house skills' folder: the `@courtyard/skills` package, unless a test gives its own. */
  houseSkills?: string;
  /**
   * GitHub (#99). Tests pass a fake; otherwise it's GitHub itself, through the GitHub App the
   * settings name, or none when they name none.
   */
  github?: GitHubApi;
  /** Sends a notification to a device (#173). Tests pass a fake; otherwise it's web push. */
  sendPush?: SendPush;
  /**
   * Matt Pocock's skills for code workspaces (ADR 0024): `matt.json`'s pin and his release fetched
   * from GitHub, unless a test gives its own; `null` for none at all.
   */
  mattSkills?: { readonly pin?: MattPin; readonly fetch?: FetchMattSkills } | null;
  /** Given the work nobody waits for (see `Background`). Tests keep hold of it; otherwise it just runs. */
  background?: Background;
  /**
   * The owner's Paper files (#308), listed and made for connecting Paper from a code workspace's
   * page. Tests pass a fake; otherwise Paper's own MCP server is asked.
   */
  paperFiles?: PaperFiles;
  /** Takes a preview's screenshots (#183). Tests pass a fake; otherwise Chromium does. */
  screenshot?: Screenshot;
}): Result<Worker, string> => {
  const settings = readSettings(options.env);
  if (!settings.ok) return settings;
  const {
    port,
    contextDir,
    contextRemote,
    dataDir,
    webDir,
    claudeProvider,
    codexProvider,
    fakeProvider,
    fakeSignIn,
    secondFakeProvider,
    liveCopy,
    updateTask,
    githubClientId,
    buildsLock,
    paperCommand,
    previewPorts,
  } = settings.value;
  const now = options.now ?? Date.now;
  const background = options.background ?? (() => {});
  const owner = createOwner({ dataDir, now });
  // Claude first, so a new session starts on its default wherever it's available. Each provider's
  // default (#247) is chosen once its usage limits are known.
  const modelDefaults = createModelDefaults({
    dataDir,
    providers: rememberingLimits(
      options.providers ?? [
        ...(claudeProvider ? [createClaudeProvider()] : []),
        ...(codexProvider ? [createCodexProvider({ dataDir })] : []),
        ...(fakeProvider
          ? [createFakeProvider(fakeSignIn ? { signIn: { finishAfterMs: FAKE_SIGN_IN_MS } } : {})]
          : []),
        ...(secondFakeProvider ? [createFakeProvider({ second: true })] : []),
      ],
      now,
    ),
  });
  const { providers } = modelDefaults;
  const contextFolder = createContextFolder({ contextDir, remote: contextRemote });
  const github = createGitHub({
    api:
      options.github ??
      (githubClientId === null ? null : createGitHubApi({ clientId: githubClientId })),
    dataDir,
    now,
  });
  const houseSkills = options.houseSkills ?? HOUSE_SKILLS_FOLDER;
  const matt =
    options.mattSkills === null
      ? undefined
      : createMattSkills({
          dataDir,
          ...(options.mattSkills?.pin === undefined ? {} : { pin: options.mattSkills.pin }),
          fetch: options.mattSkills?.fetch ?? fetchFromGitHub,
          now,
          background,
        });
  const notifications = createNotifications({
    dataDir,
    send: options.sendPush ?? sendWebPush,
    devicesLoggedIn: owner.devices,
    titleOf: async (id) => {
      const session = await sessions.get(id);
      return session.ok ? session.value.title : undefined;
    },
  });
  const code = createCode({
    dataDir,
    commandEnv: github.commandEnv,
    pullRequests: github,
    buildsLock,
    // Main moved on: the Main row and Update ask afresh rather than reuse what they last had.
    onMerged: () => {
      workspaceMain.forget();
      live.forget();
    },
  });
  const connections = createConnections({
    contextDir,
    contextFolder,
    github,
    code,
    paperFiles: options.paperFiles ?? createPaperFiles(),
    paperCommand,
  });
  const mattSetup = createMattSetup({ dataDir, contextDir, matt, code, github, connections });
  // The wanted list (#245): its picks show in a turn's Things, and a shop blocked finds them again.
  const wanted = createWanted({ contextDir, dataDir, providers, now, background });
  const sessions = createSessions({
    dataDir,
    providers,
    contextDir,
    contextFolder,
    wanted,
    houseSkills,
    matt,
    code,
    connectionsOf: connections.of,
    now,
    notify: (session, event, pullRequest) => {
      background(
        notifications
          .sessionEvent(session, event, pullRequest)
          .catch((error: unknown) => console.error(`Session ${session}: notifying crashed`, error)),
      );
    },
    background,
    // The Lead is made below, from the sessions: its turns ask it once they run (#347).
    lead: {
      brief: (session) => lead.brief(session),
      tool: (session, input) => lead.tool(session, input),
    },
    // While an Update waits, nothing new starts on its own (#186); the live copy is made below.
    holding: () => live.holding(),
    // Next up is made below, from the sessions: it posts their claims on GitHub (#324).
    claims: {
      named: (workspaceId, text) => nextUp.named(workspaceId, text),
      claim: (workspaceId, issue, claim) => nextUp.claim(workspaceId, issue, claim),
      release: (workspaceId, issue, why) => nextUp.release(workspaceId, issue, why),
    },
    // The previews are made below, from the sessions (#183).
    previews: {
      ended: (session, task) => previews.ended(session, task),
      tool: (session, input) => previews.tool(session, input),
    },
    usage: {
      heard: (session, provider, meter) => usage.heard(session, provider, meter),
      turnEnded: (provider) => background(usage.read(provider)),
    },
  });
  // Usage at a glance (#66): each provider's plan usage, read as it starts, every so often and
  // after every turn.
  const usage = createUsage({
    providers,
    dataDir,
    now,
    notify: (session, need) => {
      background(
        need()
          .then((said) => notifications.notice(session, said))
          .catch((error: unknown) => console.error(`Session ${session}: notifying crashed`, error)),
      );
    },
  });
  const previews = createPreviews({
    ports: previewPorts,
    loggedIn: (cookies) => ownerLoggedIn(owner, cookies),
    sessions,
    contextDir,
    contextFolder,
    commandEnv: github.commandEnv,
    ...(options.screenshot === undefined ? {} : { screenshot: options.screenshot }),
  });
  const nextUp = createNextUp({ contextDir, code, github, sessions, now });
  // A code workspace's main and its build, for its Home's Main row (#301, #249) and its Lead.
  const workspaceMain = createWorkspaceMain({ contextDir, code, github, liveCopy, now });
  const lead = createLead({
    contextDir,
    dataDir,
    sessions,
    nextUp,
    mainRed: async (workspaceId) => {
      const main = await workspaceMain.of(workspaceId);
      return main.ok && main.value.build?.kind === "failed";
    },
    // While an Update waits, no builder starts (#186).
    updating: () => live.holding(),
    // What a builder changes, so the Lead holds back an issue that would clash (#423).
    changedFiles: async (workspaceId, session) => {
      const workspace = await getWorkspace(contextDir, workspaceId);
      if (!workspace.ok || workspace.value.repoPath === null) return [];
      return code.changedFiles({
        repoPath: workspace.value.repoPath,
        worktree: code.worktreeOf(session),
      });
    },
    now,
    notify: (session, need) => {
      background(
        notifications
          .notice(session, need)
          .catch((error: unknown) => console.error(`Session ${session}: notifying crashed`, error)),
      );
    },
  });
  const live = createLive({
    liveCopy,
    updateTask,
    dataDir,
    now,
    startUpdate: options.startUpdate ?? runUpdateTask,
    midTurn: sessions.midTurn,
    released: () => {
      sessions
        .releaseHeld()
        .catch((error: unknown) => console.error("Held messages couldn't be sent", error));
    },
    // Main's build (#249), on the repository the live copy's remote is on GitHub.
    buildOf: async (find) => {
      const repo = liveCopy === null ? undefined : await code.onGitHub(liveCopy);
      if (!repo?.ok) return null;
      const build = await github.mainBuild({ repo: repo.value, ...find });
      return build.ok ? (build.value ?? null) : null;
    },
  });
  // Every session is checked as the worker starts (#186): queued messages a stopped worker left
  // waiting go now (#177), and turns it left running are cut off. After an Update the worker
  // started itself, they continue by themselves; after a crash or a restart of the PC, they wait
  // for the owner's Continue, with one notification.
  background(
    (async () => {
      const byUpdate = await live.restartedByUpdate();
      const cutOff = await sessions.recoverAll();
      if (!byUpdate) return notifications.restarted(cutOff);
      for (const session of cutOff) {
        const continued = await sessions.continueLast(session.id);
        if (!continued.ok)
          console.error(`Session ${session.id} couldn't continue`, continued.error);
      }
    })().catch((error: unknown) => console.error("Sessions couldn't be checked", error)),
  );
  const versionBumps = createVersionBumps({ contextDir, dataDir, code, github });
  const repeat = options.repeat ?? repeatForever;
  repeat(KEEP_UP_EVERY_MS, contextFolder.keepUp);
  repeat(KEEP_FRESH_EVERY_MS, github.keepFresh);
  repeat(FOLLOW_PULL_REQUESTS_EVERY_MS, sessions.followPullRequests);
  // A red main is re-run once, then filed first in the order (#355).
  repeat(WATCH_MAIN_EVERY_MS, createRedMain({ contextDir, dataDir, code, github }).watch);
  // Dependabot's bumps are re-run once, then filed for the Lead (#496).
  repeat(WATCH_MAIN_EVERY_MS, versionBumps.watch);
  // Each code workspace's Lead runs its build order (#347).
  repeat(WATCH_LEADS_EVERY_MS, lead.watch);
  // An Update tapped before it could run runs itself once main has passed and sessions are free (#186).
  repeat(WATCH_UPDATE_EVERY_MS, live.watch);
  repeat(READ_USAGE_EVERY_MS, () => usage.read());

  /** A workspace's page's detail: its context file, what of the owner context it reads, and its plans due. */
  const workspaceDetail = async (id: string): Promise<Result<WorkspaceDetail, WorkspaceError>> => {
    const [workspace, ownerContext] = await Promise.all([
      getWorkspace(contextDir, id),
      readOwnerContext(contextDir),
    ]);
    if (!workspace.ok) return workspace;
    if (!ownerContext.ok) return ownerContext;
    const { shared } = sharedOwnerContext({
      mode: workspace.value.summary.mode,
      ownerContext: ownerContext.value,
    });
    const { description, contextFile, summary } = workspace.value;
    // Today on the worker machine's calendar, which is the owner's.
    const today = new Date(now());
    return ok({
      workspace: summary,
      contextFile,
      ...(description === null ? {} : { description }),
      ownerContextShared: shared,
      ...(summary.mode === "planning"
        ? {
            duePlans: plansDue(contextFile?.plans ?? [], {
              year: today.getFullYear(),
              month: today.getMonth(),
              day: today.getDate(),
            }),
          }
        : {}),
    });
  };

  const api = new Hono();
  const tooLarge = (c: Context) => apiError(c, { status: 413, error: "Request too large" });
  const jsonLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
  const filesLimit = bodyLimit({ maxSize: MAX_MESSAGE_WITH_FILES_BYTES, onError: tooLarge });
  const photoLimit = bodyLimit({ maxSize: MAX_THING_PHOTO_BYTES, onError: tooLarge });
  api.use("*", (c, next) =>
    sendsMessageFiles(c)
      ? filesLimit(c, next)
      : sendsThingPhoto(c)
        ? photoLimit(c, next)
        : jsonLimit(c, next),
  );
  api.use("*", sameSiteJsonOnly({ takesFiles }));
  api.use("*", requireLogin(owner));

  api.get("/health", (c) => c.json({ status: "ok" } satisfies Health));
  api.route("/", loginRoutes(owner));
  api.route("/", sessionRoutes({ sessions, providers, contextDir }));
  api.route("/", modelDefaultRoutes(modelDefaults));
  api.route("/", waitingRoutes({ contextDir, sessions }));
  api.route("/", taskRoutes(sessions));
  api.route("/", previewRoutes(previews));
  api.route("/", changeRoutes({ contextDir, contextFolder, sessions }));
  api.route("/", documentRoutes({ contextDir, contextFolder }));
  api.route("/", thingRoutes({ contextDir, contextFolder, now }));
  api.route(
    "/",
    planningHomeRoutes({
      contextDir,
      picks: createHomePicks({ dataDir }),
      lastQuestion: sessions.lastQuestion,
    }),
  );
  api.route("/", wantedRoutes({ wanted, contextDir, contextFolder }));
  const tidying = createTidying({ contextDir, contextFolder, providers, now });
  api.route("/", tidyRoutes({ contextDir, tidying }));
  api.route(
    "/",
    freshStartRoutes(
      createFreshStart({ contextDir, dataDir, contextFolder, sessions, tidying, now }),
    ),
  );
  api.route("/", signInRoutes(createSignIns({ providers, dataDir })));
  api.route("/", gitHubRoutes(github));
  const repos = createRepos({ dataDir, contextDir, github, code });
  api.route("/", repoRoutes(repos));
  const pullRequests = createPullRequests({ contextDir, code, sessions, bumps: versionBumps });
  api.route("/", pullRequestRoutes(pullRequests));
  api.route(
    "/",
    quickQuestionRoutes(createQuickQuestions({ contextDir, providers, pullRequests })),
  );
  api.route("/", connectionRoutes(connections));
  api.route("/", nextUpRoutes(nextUp));
  api.route("/", leadRoutes(lead));
  api.get("/workspaces/:id/main", async (c) => {
    const main = await workspaceMain.of(c.req.param("id"));
    if (main.ok) return c.json(main.value satisfies WorkspaceMain);
    switch (main.error.kind) {
      case "workspace":
        return contextError(c, main.error.error);
      case "not-code":
        return apiError(c, { status: 409, error: "Only a code workspace has a main branch." });
      case "unknown":
        return apiError(c, { status: 404, error: "This workspace's main can't be read now." });
    }
  });
  api.route("/", notificationRoutes(notifications));
  api.route("/", usageRoutes(usage));
  api.route(
    "/",
    offlineCopyRoutes(
      createOfflineCopy({
        contextDir,
        sessions,
        detail: (workspace) => workspaceDetail(workspace.id),
        now,
      }),
    ),
  );

  api.get("/backup", async (c) => c.json((await contextFolder.backup()) satisfies ContextBackup));
  api.get("/live", async (c) => c.json((await live.status()) satisfies LiveStatus));
  api.post("/live/update", async (c) => {
    const body = await readBody(c, LiveUpdateRequest);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const started = await live.update(body.value);
    if (started.ok) return c.json(started.value satisfies LiveUpdateStarted, 202);
    switch (started.error.kind) {
      case "off":
        return apiError(c, { status: 404, error: "Updates from the app are off on this worker." });
      case "running":
        return apiError(c, { status: 409, error: "An update is already running." });
      case "not-started":
        return apiError(c, { status: 500, error: started.error.message });
    }
  });
  // Cancel (#186): the Update waiting no longer waits.
  api.delete("/live/update", async (c) => {
    await live.cancel();
    return c.body(null, 204);
  });

  api.get("/workspaces", async (c) => {
    const workspaces = await listWorkspaces(contextDir);
    if (!workspaces.ok) return contextError(c, workspaces.error);
    return c.json({ workspaces: workspaces.value } satisfies WorkspaceList);
  });
  // The owner's order for the workspaces (#321), from the rail or the sidebar once a tile is let go.
  api.put("/workspaces/order", async (c) => {
    const body = await readBody(c, WorkspaceOrder);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const workspaces = await contextFolder.change(
      () => arrangeWorkspaces(contextDir, body.value.order),
      () => WORKSPACES_ARRANGED,
    );
    if (!workspaces.ok) return contextError(c, workspaces.error);
    return c.json({ workspaces: workspaces.value } satisfies WorkspaceList);
  });
  api.post("/workspaces", async (c) => {
    const body = await readBody(c, NewWorkspace);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const { name, intro, repo } = body.value;
    // A code workspace (#258): its repo comes onto the worker machine first, once its name is
    // known to be free, so a name that can't be used never waits for a clone.
    let repoPath: string | undefined;
    if (repo !== undefined) {
      const free = await checkNewName(contextDir, name);
      if (!free.ok) return contextError(c, free.error);
      const placed = await repos.place(repo);
      if (!placed.ok) return repoProblem(c, placed.error);
      repoPath = placed.value;
    }
    const workspace = await contextFolder.change(
      () =>
        createWorkspace(contextDir, {
          name,
          intro,
          ...(repoPath === undefined ? {} : { repoPath }),
        }),
      (made) => workspaceChange(`New workspace: ${made.name}`, made.id),
    );
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(workspace.value satisfies WorkspaceSummary, 201);
  });
  // New repo (#391): what New workspace → Code needs to offer it, and making one.
  api.get("/github/repos/new", async (c) => {
    const account = await github.account();
    if (!account.ok) return gitHubProblem(c, account.error);
    return c.json({
      account: account.value,
      paper: await connections.canMakeNewPaper(),
    } satisfies NewRepoOffer);
  });
  api.post("/github/repos/new", async (c) => {
    const body = await readBody(c, NewRepo);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const { intro } = body.value;
    const name = workspaceNameFrom(body.value.name);
    // Its workspace's name is known to be free before anything is made on GitHub.
    const free = await checkNewName(contextDir, name);
    if (!free.ok) return contextError(c, free.error);
    const files = await mattSetup.filesForNew({ name, intro });
    if (!files.ok) {
      return apiError(c, {
        status: 409,
        error:
          "Matt Pocock's skills aren't on this worker yet, so a new repo can't start on the house standard. Try again once they've loaded.",
      });
    }
    const made = await repos.create({
      name: body.value.name,
      description: intro,
      private: body.value.private,
      files: files.value,
    });
    if (!made.ok) return repoProblem(c, made.error);
    const started = await mattSetup.startNew({ fullName: made.value.fullName, name, intro });
    if (!started.ok) {
      return apiError(c, {
        status: 502,
        error: `${made.value.fullName} was made, but its first milestone and issue weren't: ${started.error} Pick it from the list to add it.`,
      });
    }
    const workspace = await contextFolder.change(
      () => createWorkspace(contextDir, { name, intro, repoPath: made.value.folder }),
      (summary) => workspaceChange(`New workspace: ${summary.name}`, summary.id),
    );
    if (!workspace.ok) return contextError(c, workspace.error);
    const paper: SetupPaper =
      body.value.paper && (await connections.canMakeNewPaper())
        ? await makePaperFile(connections, workspace.value.id, name)
        : { kind: "skipped" };
    return c.json({ workspace: workspace.value, paper } satisfies NewRepoMade, 201);
  });
  api.patch("/workspaces/:id", async (c) => {
    const body = await readBody(c, WorkspaceChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const workspace = await contextFolder.change(
      () => changeWorkspace(contextDir, { id: c.req.param("id"), ...body.value }),
      (made) => workspaceChange(`Change the workspace ${made.name}`, made.id),
    );
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(workspace.value satisfies WorkspaceSummary);
  });
  api.post("/workspaces/:id/archive", async (c) => {
    const id = WorkspaceId.safeParse(c.req.param("id"));
    if (!id.success) return contextError(c, { kind: "not-found" });
    // Its folder can't move while a model is working in it.
    const running = await sessions.anyRunning(id.data);
    if (!running.ok) return apiError(c, { status: 500, error: "Its sessions can't be read." });
    if (running.value) {
      return apiError(c, {
        status: 409,
        error:
          "A turn is running in one of this workspace's sessions. Stop it first, then archive the workspace.",
      });
    }
    const archived = await contextFolder.change(
      () => archiveWorkspace(contextDir, id.data),
      () => workspaceChange(`Archive the workspace ${id.data}`, id.data),
    );
    if (!archived.ok) return contextError(c, archived.error);
    return c.body(null, 204);
  });
  api.get("/workspaces/:id", async (c) => {
    const detail = await workspaceDetail(c.req.param("id"));
    if (!detail.ok) return contextError(c, detail.error);
    return c.json(detail.value satisfies WorkspaceDetail);
  });
  api.get("/workspaces/:id/skills", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    const skills = await workspaceSkills({
      contextDir,
      houseFolder: houseSkills,
      workspace: workspace.value,
      matt,
    });
    return c.json({ skills: skillList(skills) } satisfies SkillList);
  });
  // A code workspace's Allowed commands (#185): what its owner allowed always, each to Remove.
  api.get("/workspaces/:id/allowed-commands", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(allowedCommandsOf(workspace.value) satisfies AllowedCommands);
  });
  api.post("/workspaces/:id/allowed-commands/remove", async (c) => {
    const body = await readBody(c, AllowedCommandRemoval);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const command = namedAs(body.value.allows);
    const removed = await contextFolder.change(
      () => removeAllowed(contextDir, { id: c.req.param("id"), command }),
      (made) => workspaceChange(`Stop allowing always: ${command}`, made.summary.id),
    );
    if (!removed.ok) return contextError(c, removed.error);
    return c.json(allowedCommandsOf(removed.value) satisfies AllowedCommands);
  });
  api.get("/workspaces/:id/matt-setup", async (c) => {
    const id = WorkspaceId.safeParse(c.req.param("id"));
    if (!id.success) return contextError(c, { kind: "not-found" });
    return c.json((await mattSetup.offer(id.data)) satisfies MattSetup);
  });
  api.post("/workspaces/:id/matt-setup", async (c) => {
    const id = WorkspaceId.safeParse(c.req.param("id"));
    if (!id.success) return contextError(c, { kind: "not-found" });
    const body = await readBody(c, MattSetupAnswer);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const answered = await mattSetup.answer(id.data, body.value);
    if (answered.ok) return c.json(answered.value satisfies MattSetup);
    return answered.error.kind === "not-found"
      ? apiError(c, {
          status: 404,
          error: "There's nothing to set up in this workspace's repository.",
        })
      : apiError(c, {
          status: 502,
          error: `Matt's setup couldn't be added: ${answered.error.reason}`,
        });
  });
  api.get("/owner-context", async (c) => {
    const read = await readOwnerContext(contextDir);
    if (!read.ok) return contextError(c, read.error);
    return c.json({ ownerContext: read.value?.ownerContext ?? null } satisfies OwnerContextDetail);
  });
  api.post("/owner-context", async (c) => {
    const started = await contextFolder.change(
      () => startOwnerContext(contextDir),
      () => ({
        kind: "owner-context",
        title: "Start the owner context",
        places: [{ kind: "owner-context" }],
      }),
    );
    if (!started.ok) return contextError(c, started.error);
    return c.json({ ownerContext: started.value.ownerContext } satisfies OwnerContextDetail, 201);
  });
  api.all("*", (c) => apiError(c, { status: 404, error: "Not found" }));

  const app = new Hono();
  app.route("/api", api);

  // Without a build (while developing with `pnpm dev`), Vite serves the page instead.
  if (existsSync(webDir)) {
    app.use("*", serveStatic({ root: webDir }));
    // Any other path is one of the web app's own routes, so a reload lands on the app.
    app.get("*", serveStatic({ path: join(webDir, "index.html") }));
  } else {
    app.get("*", (c) =>
      c.text("The web app isn't built. Run `pnpm build`, or use `pnpm dev` while developing.", 404),
    );
  }

  return ok({ app, port });
};
