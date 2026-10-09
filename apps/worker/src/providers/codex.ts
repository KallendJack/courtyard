import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  type Activity,
  type Capabilities,
  Effort,
  type EffortInfo,
  type FailureReason,
  ModelId,
  ProviderId,
  type ProviderStatus,
  type SignInState,
} from "@courtyard/contract";
import { z } from "zod";
import { fileToolReply } from "../prompts/index.ts";
import { err, ok, type Result } from "../result.ts";
import { pageKey, turnSources } from "../sources/index.ts";
import { workspaceFiles } from "../workspace-files/index.ts";
import {
  type CourtyardTool,
  jsonSchemaOf,
  type Provider,
  photosOf,
  type SignIn,
  type ToolReply,
  type TurnInput,
} from "./index.ts";

const id = ProviderId.parse("codex");
/**
 * Codex reads the workspace's files and saves to context, both through Courtyard's own tools
 * (ADR 0015); coding and tool connections come later.
 */
const CAPABILITIES: Capabilities = {
  readsFiles: true,
  codes: false,
  usesTools: false,
  savesContext: true,
  searchesWeb: true,
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
  // Its shell. Its code-mode host stays on: Codex's models call every tool from code run there,
  // which is plain JavaScript with no files, network or shell, and only the thread's tools.
  "shell_tool",
  "unified_exec",
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
const RequestId = z.union([z.number(), z.string()]);
const CodexRequest = z.object({ id: RequestId, method: z.string() });
const CodexNotice = z.object({ method: z.string(), params: z.unknown() });
/** A notice about one thread names it. */
const AboutThread = z.object({ threadId: z.string() });
/** Codex calling one of the tools the worker offered its thread, naming the thread and turn. */
const ToolCallRequest = z.object({
  id: RequestId,
  method: z.literal("item/tool/call"),
  params: z.object({
    threadId: z.string(),
    turnId: z.string(),
    tool: z.string(),
    arguments: z.unknown(),
  }),
});
/** What a call to a tool names: its thread, turn and tool, and the tool's input. */
type ToolCall = z.infer<typeof ToolCallRequest>["params"];

/** What a tool call gives Codex back, in the app-server's words. */
type ToolAnswer = {
  readonly contentItems: readonly (
    | { readonly type: "inputText"; readonly text: string }
    | { readonly type: "inputImage"; readonly imageUrl: string }
  )[];
  readonly success: boolean;
};

/** Codex's answer to anything it asks that isn't allowed, its own name for which is "method not found". */
const REFUSED = { code: -32601, message: "Courtyard doesn't allow that here." };

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
  /** Hears every notice that names no thread, such as one about the sign-in. */
  readonly onOtherNotice: (listener: (notice: z.infer<typeof CodexNotice>) => void) => void;
  /** Settles when the app-server ends. */
  readonly ended: Promise<void>;
};

type ThreadListener = {
  readonly heard: (notice: z.infer<typeof CodexNotice>) => void;
  /** Answers a call to one of the thread's tools, or refuses it with `undefined`. */
  readonly called: (call: ToolCall) => Promise<ToolAnswer | undefined>;
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
 * (ADR 0015). A call to a thread's tools goes to whoever is listening to that thread; anything
 * else Codex asks of the worker is refused, since nothing else it could ask for (an approval, the
 * owner's input) is allowed here.
 */
const connect = async (options: {
  startAppServer: StartAppServer;
  codexHome: string;
  requestTimeoutMs: number;
}): Promise<Result<Connection, StartFailure>> => {
  const pending = new Map<number, (answer: Result<unknown, RequestFailure>) => void>();
  const listeners = new Map<string, ThreadListener>();
  const otherListeners: ((notice: z.infer<typeof CodexNotice>) => void)[] = [];
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
    const call = ToolCallRequest.safeParse(message);
    if (call.success) {
      const { id, params } = call.data;
      const listener = listeners.get(params.threadId);
      void (listener?.called(params) ?? Promise.resolve(undefined))
        .catch((error: unknown) => {
          // A tool throwing is a bug: only the kind of error goes to the worker's log, and Codex
          // is refused.
          console.error(
            "A tool for Codex threw:",
            error instanceof Error ? error.name : typeof error,
          );
          return undefined;
        })
        .then((result) => send(result === undefined ? { id, error: REFUSED } : { id, result }));
      return;
    }
    const asked = CodexRequest.safeParse(message);
    if (asked.success) {
      send({ id: asked.data.id, error: REFUSED });
      return;
    }
    const notice = CodexNotice.safeParse(message);
    if (!notice.success) return;
    const about = AboutThread.safeParse(notice.data.params);
    if (about.success) listeners.get(about.data.threadId)?.heard(notice.data);
    else for (const listener of otherListeners) listener(notice.data);
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
    onOtherNotice: (listener) => {
      otherListeners.push(listener);
    },
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

/** Who is signed in to Courtyard's Codex home, if anyone. Nothing else of the sign-in is read. */
const AccountAnswer = z.object({
  account: z
    .object({
      type: z.string(),
      email: z.string().nullable().catch(null).default(null),
      planType: z.string().nullable().catch(null).default(null),
    })
    .nullable(),
});

/** A device-code sign-in Codex has started: where to go, and the code to enter there. */
const LoginStarted = z.object({
  type: z.literal("chatgptDeviceCode"),
  loginId: z.string(),
  verificationUrl: z.url({ protocol: /^https$/ }),
  userCode: z.string().min(1).max(32),
});
const LoginCompleted = z.object({
  method: z.literal("account/login/completed"),
  params: z.object({
    loginId: z.string().nullable(),
    success: z.boolean(),
    error: z.string().nullable().catch(null),
  }),
});
/** How long Codex's device codes work for. */
const DEVICE_CODE_MS = 15 * 60_000;
/** Codex's words for a code that ran out; anything else that didn't finish counts as failed. */
const EXPIRED = /expire|timed? ?out/i;

/** Where the sign-in Courtyard started stands, while it isn't simply signed in or out. */
type Login =
  | { readonly kind: "none" }
  | {
      readonly kind: "waiting";
      readonly loginId: string;
      readonly link: string;
      readonly code: string;
      readonly expiresAt: number;
    }
  | { readonly kind: "not-finished"; readonly why: "expired" | "failed" };

/** The levels of effort a model takes, the ones Courtyard knows, in Codex's order. */
const effortsOf = (model: z.infer<typeof CodexModel>): EffortInfo[] => {
  const levels = new Set(model.supportedReasoningEfforts.map((level) => level.reasoningEffort));
  return CodexEffort.options
    .filter((level) => levels.has(level))
    .map((level) => ({ id: Effort.parse(level), label: EFFORT_LABELS[level] }));
};

const SIGNED_OUT = "Codex isn't signed in. Sign in to Codex on the home page.";
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
/**
 * A message Codex finished in a turn. With an answer's shape asked for, the answer is the last one
 * that isn't commentary on the way (a phase Codex doesn't always give).
 */
const MessageCompleted = z.object({
  method: z.literal("item/completed"),
  params: z.object({
    item: z.object({
      type: z.literal("agentMessage"),
      text: z.string(),
      phase: z.string().nullish().catch(null),
    }),
  }),
});
/**
 * A web search Codex finished (ADR 0019): a search, with what it searched for, or a page it opened.
 * Looking inside a page it already opened, and anything new, counts as neither.
 */
const WebSearchCompleted = z.object({
  method: z.literal("item/completed"),
  params: z.object({
    item: z.object({
      type: z.literal("webSearch"),
      query: z.string().catch(""),
      action: z
        .object({
          type: z.string(),
          query: z.string().nullable().optional().catch(null),
          url: z.string().nullable().optional().catch(null),
        })
        .nullable()
        .catch(null),
    }),
  }),
});

/** What a finished web search shows the owner, if anything. */
const webActivity = (notice: unknown): Activity | undefined => {
  const parsed = WebSearchCompleted.safeParse(notice);
  if (!parsed.success) return undefined;
  const { query, action } = parsed.data.params.item;
  if (action?.type === "openPage") {
    const url = pageKey(action.url ?? "");
    return url === undefined ? undefined : { kind: "page-read", url };
  }
  // Looking for words in a page already open (`findInPage`), or anything new, isn't a search.
  if (action !== null && action.type !== "search") return undefined;
  const searched = (action?.query ?? query).trim();
  return searched === "" ? undefined : { kind: "web-searched", query: searched };
};

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

/** One of Courtyard's tools on a turn: as it's offered, and what answers a call to it. */
type TurnTool = {
  readonly tool: CourtyardTool;
  readonly answer: (args: unknown) => Promise<ToolAnswer>;
};

/** A tool's reply, worded by the prompts module, as Codex takes it. */
const fromToolReply = (reply: ToolReply): ToolAnswer => ({
  success: reply.ok,
  contentItems: reply.content.map((content) =>
    content.kind === "text"
      ? { type: "inputText", text: content.text }
      : { type: "inputImage", imageUrl: content.dataUrl },
  ),
});

/**
 * The tools a turn's framing offers, by name: Courtyard's file tools, confined to the workspace
 * folder, and Courtyard's other tools (the save tool, use skill…), each call's input going to the
 * worker as Codex sent it (ADRs 0013, 0016).
 */
const toolsFor = (input: TurnInput): ReadonlyMap<string, TurnTool> => {
  const tools: TurnTool[] = [];
  const { fileTools } = input.framing;
  if (fileTools !== null) {
    const files = workspaceFiles({ folder: input.folder, report: input.report });
    for (const kind of ["list", "read", "search"] as const) {
      tools.push({
        tool: fileTools[kind],
        answer: async (args) => fromToolReply(fileToolReply(await files[kind](args))),
      });
    }
  }
  for (const tool of input.framing.tools) {
    tools.push({
      tool,
      answer: async (args) => fromToolReply(await input.callTool({ name: tool.name, input: args })),
    });
  }
  return new Map(tools.map((turnTool) => [turnTool.tool.name, turnTool]));
};

/** A tool as the app-server offers it to a thread (its dynamic tools), its inputs as JSON Schema. */
const asDynamicTool = ({ tool }: TurnTool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  inputSchema: jsonSchemaOf(z.object(tool.input)),
});

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
 * A failed turn as a failure: a usage limit with when it resets, which Codex is asked for, and
 * anything else in plain words.
 */
const failedTurn = async (codex: Connection, error: TurnError | null): Promise<FailureReason> => {
  if (error?.codexErrorInfo !== "usageLimitExceeded") return failureForTurn(error);
  const limits = await codex.request("account/rateLimits/read", undefined);
  const resetAt = limits.ok ? resetTimeFrom(limits.value) : undefined;
  return { kind: "rate-limited", ...(resetAt ? { resetAt } : {}) };
};

/** One turn on a thread of its own, as a session's turn or a one-off question needs it. */
type ThreadTurn = {
  readonly model: ModelId;
  readonly effort: Effort | undefined;
  /** Where Codex is: a turn's workspace folder, or nowhere in particular. */
  readonly cwd: string;
  readonly instructions: string;
  readonly message: string;
  /** The photos that go with the message, as files Codex reads itself (#78). */
  readonly photos?: readonly { readonly path: string }[];
  /** Courtyard's tools, the only ones the thread is given. */
  readonly tools: ReadonlyMap<string, TurnTool>;
  /** Whether the thread searches the web, on cached mode only (ADR 0019). */
  readonly searchesWeb: boolean;
  /** The shape the answer must have, as JSON Schema, for a one-off question. */
  readonly outputSchema?: unknown;
  /** Hears each of the turn's notices but its end. */
  readonly heard: (notice: z.infer<typeof CodexNotice>) => void;
  /** Aborted when the turn is to stop: Codex is told, and the turn ends soon either way. */
  readonly signal: AbortSignal;
};

/** The skills Codex finds itself for some folders (`skills/list`), by name. */
const SkillsListed = z.object({
  data: z.array(z.object({ skills: z.array(z.object({ name: z.string() })) })),
});

/**
 * Every skill Codex would load itself in `cwd`, each turned off, for a thread's own settings. Codex
 * finds skills in a folder's `.agents/skills` and those of the folders above it up to a repo's
 * top: the owner's skills in the context folder, which Courtyard loads itself (ADR 0016). Codex has
 * no setting that stops it looking (docs/real-codex-check.md), so each one it finds is switched off
 * by name. When Codex can't say, the turn doesn't start.
 */
const codexSkillsOff = async (
  codex: Connection,
  cwd: string,
): Promise<Result<{ name: string; enabled: false }[], ExplainedFailure>> => {
  const listed = await codex.request("skills/list", { cwds: [cwd], forceReload: true });
  if (!listed.ok) return err(failureForRequest(listed.error));
  const parsed = SkillsListed.safeParse(listed.value);
  if (!parsed.success) return err({ kind: "unknown", message: NOT_UNDERSTOOD });
  const names = new Set(parsed.data.data.flatMap((found) => found.skills.map(({ name }) => name)));
  return ok([...names].map((name) => ({ name, enabled: false as const })));
};

/**
 * Runs one turn on a fresh, unsaved thread, which Codex forgets afterwards (ADR 0015): how the
 * turn ended, or why it didn't start.
 */
const turnOnThread = async (
  codex: Connection,
  turn: ThreadTurn,
): Promise<Result<TurnEnd, ExplainedFailure>> => {
  const skillsOff = await codexSkillsOff(codex, turn.cwd);
  if (!skillsOff.ok) return skillsOff;
  const thread = await codex.request("thread/start", {
    model: turn.model,
    cwd: turn.cwd,
    ephemeral: true,
    baseInstructions: turn.instructions,
    sandbox: "read-only",
    approvalPolicy: "never",
    environments: [],
    dynamicTools: [...turn.tools.values()].map(asDynamicTool),
    config: {
      "skills.config": skillsOff.value,
      // Results from OpenAI's index, never live: Courtyard can't limit what Codex opens.
      ...(turn.searchesWeb ? { web_search: "cached" } : {}),
    },
  });
  if (!thread.ok) return err(failureForRequest(thread.error));
  const startedThread = ThreadStarted.safeParse(thread.value);
  if (!startedThread.success) return err({ kind: "unknown", message: NOT_UNDERSTOOD });
  const threadId = startedThread.data.thread.id;

  let settle: (end: TurnEnd) => void = () => {};
  const ended = new Promise<TurnEnd>((resolve) => {
    settle = resolve;
  });
  // The turn's id, once Codex says it has started (or `undefined` if it didn't): a tool call
  // can arrive before the worker has read that answer.
  let learnTurnId: (turnId: string | undefined) => void = () => {};
  const startedTurnId = new Promise<string | undefined>((resolve) => {
    learnTurnId = resolve;
  });
  const stopListening = codex.listen(threadId, {
    called: async (call) =>
      call.turnId === (await startedTurnId)
        ? turn.tools.get(call.tool)?.answer(call.arguments)
        : undefined,
    heard: (notice) => {
      const completed = TurnCompleted.safeParse(notice);
      if (!completed.success) return turn.heard(notice);
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
    const started = await codex.request("turn/start", {
      threadId,
      input: [
        { type: "text", text: turn.message, text_elements: [] },
        // Each photo the turn carries, in the order the message numbers them (#78).
        ...(turn.photos ?? []).map((photo) => ({ type: "localImage", path: photo.path })),
      ],
      ...(turn.effort === undefined ? {} : { effort: turn.effort }),
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      approvalPolicy: "never",
      ...(turn.outputSchema === undefined ? {} : { outputSchema: turn.outputSchema }),
    });
    if (!started.ok) return err(failureForRequest(started.error));
    const startedTurn = TurnStarted.safeParse(started.value);
    if (!startedTurn.success) return err({ kind: "unknown", message: NOT_UNDERSTOOD });
    const turnId = startedTurn.data.turn.id;
    learnTurnId(turnId);

    // Stopping the turn stops Codex (its own name for that is `turn/interrupt`). Codex says when
    // it has stopped; if it doesn't say so soon, the turn ends anyway, so nothing is held up.
    const stopTurn = () => {
      void codex.request("turn/interrupt", { threadId, turnId });
      void wait(WIND_DOWN_MS).then(() => settle({ kind: "stopped" }));
    };
    if (turn.signal.aborted) stopTurn();
    else turn.signal.addEventListener("abort", stopTurn, { once: true });
    const end = await ended;
    turn.signal.removeEventListener("abort", stopTurn);
    return ok(end);
  } finally {
    // A call still waiting for the turn to start is refused.
    learnTurnId(undefined);
    stopListening();
    // Codex forgets the thread; nothing of it is kept.
    void codex.request("thread/unsubscribe", { threadId });
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

  let cached: { at: number; status: ProviderStatus } | undefined;
  /** A check already running, which simultaneous callers share, and when the sign-in last changed. */
  let checking: { since: number; status: Promise<ProviderStatus> } | undefined;
  /** Counts changes to the sign-in, so a check that started before one is never kept. */
  let signInChanges = 0;
  const signInChanged = () => {
    signInChanges += 1;
    cached = undefined;
  };
  /** The sign-in Courtyard started, which lives in the app-server running now. */
  let login: Login = { kind: "none" };

  /** Hears how a sign-in went, and that the account changed, so the status is asked again. */
  const heard = (notice: z.infer<typeof CodexNotice>) => {
    signInChanged();
    const completed = LoginCompleted.safeParse(notice);
    if (!completed.success || login.kind !== "waiting") return;
    const { loginId, success, error } = completed.data.params;
    if (loginId !== null && loginId !== login.loginId) return;
    login = success
      ? { kind: "none" }
      : { kind: "not-finished", why: EXPIRED.test(error ?? "") ? "expired" : "failed" };
  };

  /** The app-server, started the first time Codex is needed and again after it ends. */
  let current: Promise<Result<Connection, StartFailure>> | undefined;
  const connection = () => {
    if (current === undefined) {
      const starting = connect({ startAppServer, codexHome, requestTimeoutMs });
      current = starting;
      void starting.then((started) => {
        const forget = () => {
          if (current === starting) current = undefined;
          // A sign-in in progress ends with the app-server it was started in.
          if (login.kind === "waiting") login = { kind: "not-finished", why: "failed" };
        };
        if (started.ok) {
          started.value.onOtherNotice(heard);
          void started.value.ended.then(forget);
        } else forget();
      });
    }
    return current;
  };

  /** A sign-in in progress whose code has run out counts as expired, and Codex stops waiting. */
  const expireLogin = async () => {
    if (login.kind !== "waiting" || now() < login.expiresAt) return;
    const { loginId } = login;
    login = { kind: "not-finished", why: "expired" };
    const started = await connection();
    if (started.ok) void started.value.request("account/login/cancel", { loginId });
  };

  /** Gives up a sign-in in progress, telling Codex, and forgets one that didn't finish. */
  const dropLogin = async () => {
    if (login.kind === "waiting") {
      const { loginId } = login;
      const started = await connection();
      if (started.ok) await started.value.request("account/login/cancel", { loginId });
    }
    login = { kind: "none" };
  };

  /** Who is signed in to Courtyard's Codex home, read from Codex each time. */
  const accountState = async (): Promise<SignInState> => {
    const started = await connection();
    if (!started.ok) return { kind: "unavailable", reason: START_FAILURES[started.error] };
    const account = await started.value.request("account/read", { refreshToken: false });
    if (!account.ok) {
      return { kind: "unavailable", reason: failureForRequest(account.error).message };
    }
    const parsed = AccountAnswer.safeParse(account.value);
    if (!parsed.success) return { kind: "unavailable", reason: NOT_UNDERSTOOD };
    const signedIn = parsed.data.account;
    return signedIn === null
      ? { kind: "signed-out" }
      : { kind: "signed-in", email: signedIn.email, plan: signedIn.planType };
  };

  /**
   * Starting, giving up and signing out happen one at a time, so two at once (two devices, say)
   * can't leave a sign-in Codex is still waiting for.
   */
  let changing = Promise.resolve();
  const oneAtATime = <T>(change: () => Promise<T>): Promise<T> => {
    const done = changing.then(change);
    changing = done.then(
      () => {},
      () => {},
    );
    return done;
  };

  const waitingState = (waiting: Extract<Login, { kind: "waiting" }>): SignInState => ({
    kind: "waiting",
    link: waiting.link,
    code: waiting.code,
    expiresAt: new Date(waiting.expiresAt).toISOString(),
  });

  /**
   * Signing in from the home page with a device code (ADR 0015): Codex gives a link and a
   * one-time code to finish on any device, and keeps the sign-in in its own home. Only the link and
   * code leave this file.
   */
  const signIn: SignIn = {
    service: "ChatGPT",

    state: async () => {
      await expireLogin();
      if (login.kind === "waiting") return waitingState(login);
      if (login.kind === "not-finished") return { kind: "not-finished", why: login.why };
      return accountState();
    },

    start: () =>
      oneAtATime(async (): Promise<Result<SignInState, string>> => {
        await dropLogin();
        const started = await connection();
        if (!started.ok) return err(START_FAILURES[started.error]);
        const asked = await started.value.request("account/login/start", {
          type: "chatgptDeviceCode",
        });
        if (!asked.ok) return err(failureForRequest(asked.error).message);
        const parsed = LoginStarted.safeParse(asked.value);
        if (!parsed.success) return err(NOT_UNDERSTOOD);
        const waiting = {
          kind: "waiting",
          loginId: parsed.data.loginId,
          link: parsed.data.verificationUrl,
          code: parsed.data.userCode,
          expiresAt: now() + DEVICE_CODE_MS,
        } as const;
        login = waiting;
        return ok(waitingState(waiting));
      }),

    cancel: () => oneAtATime(dropLogin),

    signOut: () =>
      oneAtATime(async (): Promise<Result<null, string>> => {
        await dropLogin();
        const started = await connection();
        if (!started.ok) return err(START_FAILURES[started.error]);
        const signedOut = await started.value.request("account/logout", undefined);
        signInChanged();
        return signedOut.ok ? ok(null) : err(failureForRequest(signedOut.error).message);
      }),
  };

  const checkStatus = async (): Promise<ProviderStatus> => {
    const unavailable = (reason: string): ProviderStatus => ({
      id,
      label: LABEL,
      available: false,
      reason,
      ...(reason === SIGNED_OUT ? { signedOut: true } : {}),
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

    // Its usage limit, when one is used up: a status that can't say leaves it to the next turn.
    const limits = await codex.request("account/rateLimits/read", undefined);
    const resetAt = limits.ok ? resetTimeFrom(limits.value) : undefined;

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
            ...(resetAt ? { limit: { resetAt } } : {}),
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
      // A check that started before the sign-in last changed may have read the old account.
      if (checking?.since !== signInChanges) {
        const check = { since: signInChanges, status: checkStatus() };
        checking = check;
        void check.status.finally(() => {
          if (checking === check) checking = undefined;
        });
      }
      const { since, status: checked } = checking;
      const status = await checked;
      if (since === signInChanges) cached = { at: now(), status };
      return status;
    },

    runTurn: async (input) => {
      if (input.signal.aborted) return ok(null);
      const started = await connection();
      if (!started.ok) {
        return err({ kind: "provider-unavailable", message: START_FAILURES[started.error] });
      }
      const codex = started.value;

      // The answer and what Codex does go out a piece at a time, in order, however fast it sends them.
      let emitting = Promise.resolve();
      let lost = false;
      const inOrder = (send: () => Promise<void>) => {
        emitting = emitting.then(send).catch(() => {
          lost = true;
        });
      };
      // What the turn found on the web, for its sources (ADR 0019).
      let answer = "";
      let usedWeb = false;
      const read: string[] = [];
      const end = await turnOnThread(codex, {
        model: input.model,
        effort: input.effort,
        cwd: resolve(input.folder),
        instructions: input.framing.instructions,
        message: input.framing.message,
        photos: photosOf(input.framing.attachments),
        tools: toolsFor(input),
        searchesWeb: input.framing.webSearch !== null,
        heard: (notice) => {
          const activity = webActivity(notice);
          if (activity !== undefined) {
            usedWeb = true;
            if (activity.kind === "page-read") read.push(activity.url);
            inOrder(() => input.report(activity));
            return;
          }
          const text = TextDelta.safeParse(notice);
          if (!text.success) return;
          const piece = text.data.params.delta;
          answer += piece;
          inOrder(() => input.emit(piece));
        },
        signal: input.signal,
      });
      await emitting;
      if (!end.ok) return end;
      if (input.signal.aborted) return ok(null);
      if (lost) return err({ kind: "unknown", message: "Courtyard couldn't keep Codex's answer." });
      switch (end.value.kind) {
        case "completed": {
          // Codex gives no list of results, so its sources are the links its answer gives.
          const sources = usedWeb ? turnSources({ answer, read, titles: new Map() }) : [];
          if (sources.length > 0) await input.cite(sources);
          return ok(null);
        }
        case "stopped":
          return ok(null);
        case "crashed":
          return err(CRASHED);
        case "failed":
          return err(await failedTurn(codex, end.value.error));
      }
    },

    signIn,

    answerOnce: async (input) => {
      const stopped = err<FailureReason>({ kind: "unknown", message: "It was stopped." });
      if (input.signal.aborted) return stopped;
      const started = await connection();
      if (!started.ok) {
        return err({ kind: "provider-unavailable", message: START_FAILURES[started.error] });
      }
      const codex = started.value;

      let answer: string | undefined;
      const end = await turnOnThread(codex, {
        model: input.model,
        effort: input.effort,
        // Nowhere in particular: it has no tools to look with.
        cwd: tmpdir(),
        instructions: input.instructions,
        message: input.message,
        tools: new Map(),
        searchesWeb: false,
        outputSchema: jsonSchemaOf(input.schema),
        heard: (notice) => {
          const message = MessageCompleted.safeParse(notice);
          if (message.success && message.data.params.item.phase !== "commentary") {
            answer = message.data.params.item.text;
          }
        },
        signal: input.signal,
      });
      if (!end.ok) return end;
      if (input.signal.aborted) return stopped;
      switch (end.value.kind) {
        case "stopped":
          return stopped;
        case "crashed":
          return err(CRASHED);
        case "failed":
          return err(await failedTurn(codex, end.value.error));
        case "completed":
          try {
            return answer === undefined
              ? err({ kind: "unknown", message: NOT_UNDERSTOOD })
              : ok(JSON.parse(answer));
          } catch {
            return err({ kind: "unknown", message: NOT_UNDERSTOOD });
          }
      }
    },
  };
};
