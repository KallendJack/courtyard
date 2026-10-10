import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  createSdkMcpServer,
  type HookCallback,
  type Options,
  query,
  type SDKUserMessage,
  type SyncHookJSONOutput,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
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
import { exists, listSubfolders, readBytes } from "../files.ts";
import { OUTSIDE_WORKSPACE, PAGE_NOT_ALLOWED } from "../prompts/index.ts";
import { err, ok, type Result } from "../result.ts";
import { pageKey, pageRead, type SearchHit, turnSources } from "../sources/index.ts";
import { shownPath, staysInside } from "../workspace-files/index.ts";
import {
  type CodeTurn,
  type CourtyardTool,
  jsonSchemaOf,
  type Provider,
  photosOf,
  type ToolReply,
  type TurnInput,
  type WebSearch,
} from "./index.ts";

const id = ProviderId.parse("claude");
/** Claude reads the workspace's files, saves to context and codes; tool connections come later. */
const CAPABILITIES: Capabilities = {
  readsFiles: true,
  codes: true,
  usesTools: false,
  savesContext: true,
  searchesWeb: true,
};
const LABEL = "Claude";

/**
 * The two things the adapter needs from Claude Code, so tests can stand in for it. Answers come
 * back unparsed: the adapter checks every one with Zod, like any other edge.
 */
export type ClaudeCode = {
  /** Who is signed in, and the models their plan offers, without sending a prompt. */
  readonly check: (signal: AbortSignal) => Promise<unknown>;
  /**
   * Runs one turn, yielding Claude Code's messages as they arrive. A session's turn streams its
   * message, so it can carry images (#78); a one-off question is a string.
   */
  readonly run: (request: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options: Options;
  }) => AsyncIterable<unknown>;
};

/**
 * A turn's message as Claude Code's streaming input (#78): one message from the owner, its text
 * then each photo the turn carries as an image, in the order the text numbers them.
 */
async function* turnPrompt(framing: TurnInput["framing"]): AsyncIterable<SDKUserMessage> {
  const images = await Promise.all(
    photosOf(framing.attachments).map(async (photo) => {
      const bytes = await readBytes(photo.path);
      return bytes.ok && bytes.value !== undefined
        ? [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: photo.mediaType,
                data: bytes.value.toString("base64"),
              },
            },
          ]
        : [];
    }),
  );
  yield {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: framing.message }, ...images.flat()],
    },
    parent_tool_use_id: null,
  };
}

/** The tools a planning workspace gets: looking at its files, never changing them (ADR 0003). */
const PLANNING_TOOLS = ["Read", "Glob", "Grep"];
/**
 * The tools a code session gets as well: editing files and running commands, each asked of the
 * worker first (ADR 0007).
 */
const CODING_TOOLS = ["Edit", "Write", "Bash"];
/**
 * How long Claude Code waits on the worker's say in a code session, which may be an approval the
 * owner answers in the morning (#171): the longest a timer can wait (about 24 days), so in practice
 * no limit. Only a stop ends the wait sooner.
 */
const APPROVAL_WAIT_SECONDS = 2_147_483;
/** The tools a turn with web search gets as well (ADR 0019). */
const WEB_TOOLS = ["WebSearch", "WebFetch"];
/** The in-process MCP server Courtyard's own tools are offered through. */
const COURTYARD_SERVER = "courtyard";

/** A tool from Courtyard's server, by the name Claude Code calls it. */
const courtyardTool = (name: string) => `mcp__${COURTYARD_SERVER}__${name}`;

/** An image a tool gives back, from its data URL, as MCP takes it. */
const DataUrl = /^data:([^;,]+);base64,(.*)$/s;

/** A reply from one of Courtyard's tools, as MCP gives it to Claude Code. */
const asToolResult = (reply: ToolReply) => ({
  content: reply.content.map((part) => {
    const image = part.kind === "image" ? DataUrl.exec(part.dataUrl) : null;
    if (part.kind === "image" && image?.[1] && image[2] !== undefined) {
      return { type: "image" as const, mimeType: image[1], data: image[2] };
    }
    return { type: "text" as const, text: part.kind === "text" ? part.text : "" };
  }),
  isError: !reply.ok,
});

/**
 * Courtyard's tools for the turn (the save tool, use skill…) as in-process tools on one server
 * (ADRs 0013, 0016). Each call's input goes to the worker as Claude sent it, and the worker's
 * reply comes back as the tool's result.
 */
const courtyardServer = (tools: readonly CourtyardTool[], callTool: TurnInput["callTool"]) =>
  createSdkMcpServer({
    name: COURTYARD_SERVER,
    tools: tools.map((courtyard) =>
      tool(
        courtyard.name,
        courtyard.description,
        courtyard.input,
        async (input) => asToolResult(await callTool({ name: courtyard.name, input })),
        { alwaysLoad: true },
      ),
    ),
  });

/** How long a status check may take before Claude counts as unavailable. */
const CHECK_TIMEOUT_MS = 15_000;
/** How long a status answer is reused, so listing providers doesn't start Claude Code each time. */
const STATUS_TTL_MS = 60_000;
const MAX_TURNS = 30;
/** The longest a stopped turn waits for Claude Code to finish before moving on. */
const WIND_DOWN_MS = 2000;

/**
 * The environment Claude Code runs with: the worker's own, without Courtyard's settings, and with
 * the parts of the machine's Claude Code setup that would leak into a workspace switched off
 * (auto memory, and the claude.ai connectors such as email, calendar and drive). Courtyard never
 * looks at the sign-in that passes through.
 */
const isolatedEnv = (): Record<string, string | undefined> => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("COURTYARD_")),
  ),
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
});

/**
 * Isolation for everything Courtyard asks of Claude Code (ADR 0003): none of the machine's
 * settings, CLAUDE.md files, skills, memory, connectors or MCP servers, and prompts delivered
 * exactly as written, so an `@path` in any text can't pull in a file without a tool call.
 */
const isolatedOptions = (): Options => ({
  settingSources: [],
  skills: [],
  strictMcpConfig: true,
  mcpServers: {},
  verbatimPrompts: true,
  env: isolatedEnv(),
});

/** Where a repository keeps its own Claude Code skills, each in a folder with its `SKILL.md`. */
const PROJECT_SKILLS = join(".claude", "skills");

/**
 * What a code session takes from its repository (ADR 0022): Claude Code's project settings
 * source, so its `CLAUDE.md` (and the `AGENTS.md` that points to) and its settings, and only the
 * repository's own skills. The machine's user and local settings, memory and connectors stay off,
 * as on every turn.
 */
const projectSetup = async (worktree: string): Promise<Partial<Options>> => {
  const folders = await listSubfolders(join(worktree, PROJECT_SKILLS));
  const skills = [];
  for (const name of folders.ok ? folders.value : []) {
    const found = await exists(join(worktree, PROJECT_SKILLS, name, "SKILL.md"));
    if (found.ok && found.value) skills.push(name);
  }
  return { settingSources: ["project"], skills };
};

/** Claude Code as it really is: the Agent SDK, with this machine's sign-in. */
const realClaudeCode: ClaudeCode = {
  check: async (signal) => {
    const stop = new AbortController();
    const stopNow = () => stop.abort();
    signal.addEventListener("abort", stopNow);
    // A prompt that never arrives: start Claude Code, ask who's signed in, then stop it.
    const silence: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    };
    const session = query({
      prompt: silence,
      options: { ...isolatedOptions(), abortController: stop },
    });
    try {
      return { account: await session.accountInfo(), models: await session.supportedModels() };
    } finally {
      signal.removeEventListener("abort", stopNow);
      stop.abort();
    }
  },
  run: ({ prompt, options }) => query({ prompt, options }),
};

/** A level of effort as the Agent SDK takes it, least first. */
const ClaudeEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);
/** Each of Claude's levels of effort in Claude's own words. */
const EFFORT_LABELS: Record<z.infer<typeof ClaudeEffort>, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/**
 * The effort to send Claude Code: none for the model's default, or the level as Claude takes it.
 * The worker only sends a level the model listed, so one Claude doesn't know is a bug, and fails.
 */
const effortFor = (
  effort: Effort | undefined,
): Result<z.infer<typeof ClaudeEffort> | undefined, FailureReason> => {
  if (effort === undefined) return ok(undefined);
  const parsed = ClaudeEffort.safeParse(effort);
  return parsed.success
    ? ok(parsed.data)
    : err({ kind: "unknown", message: "Claude doesn't take that effort." });
};

const ClaudeModel = z.object({
  value: z.string(),
  displayName: z.string(),
  description: z.string().catch(""),
  supportsEffort: z.boolean().optional().catch(undefined),
  /** Unparsed: a level Courtyard doesn't know yet is left out rather than fail the check. */
  supportedEffortLevels: z.array(z.string()).optional().catch(undefined),
});

/** The levels of effort a model takes, the ones Courtyard knows, in Claude's order. */
const effortsOf = (model: z.infer<typeof ClaudeModel>): EffortInfo[] => {
  if (model.supportsEffort === false) return [];
  const levels = new Set(model.supportedEffortLevels ?? []);
  return ClaudeEffort.options
    .filter((level) => levels.has(level))
    .map((level) => ({ id: Effort.parse(level), label: EFFORT_LABELS[level] }));
};

const CheckAnswer = z.object({
  account: z.object({
    email: z.string().optional(),
    subscriptionType: z.string().optional(),
    tokenSource: z.string().optional(),
    apiKeySource: z.string().optional(),
  }),
  models: z.array(ClaudeModel),
});

/**
 * A model's label in the picker. Claude Code's "Default" doesn't say which model it is, but its
 * description starts with that model's name ("Opus 5.5 · Best for…"), so the label borrows it.
 */
const labelFor = (model: z.infer<typeof ClaudeModel>) => {
  const [first, ...rest] = model.description.split(" · ");
  const named = rest.length > 0 ? first?.trim() : undefined;
  return model.value === "default" && named
    ? `${LABEL} · Default (${named})`
    : `${LABEL} · ${model.displayName}`;
};

const TextDelta = z.object({
  type: z.literal("stream_event"),
  parent_tool_use_id: z.string().nullable().optional(),
  event: z.object({
    type: z.literal("content_block_delta"),
    delta: z.object({ type: z.literal("text_delta"), text: z.string() }),
  }),
});
const RateLimitEvent = z.object({
  type: z.literal("rate_limit_event"),
  rate_limit_info: z.object({ status: z.string(), resetsAt: z.number().optional() }),
});
/** The ways Claude Code says an answer failed; anything new counts as "unknown". */
const AnswerError = z
  .enum([
    "rate_limit",
    "authentication_failed",
    "oauth_org_not_allowed",
    "billing_error",
    "account_on_hold",
    "verification_required",
    "overloaded",
    "unknown",
  ])
  .catch("unknown");
type AnswerError = z.infer<typeof AnswerError>;
/**
 * An assistant message that failed. Ordinary assistant messages have no `error` at all; the field
 * has to be there before its value is read, or every answer would count as a failure.
 */
const AssistantError = z.object({
  type: z.literal("assistant"),
  error: z.string().pipe(AnswerError),
});
const ResultMessage = z.object({
  type: z.literal("result"),
  is_error: z.boolean().optional(),
  /** A one-off question's answer, in the shape it asked for. */
  structured_output: z.unknown().optional(),
});

const SIGNED_OUT =
  "Claude Code isn't logged in on the worker machine. Run `claude` there and log in, or set an API key.";

/** `resetsAt` arrives as a Unix time; accept seconds or milliseconds. */
const resetTimeFrom = (resetsAt: number | undefined) =>
  resetsAt === undefined
    ? undefined
    : new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString();

/** Plain words for each way Claude Code reports a failed answer. */
const failureFor = (error: AnswerError, resetAt: string | undefined): FailureReason => {
  switch (error) {
    case "rate_limit":
      return { kind: "rate-limited", ...(resetAt ? { resetAt } : {}) };
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return { kind: "provider-unavailable", message: SIGNED_OUT };
    case "billing_error":
    case "account_on_hold":
    case "verification_required":
      return {
        kind: "provider-unavailable",
        message: "Claude's account needs attention. Check it at claude.ai.",
      };
    case "overloaded":
      return { kind: "unknown", message: "Claude is overloaded right now. Try again in a moment." };
    case "unknown":
      return { kind: "unknown", message: "Claude couldn't answer this time." };
  }
};

/** What a run's messages have said so far about how it went. */
type Progress = {
  resetAt?: string | undefined;
  failure?: FailureReason;
  result?: z.infer<typeof ResultMessage>;
};

/** Notes what a message says about the run: a usage limit, a failed answer, or its result. */
const noteProgress = (message: unknown, progress: Progress) => {
  const limit = RateLimitEvent.safeParse(message);
  if (limit.success) {
    if (limit.data.rate_limit_info.status === "rejected") {
      progress.resetAt = resetTimeFrom(limit.data.rate_limit_info.resetsAt);
      progress.failure = failureFor("rate_limit", progress.resetAt);
    }
    return;
  }
  const assistant = AssistantError.safeParse(message);
  if (assistant.success) {
    progress.failure ??= failureFor(assistant.data.error, progress.resetAt);
    return;
  }
  const result = ResultMessage.safeParse(message);
  if (result.success) {
    progress.result = result.data;
    if (result.data.is_error) progress.failure ??= failureFor("unknown", progress.resetAt);
  }
};

/** Claude Code failing to run at all: only the kind of error goes to the worker's log. */
const claudeCodeStopped = (error: unknown): FailureReason => {
  console.error("Claude Code stopped:", error instanceof Error ? error.name : typeof error);
  return {
    kind: "provider-unavailable",
    message: "Claude Code stopped unexpectedly on the worker machine.",
  };
};

/** Turns a one-off question may take: answering in its shape can take a retry. */
const ONE_OFF_MAX_TURNS = 3;

/**
 * Each tool's input exactly as Claude Code sends it. Strict, so a field Courtyard doesn't know
 * about (a new way to name a path) is refused rather than let through unchecked.
 */
const ReadInput = z.strictObject({
  file_path: z.string(),
  offset: z.unknown().optional(),
  limit: z.unknown().optional(),
  pages: z.unknown().optional(),
});
const GlobInput = z.strictObject({ pattern: z.string(), path: z.string().optional() });
const GrepInput = z.strictObject({
  /** What to search for in the files' contents: text, not a path. */
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  output_mode: z.unknown().optional(),
  "-B": z.unknown().optional(),
  "-A": z.unknown().optional(),
  "-C": z.unknown().optional(),
  context: z.unknown().optional(),
  "-n": z.unknown().optional(),
  "-i": z.unknown().optional(),
  "-o": z.unknown().optional(),
  type: z.unknown().optional(),
  head_limit: z.unknown().optional(),
  offset: z.unknown().optional(),
  multiline: z.unknown().optional(),
});

const WebSearchInput = z.strictObject({
  query: z.string(),
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
  /** How thoroughly to search ("standard", "extended"), which Claude Code sends but doesn't list. */
  mode: z.string().optional(),
});
const WebFetchInput = z.strictObject({ url: z.string(), prompt: z.string() });

const EditInput = z.strictObject({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});
const WriteInput = z.strictObject({ file_path: z.string(), content: z.string() });
const BashInput = z.strictObject({
  command: z.string(),
  description: z.string().optional(),
  timeout: z.number().optional(),
  run_in_background: z.boolean().optional(),
  dangerouslyDisableSandbox: z.boolean().optional(),
});

/**
 * The worker's say on a code session's edit or command (ADR 0007): what it answers, or
 * `undefined` for a tool that neither edits nor runs anything.
 */
const askWorker = async (
  code: CodeTurn,
  tool: string,
  input: unknown,
): Promise<Result<null, string> | undefined> => {
  const unchecked = err("That request couldn't be checked, so it was refused.");
  switch (tool) {
    case "Edit":
    case "Write": {
      const edit = (tool === "Edit" ? EditInput : WriteInput).safeParse(input);
      return edit.success ? code.edit(edit.data.file_path) : unchecked;
    }
    case "Bash": {
      const bash = BashInput.safeParse(input);
      return bash.success ? code.run(bash.data.command, bash.data.description) : unchecked;
    }
    default:
      return undefined;
  }
};

/** What WebSearch gives back: its hits, among commentary. Anything else in it is ignored. */
const WebSearchOutput = z.object({
  results: z.array(
    z.union([
      z.object({ content: z.array(z.object({ title: z.string(), url: z.string() })) }),
      z.unknown().transform(() => ({ content: [] })),
    ]),
  ),
});

/**
 * Web search on a turn, as the hooks keep track of it (ADR 0019): the pages that may be read
 * (the owner's links, then each search's results), each search's results, and the pages read.
 */
type WebTurn = {
  readonly allowed: Set<string>;
  readonly searches: SearchHit[][];
  readonly read: string[];
  searched: boolean;
};

const webTurnFor = (webSearch: WebSearch | null): WebTurn | null =>
  webSearch === null
    ? null
    : {
        allowed: new Set(webSearch.ownerLinks.flatMap((link) => pageKey(link) ?? [])),
        searches: [],
        read: [],
        searched: false,
      };

/** What a tool call would touch: the paths it names and any glob that could reach elsewhere. */
const reachOf = (tool: string, input: unknown) => {
  switch (tool) {
    case "Read": {
      const read = ReadInput.safeParse(input);
      return read.success
        ? { paths: [read.data.file_path], globs: [], readsFile: read.data.file_path }
        : undefined;
    }
    case "Glob": {
      const glob = GlobInput.safeParse(input);
      return glob.success
        ? { paths: glob.data.path ? [glob.data.path] : [], globs: [glob.data.pattern] }
        : undefined;
    }
    case "Grep": {
      const grep = GrepInput.safeParse(input);
      return grep.success
        ? {
            paths: grep.data.path ? [grep.data.path] : [],
            globs: grep.data.glob ? [grep.data.glob] : [],
          }
        : undefined;
    }
    default:
      return undefined;
  }
};

const decision = (allowed: boolean, reason?: string): SyncHookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: allowed ? "allow" : "deny",
    ...(reason ? { permissionDecisionReason: reason } : {}),
  },
});

/**
 * Checked before every tool call, and the only way one is allowed: none are pre-approved, so
 * anything this doesn't allow is refused, including when it fails. Only the planning tools, only
 * inside the workspace folder once symlinks are followed, and Courtyard's own tools offered this
 * turn, which touch nothing themselves. In a code session, edits and commands too, each as the
 * worker says (ADR 0007). On a turn with web search, searches, and reading only a page from the
 * turn's search results or a link the owner sent (ADR 0019). Each file read, search and page read
 * is reported.
 */
const confineTo =
  (confine: {
    folder: string;
    report: TurnInput["report"];
    /** Courtyard's own tools offered this turn, by the names Claude Code calls them. */
    courtyardTools: readonly string[];
    web: WebTurn | null;
    code: CodeTurn | null;
  }): HookCallback =>
  async (input) => {
    const { folder, report, courtyardTools, web, code } = confine;
    try {
      if (input.hook_event_name !== "PreToolUse") return {};
      if (courtyardTools.includes(input.tool_name)) return decision(true);
      const asked =
        code === null ? undefined : await askWorker(code, input.tool_name, input.tool_input);
      if (asked !== undefined) return asked.ok ? decision(true) : decision(false, asked.error);
      if (web !== null && input.tool_name === "WebSearch") {
        const search = WebSearchInput.safeParse(input.tool_input);
        if (!search.success) return decision(false, "That search couldn't be checked.");
        web.searched = true;
        await report({ kind: "web-searched", query: search.data.query });
        return decision(true);
      }
      if (web !== null && input.tool_name === "WebFetch") {
        const fetch = WebFetchInput.safeParse(input.tool_input);
        const read = fetch.success ? pageRead(fetch.data.url) : undefined;
        if (read === undefined || !web.allowed.has(read.url)) {
          return decision(false, PAGE_NOT_ALLOWED);
        }
        web.read.push(read.url);
        await report(read);
        return decision(true);
      }
      const reach = reachOf(input.tool_name, input.tool_input);
      if (!reach) return decision(false, "Only reading this workspace's files is allowed here.");

      if (!(await staysInside(folder, reach))) return decision(false, OUTSIDE_WORKSPACE);

      if ("readsFile" in reach && reach.readsFile !== undefined) {
        await report({ kind: "read-file", path: shownPath(folder, reach.readsFile) });
      }
      return decision(true);
    } catch {
      return decision(false, "That request couldn't be checked, so it was refused.");
    }
  };

/**
 * Checked after every tool call: a search's results become pages the turn may read, and are kept
 * for its Sources (ADR 0019). Run before the results reach the model, so a fetch of one of
 * them always finds it allowed.
 */
const noteResults =
  (web: WebTurn): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PostToolUse" || input.tool_name !== "WebSearch") return {};
    const output = WebSearchOutput.safeParse(input.tool_response);
    if (!output.success) return {};
    const hits = output.data.results.flatMap((result) => result.content);
    web.searches.push(hits);
    for (const hit of hits) {
      const key = pageKey(hit.url);
      if (key !== undefined) web.allowed.add(key);
    }
    return {};
  };

/**
 * The messages, until the turn is stopped: then it ends at once, even if Claude Code is still
 * waiting on something, and tells Claude Code to finish up.
 */
async function* untilStopped(messages: AsyncIterable<unknown>, signal: AbortSignal) {
  const iterator = messages[Symbol.asyncIterator]();
  // One listener for the whole turn: it settles whichever wait is current when the stop comes.
  let settleCurrentWait: (() => void) | undefined;
  const onStop = () => settleCurrentWait?.();
  signal.addEventListener("abort", onStop, { once: true });
  try {
    while (!signal.aborted) {
      const stopped = new Promise<"stopped">((resolve) => {
        settleCurrentWait = () => resolve("stopped");
      });
      const next = await Promise.race([iterator.next(), stopped]);
      if (next === "stopped" || next.done) break;
      yield next.value;
    }
  } finally {
    signal.removeEventListener("abort", onStop);
    if (signal.aborted) {
      // Give Claude Code a moment to wind down, so the next turn never runs alongside it.
      await Promise.race([
        Promise.resolve(iterator.return?.()).catch(() => undefined),
        wait(WIND_DOWN_MS),
      ]);
    }
  }
}

/**
 * Claude through the Agent SDK and the worker machine's own Claude Code sign-in, or an API key
 * (ADR 0003). Nothing outside this file knows how Claude is signed in or billed, and Courtyard
 * never reads, stores or logs the credentials.
 */
export const createClaudeProvider = (
  options: { claudeCode?: ClaudeCode; now?: () => number; checkTimeoutMs?: number } = {},
): Provider => {
  const claudeCode = options.claudeCode ?? realClaudeCode;
  const now = options.now ?? Date.now;
  const checkTimeoutMs = options.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
  let cached: { at: number; status: ProviderStatus } | undefined;
  /** A check already running, which simultaneous callers share rather than start another. */
  let checking: Promise<ProviderStatus> | undefined;

  const checkStatus = async (): Promise<ProviderStatus> => {
    const unavailable = (reason: string): ProviderStatus => ({
      id,
      label: LABEL,
      available: false,
      reason,
    });
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), checkTimeoutMs);
    let answer: unknown;
    try {
      answer = await Promise.race([
        claudeCode.check(stop.signal),
        new Promise((_, reject) =>
          stop.signal.addEventListener("abort", () => reject(new Error("timed out"))),
        ),
      ]);
    } catch {
      return unavailable("Claude Code couldn't start on the worker machine, or didn't answer.");
    } finally {
      clearTimeout(timer);
      stop.abort();
    }

    const parsed = CheckAnswer.safeParse(answer);
    if (!parsed.success) {
      return unavailable("Claude Code answered in a way Courtyard doesn't understand.");
    }
    const { account, models } = parsed.data;
    const signedIn = Boolean(
      account.email || account.subscriptionType || account.tokenSource || account.apiKeySource,
    );
    if (!signedIn) return unavailable(SIGNED_OUT);
    // The short names (default, opus, sonnet…) follow the newest models; pinned versions are left out.
    const offered = models.flatMap((m) => {
      const modelId = ModelId.safeParse(m.value);
      return modelId.success && !m.value.startsWith("claude-")
        ? [{ id: modelId.data, label: labelFor(m), efforts: effortsOf(m) }]
        : [];
    });
    return {
      id,
      label: LABEL,
      available: true,
      models: offered,
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
      const effort = effortFor(input.effort);
      if (!effort.ok) return effort;
      const folder = resolve(input.folder);
      const progress: Progress = {};
      // The owner stopping the turn stops Claude Code itself.
      const stop = new AbortController();
      const stopClaudeCode = () => stop.abort();
      if (input.signal.aborted) stop.abort();
      input.signal.addEventListener("abort", stopClaudeCode);

      const { tools } = input.framing;
      const { code } = input;
      const courtyardTools = tools.map((offered) => courtyardTool(offered.name));
      const web = webTurnFor(input.framing.webSearch);
      let answer = "";
      try {
        const messages = claudeCode.run({
          prompt: turnPrompt(input.framing),
          options: {
            ...isolatedOptions(),
            ...(code === null
              ? {}
              : // Its commands' git and gh use Courtyard's GitHub sign-in, never the machine's (#99).
                { ...(await projectSetup(folder)), env: { ...isolatedEnv(), ...code.env } }),
            ...(input.model === "default" ? {} : { model: input.model }),
            ...(effort.value === undefined ? {} : { effort: effort.value }),
            cwd: folder,
            systemPrompt: input.framing.instructions,
            tools: [
              ...PLANNING_TOOLS,
              ...(code === null ? [] : CODING_TOOLS),
              ...(web === null ? [] : WEB_TOOLS),
            ],
            // Nothing is pre-approved: the hook allows each call or it's refused.
            permissionMode: "dontAsk",
            ...(tools.length === 0
              ? {}
              : { mcpServers: { [COURTYARD_SERVER]: courtyardServer(tools, input.callTool) } }),
            hooks: {
              PreToolUse: [
                {
                  hooks: [confineTo({ folder, report: input.report, courtyardTools, web, code })],
                  // An approval waits on the owner, however long they take (#171).
                  ...(code === null ? {} : { timeout: APPROVAL_WAIT_SECONDS }),
                },
              ],
              ...(web === null ? {} : { PostToolUse: [{ hooks: [noteResults(web)] }] }),
            },
            includePartialMessages: true,
            maxTurns: MAX_TURNS,
            abortController: stop,
          },
        });

        for await (const message of untilStopped(messages, stop.signal)) {
          const delta = TextDelta.safeParse(message);
          if (delta.success) {
            if (!delta.data.parent_tool_use_id) {
              answer += delta.data.event.delta.text;
              await input.emit(delta.data.event.delta.text);
            }
            continue;
          }
          noteProgress(message, progress);
        }
      } catch (error) {
        // Stopping can make Claude Code end with an error; that's the stop working, not a failure,
        // and it's handled below. Otherwise Claude Code itself failed (it couldn't start, or
        // stopped), and the session gets plain words.
        if (!input.signal.aborted) progress.failure ??= claudeCodeStopped(error);
      } finally {
        input.signal.removeEventListener("abort", stopClaudeCode);
      }
      if (input.signal.aborted) return ok(null);
      const failure =
        progress.failure ??
        (progress.result === undefined ? failureFor("unknown", progress.resetAt) : undefined);
      if (failure) return err(failure);
      if (web !== null && (web.searched || web.read.length > 0)) {
        const sources = turnSources({ answer, read: web.read, searches: web.searches });
        if (sources.length > 0) await input.cite(sources);
      }
      return ok(null);
    },

    answerOnce: async (input) => {
      const effort = effortFor(input.effort);
      if (!effort.ok) return effort;
      const progress: Progress = {};
      const stop = new AbortController();
      const stopClaudeCode = () => stop.abort();
      if (input.signal.aborted) stop.abort();
      input.signal.addEventListener("abort", stopClaudeCode);
      try {
        const messages = claudeCode.run({
          prompt: input.message,
          options: {
            ...isolatedOptions(),
            ...(input.model === "default" ? {} : { model: input.model }),
            ...(effort.value === undefined ? {} : { effort: effort.value }),
            // Nowhere in particular: it has no tools to look with.
            cwd: tmpdir(),
            systemPrompt: input.instructions,
            tools: [],
            permissionMode: "dontAsk",
            outputFormat: { type: "json_schema", schema: jsonSchemaOf(input.schema) },
            maxTurns: ONE_OFF_MAX_TURNS,
            abortController: stop,
          },
        });
        for await (const message of untilStopped(messages, stop.signal)) {
          noteProgress(message, progress);
        }
      } catch (error) {
        if (!input.signal.aborted) progress.failure ??= claudeCodeStopped(error);
      } finally {
        input.signal.removeEventListener("abort", stopClaudeCode);
      }
      if (input.signal.aborted) return err({ kind: "unknown", message: "It was stopped." });
      if (progress.failure !== undefined) return err(progress.failure);
      const answer = progress.result?.structured_output;
      return answer === undefined ? err(failureFor("unknown", progress.resetAt)) : ok(answer);
    },
  };
};
