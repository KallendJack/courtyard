import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  type Capabilities,
  Effort,
  type EffortInfo,
  type FailureReason,
  ModelId,
  ProviderId,
  type ProviderStatus,
} from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../result.ts";
import type { Provider } from "./index.ts";

const id = ProviderId.parse("codex");
/**
 * Until Courtyard's own tools reach Codex (ticket 30), a Codex turn answers from the context file
 * and the conversation alone.
 */
const CAPABILITIES: Capabilities = {
  readsFiles: false,
  codes: false,
  usesTools: false,
  savesContext: false,
};
const LABEL = "Codex";

/** How Codex's app-server is started: its arguments, its environment, and where its output goes. */
export type AppServerLaunch = {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Each line it writes: one JSON-RPC message. */
  readonly onLine: (line: string) => void;
  /** Called once when it ends, for any reason. */
  readonly onExit: () => void;
};

/** A running app-server: lines go in, and it can be stopped. */
export type AppServerProcess = {
  readonly send: (line: string) => void;
  readonly stop: () => void;
};

/** Starts Codex's app-server, or says the program isn't there. Tests stand in for it. */
export type StartAppServer = (launch: AppServerLaunch) => Result<AppServerProcess, "missing">;

/**
 * Codex's settings, every time it starts (ADR 0015): nothing of the machine's own Codex setup, and
 * nothing that reaches outside the workspace or does Courtyard's job. Its own Codex home holds only
 * Courtyard's sign-in, so these are all there is.
 */
const SETTINGS: Readonly<Record<string, string>> = {
  // A second layer behind the shell being off: read-only, no network, and nothing that would ask.
  sandbox_mode: '"read-only"',
  approval_policy: '"never"',
  shell_environment_policy: '{ inherit = "none" }',
  // AGENTS.md files, skills, memories, connectors and sub-agents.
  project_doc_max_bytes: "0",
  "skills.bundled.enabled": "false",
  "skills.include_instructions": "false",
  "memories.use_memories": "false",
  "memories.generate_memories": "false",
  "apps._default.enabled": "false",
  "agents.enabled": "false",
  web_search: '"disabled"',
  // Nothing kept or sent about the session: the session's event log is the only copy.
  "history.persistence": '"none"',
  "analytics.enabled": "false",
  "feedback.enabled": "false",
  check_for_update_on_startup: "false",
};

/**
 * Codex's features that are switched off, from `codex features list` for the pinned version.
 * Re-check the list against it before changing that version (ADR 0015).
 */
const FEATURES_OFF = [
  // Its shell, and the code mode that runs code.
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  // Connectors, plugins, skills and memories.
  "apps",
  "plugins",
  "remote_plugin",
  "plugin_sharing",
  "skill_search",
  "skill_mcp_dependency_install",
  "tool_suggest",
  "memories",
  "hooks",
  // Browser and computer use, images, and sub-agents.
  "browser_use",
  "browser_use_external",
  "in_app_browser",
  "computer_use",
  "image_generation",
  "view_image",
  "multi_agent",
  // Codex's own workflow extras.
  "goals",
  "worktrees",
  "realtime_conversation",
  "sleep_tool",
];

const appServerArgs = (): string[] => [
  "app-server",
  // A setting this Codex doesn't know stops it starting, rather than being quietly ignored.
  "--strict-config",
  ...Object.entries(SETTINGS).flatMap(([key, value]) => ["-c", `${key}=${value}`]),
  ...FEATURES_OFF.flatMap((feature) => ["--disable", feature]),
];

/**
 * The environment Codex runs with: the worker's own, pointed at Courtyard's Codex home, and
 * without Courtyard's settings or anything that would change which Codex setup or account it uses.
 */
const isolatedEnv = (codexHome: string): Record<string, string | undefined> => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(COURTYARD_|CODEX_|OPENAI_)/i.test(key)),
  ),
  CODEX_HOME: codexHome,
});

/** Codex as it really is: the pinned `@openai/codex` package's program. */
const realStartAppServer: StartAppServer = (launch) => {
  let program: string;
  try {
    program = fileURLToPath(import.meta.resolve("@openai/codex/bin/codex.js"));
  } catch {
    return err("missing");
  }
  if (!existsSync(program)) return err("missing");

  const child = spawn(process.execPath, [program, ...launch.args], {
    env: launch.env,
    // Codex keeps its own log in its home; nothing it says reaches the worker's log.
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    launch.onExit();
  };
  child.on("error", end);
  child.on("exit", end);
  // Writing after it has ended fails; the exit above has already said so.
  child.stdin.on("error", () => {});
  createInterface({ input: child.stdout }).on("line", launch.onLine);
  return ok({
    send: (line) => {
      if (!ended) child.stdin.write(`${line}\n`);
    },
    stop: () => {
      // Its input closing is how it knows to finish; the kill is in case it doesn't.
      child.stdin.end();
      child.kill();
    },
  });
};

/** What Codex can send: an answer to a request, a request of its own, or a notice (JSON-RPC's notification). */
const Answer = z.union([
  z.object({ id: z.number(), result: z.unknown() }),
  z.object({ id: z.number(), error: z.object({ message: z.string() }) }),
]);
const CodexRequest = z.object({ id: z.union([z.number(), z.string()]), method: z.string() });
const CodexNotice = z.object({ method: z.string(), params: z.unknown() });
/** A notice about one thread names it. */
const AboutThread = z.object({ threadId: z.string() });

/** Why a request to Codex got no answer. */
type RequestFailure =
  /** The app-server ended before answering. */
  | { kind: "ended" }
  | { kind: "timed-out" }
  /** Codex answered with an error, in its own words (never shown as they are). */
  | { kind: "refused"; message: string };

type Connection = {
  readonly request: (method: string, params: unknown) => Promise<Result<unknown, RequestFailure>>;
  /**
   * Hears every notice about one thread, and the app-server ending, until the returned
   * function is called.
   */
  readonly listen: (threadId: string, listener: ThreadListener) => () => void;
  /** Settles when the app-server ends. */
  readonly ended: Promise<void>;
};

type ThreadListener = {
  readonly heard: (notice: z.infer<typeof CodexNotice>) => void;
  readonly ended: () => void;
};

type StartFailure = "missing" | "not-started";

/** How long Codex has to answer a request before it counts as not answering. */
const REQUEST_TIMEOUT_MS = 15_000;
/** How long a status answer is reused, so listing providers doesn't ask Codex each time. */
const STATUS_TTL_MS = 60_000;
/** The longest a stopped turn waits for Codex to finish before moving on. */
const WIND_DOWN_MS = 2000;

/**
 * Starts Codex's app-server and connects to it: one JSON-RPC message per line in each direction
 * (ADR 0015). Anything Codex asks of the worker is refused, since nothing it could ask for (an
 * approval, the owner's input) is allowed here.
 */
const connect = async (options: {
  startAppServer: StartAppServer;
  codexHome: string;
  requestTimeoutMs: number;
}): Promise<Result<Connection, StartFailure>> => {
  const pending = new Map<number, (answer: Result<unknown, RequestFailure>) => void>();
  const listeners = new Map<string, ThreadListener>();
  let nextId = 1;
  let markEnded = () => {};
  const ended = new Promise<void>((resolve) => {
    markEnded = resolve;
  });
  let alive = true;

  const onLine = (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const answer = Answer.safeParse(message);
    if (answer.success) {
      const settle = pending.get(answer.data.id);
      pending.delete(answer.data.id);
      settle?.(
        "result" in answer.data
          ? ok(answer.data.result)
          : err({ kind: "refused", message: answer.data.error.message }),
      );
      return;
    }
    const asked = CodexRequest.safeParse(message);
    if (asked.success) {
      send({
        id: asked.data.id,
        error: { code: -32601, message: "Courtyard doesn't allow that here." },
      });
      return;
    }
    const notice = CodexNotice.safeParse(message);
    if (!notice.success) return;
    const about = AboutThread.safeParse(notice.data.params);
    if (about.success) listeners.get(about.data.threadId)?.heard(notice.data);
  };

  const send = (message: unknown) => {
    if (appServer.ok) appServer.value.send(JSON.stringify(message));
  };

  const onExit = () => {
    alive = false;
    for (const settle of pending.values()) settle(err({ kind: "ended" }));
    pending.clear();
    for (const listener of listeners.values()) listener.ended();
    markEnded();
  };

  const appServer = options.startAppServer({
    args: appServerArgs(),
    env: isolatedEnv(options.codexHome),
    onLine,
    onExit,
  });
  if (!appServer.ok) return appServer;

  const request = (method: string, params: unknown) =>
    new Promise<Result<unknown, RequestFailure>>((resolve) => {
      if (!alive) return resolve(err({ kind: "ended" }));
      const requestId = nextId++;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(err({ kind: "timed-out" }));
      }, options.requestTimeoutMs);
      pending.set(requestId, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      send({ id: requestId, method, params });
    });

  const started = await request("initialize", {
    clientInfo: { name: "courtyard", title: "Courtyard", version: "0.0.0" },
    // The fields Courtyard uses (a thread's base instructions, an ephemeral thread) are marked
    // experimental.
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  if (!started.ok) {
    appServer.value.stop();
    return err("not-started");
  }
  send({ method: "initialized" });

  return ok({
    request,
    listen: (threadId, listener) => {
      listeners.set(threadId, listener);
      return () => listeners.delete(threadId);
    },
    ended,
  });
};

/** A level of effort Courtyard offers, least first. Codex's "ultra" hands work to sub-agents, which are off. */
const CodexEffort = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
/** Each of Codex's levels of effort in Codex's own words. */
const EFFORT_LABELS: Record<z.infer<typeof CodexEffort>, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const CodexModel = z.object({
  id: z.string(),
  displayName: z.string(),
  hidden: z.boolean().catch(false),
  /** Unparsed: a level Courtyard doesn't know yet is left out rather than fail the check. */
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).catch([]),
  defaultReasoningEffort: z.string().nullable().catch(null),
});
const ModelPage = z.object({ data: z.array(CodexModel), nextCursor: z.string().nullable() });

const AccountAnswer = z.object({ account: z.object({ type: z.string() }).nullable() });

/** The levels of effort a model takes, the ones Courtyard knows, in Codex's order. */
const effortsOf = (model: z.infer<typeof CodexModel>): EffortInfo[] => {
  const levels = new Set(model.supportedReasoningEfforts.map((level) => level.reasoningEffort));
  return CodexEffort.options
    .filter((level) => levels.has(level))
    .map((level) => ({ id: Effort.parse(level), label: EFFORT_LABELS[level] }));
};

const SIGNED_OUT =
  "Codex isn't signed in. Sign in on the worker machine with Courtyard's own Codex home (see the README).";
const NEEDS_UPDATING = "Codex needs updating.";
/** Why Codex can't be reached, in plain words. */
const START_FAILURES: Record<StartFailure, string> = {
  missing: "Codex isn't installed on the worker machine. Run `pnpm install` in Courtyard's folder.",
  "not-started": "Codex couldn't start on the worker machine, or didn't answer.",
};
const NOT_UNDERSTOOD = "Codex answered in a way Courtyard doesn't understand.";

/**
 * OpenAI's servers turn away a Codex too old for them, saying it should be updated. That's the
 * only sign there is, so the words are what's checked: an update or upgrade of Codex or its
 * version, or a version that's no longer supported.
 */
const TOO_OLD =
  /\b(update|upgrade)\b[^.]*\b(codex|version)\b|\bversion\b[^.]*\bno longer supported\b/i;
const tooOld = (failure: RequestFailure) =>
  failure.kind === "refused" && TOO_OLD.test(failure.message);

const ThreadStarted = z.object({ thread: z.object({ id: z.string() }) });
const TurnStarted = z.object({ turn: z.object({ id: z.string() }) });
const TextDelta = z.object({
  method: z.literal("item/agentMessage/delta"),
  params: z.object({ delta: z.string() }),
});
/** The ways a turn fails that Courtyard tells apart; anything else counts as "other". */
const CodexErrorCode = z
  .enum([
    "usageLimitExceeded",
    "unauthorized",
    "serverOverloaded",
    "rateLimitExceeded",
    "contextWindowExceeded",
    "other",
  ])
  .catch("other");
const TurnCompleted = z.object({
  method: z.literal("turn/completed"),
  params: z.object({
    turn: z.object({
      /** A status Courtyard doesn't know counts as a failure. */
      status: z.enum(["completed", "interrupted", "failed"]).catch("failed"),
      error: z
        .object({ message: z.string().catch(""), codexErrorInfo: CodexErrorCode })
        .nullable()
        .catch(null),
    }),
  }),
});
type TurnError = NonNullable<z.infer<typeof TurnCompleted>["params"]["turn"]["error"]>;

/** How a turn ended, as far as the adapter is concerned. */
type TurnEnd =
  | { kind: "completed" }
  | { kind: "failed"; error: TurnError | null }
  | { kind: "stopped" }
  | { kind: "crashed" };

const LimitWindow = z.object({ usedPercent: z.number(), resetsAt: z.number().nullable() });
const LimitSnapshot = z.object({
  primary: LimitWindow.nullable().catch(null),
  secondary: LimitWindow.nullable().catch(null),
});
const RateLimits = z.object({
  rateLimits: LimitSnapshot.nullable().catch(null),
  rateLimitsByLimitId: z.record(z.string(), LimitSnapshot).nullable().catch(null),
});

/**
 * When the usage limit Codex reached resets: the latest reset among the windows that are used up,
 * since all of them have to reset before Codex answers again. `undefined` when none is.
 */
const resetTimeFrom = (answer: unknown): string | undefined => {
  const limits = RateLimits.safeParse(answer);
  if (!limits.success) return undefined;
  const snapshots = [
    limits.data.rateLimits,
    ...Object.values(limits.data.rateLimitsByLimitId ?? {}),
  ];
  const resets = snapshots
    .flatMap((snapshot) => [snapshot?.primary, snapshot?.secondary])
    .flatMap((window) =>
      window && window.usedPercent >= 100 && window.resetsAt !== null ? [window.resetsAt] : [],
    );
  return resets.length === 0 ? undefined : new Date(Math.max(...resets) * 1000).toISOString();
};

/** A failure Courtyard explains in its own words. */
type ExplainedFailure = Extract<FailureReason, { message: string }>;

const CRASHED: ExplainedFailure = {
  kind: "provider-unavailable",
  message: "Codex stopped unexpectedly.",
};

/** A failed request to Codex, in plain words, for a turn or for Codex's status. */
const failureForRequest = (failure: RequestFailure): ExplainedFailure => {
  if (tooOld(failure)) return { kind: "provider-unavailable", message: NEEDS_UPDATING };
  switch (failure.kind) {
    case "ended":
      return CRASHED;
    case "timed-out":
      return { kind: "provider-unavailable", message: START_FAILURES["not-started"] };
    case "refused":
      return { kind: "unknown", message: "Codex couldn't answer this time." };
  }
};

/** Plain words for each way Codex reports a failed turn: Codex's own words are never passed on. */
const failureForTurn = (error: TurnError | null): ExplainedFailure => {
  switch (error?.codexErrorInfo) {
    case "unauthorized":
      return { kind: "provider-unavailable", message: SIGNED_OUT };
    case "serverOverloaded":
    case "rateLimitExceeded":
      return { kind: "unknown", message: "Codex is busy right now. Try again in a moment." };
    case "contextWindowExceeded":
      return {
        kind: "unknown",
        message: "This session is too long for Codex. Start a new session to carry on.",
      };
    default:
      return failureForRequest({ kind: "refused", message: error?.message ?? "" });
  }
};

/**
 * Codex through its app-server and Courtyard's own Codex home, on the owner's ChatGPT plan
 * (ADR 0015). Nothing outside this file knows how Codex is signed in or billed, and Courtyard
 * never reads, stores or logs the sign-in.
 */
export const createCodexProvider = (options: {
  /** The worker's data folder: Courtyard's Codex home is the `codex` folder in it. */
  dataDir: string;
  startAppServer?: StartAppServer;
  now?: () => number;
  requestTimeoutMs?: number;
}): Provider => {
  const startAppServer = options.startAppServer ?? realStartAppServer;
  const codexHome = join(options.dataDir, "codex");
  const now = options.now ?? Date.now;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  /** The app-server, started the first time Codex is needed and again after it ends. */
  let current: Promise<Result<Connection, StartFailure>> | undefined;
  const connection = () => {
    if (current === undefined) {
      const starting = connect({ startAppServer, codexHome, requestTimeoutMs });
      current = starting;
      void starting.then((started) => {
        const forget = () => {
          if (current === starting) current = undefined;
        };
        if (started.ok) void started.value.ended.then(forget);
        else forget();
      });
    }
    return current;
  };

  let cached: { at: number; status: ProviderStatus } | undefined;
  let checking: Promise<ProviderStatus> | undefined;

  const checkStatus = async (): Promise<ProviderStatus> => {
    const unavailable = (reason: string): ProviderStatus => ({
      id,
      label: LABEL,
      available: false,
      reason,
    });
    const started = await connection();
    if (!started.ok) return unavailable(START_FAILURES[started.error]);
    const codex = started.value;
    const failedWith = (failure: RequestFailure) => unavailable(failureForRequest(failure).message);

    const account = await codex.request("account/read", { refreshToken: false });
    if (!account.ok) return failedWith(account.error);
    const parsedAccount = AccountAnswer.safeParse(account.value);
    if (!parsedAccount.success) return unavailable(NOT_UNDERSTOOD);
    if (parsedAccount.data.account === null) return unavailable(SIGNED_OUT);

    const models: z.infer<typeof CodexModel>[] = [];
    let cursor: string | null = null;
    do {
      const page = await codex.request("model/list", { cursor, includeHidden: false });
      if (!page.ok) return failedWith(page.error);
      const parsed = ModelPage.safeParse(page.value);
      if (!parsed.success) return unavailable(NOT_UNDERSTOOD);
      models.push(...parsed.data.data);
      cursor = parsed.data.nextCursor;
    } while (cursor !== null);

    return {
      id,
      label: LABEL,
      available: true,
      models: models
        .filter((model) => !model.hidden)
        .map((model) => {
          const efforts = effortsOf(model);
          const defaultEffort = efforts.find((level) => level.id === model.defaultReasoningEffort);
          return {
            id: ModelId.parse(model.id),
            label: `${LABEL} · ${model.displayName}`,
            efforts,
            ...(defaultEffort ? { defaultEffort: defaultEffort.id } : {}),
          };
        }),
      capabilities: CAPABILITIES,
    };
  };

  return {
    id,
    capabilities: CAPABILITIES,

    status: async () => {
      if (cached && now() - cached.at < STATUS_TTL_MS) return cached.status;
      checking ??= checkStatus().finally(() => {
        checking = undefined;
      });
      const status = await checking;
      cached = { at: now(), status };
      return status;
    },

    runTurn: async (input) => {
      if (input.signal.aborted) return ok(null);
      const started = await connection();
      if (!started.ok) {
        return err({ kind: "provider-unavailable", message: START_FAILURES[started.error] });
      }
      const codex = started.value;

      // A fresh, unsaved thread each turn: the session's event log is the only copy (ADR 0015).
      const thread = await codex.request("thread/start", {
        model: input.model,
        cwd: resolve(input.folder),
        ephemeral: true,
        baseInstructions: input.framing.instructions,
        sandbox: "read-only",
        approvalPolicy: "never",
        environments: [],
      });
      if (!thread.ok) return err(failureForRequest(thread.error));
      const startedThread = ThreadStarted.safeParse(thread.value);
      if (!startedThread.success) return err({ kind: "unknown", message: NOT_UNDERSTOOD });
      const threadId = startedThread.data.thread.id;

      // The answer goes out a piece at a time, in order, however fast Codex sends it.
      let emitting = Promise.resolve();
      let lost = false;
      let settle: (end: TurnEnd) => void = () => {};
      const ended = new Promise<TurnEnd>((resolve) => {
        settle = resolve;
      });
      const stopListening = codex.listen(threadId, {
        heard: (notice) => {
          const text = TextDelta.safeParse(notice);
          if (text.success) {
            const piece = text.data.params.delta;
            emitting = emitting
              .then(() => input.emit(piece))
              .catch(() => {
                lost = true;
              });
            return;
          }
          const completed = TurnCompleted.safeParse(notice);
          if (!completed.success) return;
          const { status, error } = completed.data.params.turn;
          switch (status) {
            case "completed":
              return settle({ kind: "completed" });
            case "interrupted":
              return settle({ kind: "stopped" });
            case "failed":
              return settle({ kind: "failed", error });
          }
        },
        ended: () => settle({ kind: "crashed" }),
      });

      try {
        const turn = await codex.request("turn/start", {
          threadId,
          input: [{ type: "text", text: input.framing.message, text_elements: [] }],
          ...(input.effort === undefined ? {} : { effort: input.effort }),
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          approvalPolicy: "never",
        });
        if (!turn.ok) return err(failureForRequest(turn.error));
        const startedTurn = TurnStarted.safeParse(turn.value);
        if (!startedTurn.success) return err({ kind: "unknown", message: NOT_UNDERSTOOD });
        const turnId = startedTurn.data.turn.id;

        // The owner stopping the turn stops Codex (its own name for that is `turn/interrupt`).
        // Codex says when it has stopped; if it doesn't say so soon, the turn ends anyway, so the
        // session isn't held up.
        const stopTurn = () => {
          void codex.request("turn/interrupt", { threadId, turnId });
          void wait(WIND_DOWN_MS).then(() => settle({ kind: "stopped" }));
        };
        if (input.signal.aborted) stopTurn();
        else input.signal.addEventListener("abort", stopTurn, { once: true });
        const end = await ended;
        input.signal.removeEventListener("abort", stopTurn);
        await emitting;
        if (input.signal.aborted) return ok(null);
        if (lost)
          return err({ kind: "unknown", message: "Courtyard couldn't keep Codex's answer." });
        switch (end.kind) {
          case "completed":
          case "stopped":
            return ok(null);
          case "crashed":
            return err(CRASHED);
          case "failed": {
            if (end.error?.codexErrorInfo !== "usageLimitExceeded") {
              return err(failureForTurn(end.error));
            }
            const limits = await codex.request("account/rateLimits/read", undefined);
            const resetAt = limits.ok ? resetTimeFrom(limits.value) : undefined;
            return err({ kind: "rate-limited", ...(resetAt ? { resetAt } : {}) });
          }
        }
      } finally {
        stopListening();
        // Codex forgets the thread; nothing of it is kept.
        void codex.request("thread/unsubscribe", { threadId });
      }
    },

    answerOnce: async () =>
      err({ kind: "unknown", message: "Codex can't answer one-off questions yet." }),
  };
};
