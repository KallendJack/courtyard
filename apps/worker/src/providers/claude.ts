import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  type HookCallback,
  type Options,
  query,
  type SDKUserMessage,
  type SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type Capabilities,
  type FailureReason,
  ModelId,
  ProviderId,
  type ProviderStatus,
} from "@courtyard/contract";
import { z } from "zod";
import { err, ok } from "../result.ts";
import type { Provider, TurnInput } from "./index.ts";

const id = ProviderId.parse("claude");
/** Claude reads the workspace's files; coding and tools come in later phases. */
const CAPABILITIES: Capabilities = { readsFiles: true, codes: false, usesTools: false };
const LABEL = "Claude";

/**
 * The two things the adapter needs from Claude Code, so tests can stand in for it. Answers come
 * back unparsed: the adapter checks every one with Zod, like any other edge.
 */
export type ClaudeCode = {
  /** Who is signed in, and the models their plan offers, without sending a prompt. */
  readonly check: (signal: AbortSignal) => Promise<unknown>;
  /** Runs one turn, yielding Claude Code's messages as they arrive. */
  readonly run: (request: { prompt: string; options: Options }) => AsyncIterable<unknown>;
};

/** The tools a planning workspace gets: looking at its files, never changing them (ADR 0003). */
const PLANNING_TOOLS = ["Read", "Glob", "Grep"];
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

const CheckAnswer = z.object({
  account: z.object({
    email: z.string().optional(),
    subscriptionType: z.string().optional(),
    tokenSource: z.string().optional(),
    apiKeySource: z.string().optional(),
  }),
  models: z.array(
    z.object({ value: z.string(), displayName: z.string(), description: z.string().catch("") }),
  ),
});

/**
 * A model's label in the picker. Claude Code's "Default" doesn't say which model it is, but its
 * description starts with that model's name ("Opus 5.5 · Best for…"), so the label borrows it.
 */
const labelFor = (model: { value: string; displayName: string; description: string }) => {
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
const ResultMessage = z.object({ type: z.literal("result"), is_error: z.boolean().optional() });

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

/**
 * Where a path really leads, following symlinks. For a path that doesn't exist yet, the nearest
 * existing folder above it is followed instead, and the rest is added back.
 */
const realLocation = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await realLocation(parent), basename(path));
  }
};

const isWithin = (folder: string, path: string) => {
  const fromFolder = relative(folder, path);
  return fromFolder === "" || (!fromFolder.startsWith("..") && !isAbsolute(fromFolder));
};

/** A glob that could match outside the folder: it starts somewhere absolute or climbs with `..`. */
const reachesOut = (glob: string | undefined) =>
  glob !== undefined && (isAbsolute(glob) || glob.includes(".."));

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
 * inside the workspace folder once symlinks are followed. Each file read is reported.
 */
const confineTo =
  (folder: string, report: TurnInput["report"]): HookCallback =>
  async (input) => {
    try {
      if (input.hook_event_name !== "PreToolUse") return {};
      const reach = reachOf(input.tool_name, input.tool_input);
      if (!reach) return decision(false, "Only reading this workspace's files is allowed here.");

      const realFolder = await realLocation(folder);
      const realPaths = await Promise.all(reach.paths.map((p) => realLocation(resolve(folder, p))));
      if (realPaths.some((p) => !isWithin(realFolder, p)) || reach.globs.some(reachesOut)) {
        return decision(false, "Only files in this workspace's folder can be read.");
      }

      if ("readsFile" in reach && reach.readsFile !== undefined) {
        const shown = relative(folder, resolve(folder, reach.readsFile)).split(sep).join("/");
        await report({ kind: "read-file", path: shown });
      }
      return decision(true);
    } catch {
      return decision(false, "That request couldn't be checked, so it was refused.");
    }
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
        ? [{ id: modelId.data, label: labelFor(m) }]
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
      const folder = resolve(input.folder);
      let resetAt: string | undefined;
      let failure: FailureReason | undefined;
      let resultArrived = false;
      // The owner stopping the turn stops Claude Code itself.
      const stop = new AbortController();
      const stopClaudeCode = () => stop.abort();
      if (input.signal.aborted) stop.abort();
      input.signal.addEventListener("abort", stopClaudeCode);

      try {
        const messages = claudeCode.run({
          prompt: input.framing.message,
          options: {
            ...isolatedOptions(),
            ...(input.model === "default" ? {} : { model: input.model }),
            cwd: folder,
            systemPrompt: input.framing.instructions,
            tools: PLANNING_TOOLS,
            // Nothing is pre-approved: the hook allows each call or it's refused.
            permissionMode: "dontAsk",
            hooks: { PreToolUse: [{ hooks: [confineTo(folder, input.report)] }] },
            includePartialMessages: true,
            maxTurns: MAX_TURNS,
            abortController: stop,
          },
        });

        for await (const message of untilStopped(messages, stop.signal)) {
          const delta = TextDelta.safeParse(message);
          if (delta.success) {
            if (!delta.data.parent_tool_use_id) await input.emit(delta.data.event.delta.text);
            continue;
          }
          const limit = RateLimitEvent.safeParse(message);
          if (limit.success) {
            if (limit.data.rate_limit_info.status === "rejected") {
              resetAt = resetTimeFrom(limit.data.rate_limit_info.resetsAt);
              failure = failureFor("rate_limit", resetAt);
            }
            continue;
          }
          const assistant = AssistantError.safeParse(message);
          if (assistant.success) {
            failure ??= failureFor(assistant.data.error, resetAt);
            continue;
          }
          const result = ResultMessage.safeParse(message);
          if (result.success) {
            resultArrived = true;
            if (result.data.is_error) failure ??= failureFor("unknown", resetAt);
          }
        }
      } catch (error) {
        // Stopping can make Claude Code end with an error; that's the stop working, not a failure,
        // and it's handled below. Otherwise Claude Code itself failed (it couldn't start, or stopped). Only the kind of error goes to
        // the worker's log, never its text; the session gets plain words.
        if (!input.signal.aborted) {
          console.error("Claude Code stopped:", error instanceof Error ? error.name : typeof error);
        }
        failure ??= {
          kind: "provider-unavailable",
          message: "Claude Code stopped unexpectedly on the worker machine.",
        };
      } finally {
        input.signal.removeEventListener("abort", stopClaudeCode);
      }
      if (input.signal.aborted) return ok(null);
      if (!failure && !resultArrived) failure = failureFor("unknown", resetAt);
      return failure ? err(failure) : ok(null);
    },
  };
};
