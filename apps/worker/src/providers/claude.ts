import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  type HookCallback,
  type Options,
  query,
  type SDKUserMessage,
  type SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { type FailureReason, ModelId, ProviderId, type ProviderStatus } from "@courtyard/contract";
import { z } from "zod";
import { err, ok } from "../result.ts";
import type { Provider, SessionLine, TurnInput, TurnWorkspace } from "./index.ts";

const id = ProviderId.parse("claude");
const LABEL = "Claude";

/**
 * The two things the adapter needs from Claude Code, so tests can stand in for it. Answers come
 * back unparsed: the adapter checks every one with Zod, like any other edge.
 */
export type ClaudeCode = {
  /** Who is signed in, and the models their plan offers, without sending a prompt. */
  readonly check: () => Promise<unknown>;
  /** Runs one turn, yielding Claude Code's messages as they arrive. */
  readonly run: (request: { prompt: string; options: Options }) => AsyncIterable<unknown>;
};

/** The only tools a planning workspace gets: looking, never changing (ADR 0003). */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"];
/** How long a status check may take before Claude counts as unavailable. */
const CHECK_TIMEOUT_MS = 15_000;
/** How long a status answer is reused, so listing providers doesn't start Claude Code each time. */
const STATUS_TTL_MS = 60_000;
const MAX_TURNS = 30;

/**
 * Switches off everything of the machine's own Claude Code setup that would leak into a
 * workspace: auto memory and the claude.ai connectors (email, calendar, drive). The rest of the
 * environment passes through untouched, so a sign-in Courtyard never sees still works.
 */
const isolatedEnv = (): Record<string, string | undefined> => ({
  ...process.env,
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
});

/** Claude Code as it really is: the Agent SDK, with this machine's sign-in. */
const realClaudeCode: ClaudeCode = {
  check: async () => {
    const stop = new AbortController();
    // A prompt that never arrives: start Claude Code, ask who's signed in, then stop it.
    const silence: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    };
    const session = query({
      prompt: silence,
      options: {
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
        env: isolatedEnv(),
        abortController: stop,
      },
    });
    try {
      return { account: await session.accountInfo(), models: await session.supportedModels() };
    } finally {
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
  models: z.array(z.object({ value: z.string(), displayName: z.string() })),
});

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
const AssistantError = z.object({ type: z.literal("assistant"), error: z.string() });
const ResultMessage = z.object({ type: z.literal("result"), is_error: z.boolean().optional() });

const SIGNED_OUT =
  "Claude Code isn't logged in on the worker machine. Run `claude` there and log in, or set an API key.";

/** `resetsAt` arrives as a Unix time; accept seconds or milliseconds. */
const resetTimeFrom = (resetsAt: number | undefined) =>
  resetsAt === undefined
    ? undefined
    : new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString();

/** Plain words for each way Claude Code reports a failed answer. */
const failureFor = (error: string, resetAt: string | undefined): FailureReason => {
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
    default:
      return { kind: "unknown", message: "Claude couldn't answer this time." };
  }
};

/** Whether `path` (relative to the folder, or absolute) is inside `folder`. */
const isInside = (folder: string, path: string) => {
  const fromFolder = relative(folder, resolve(folder, path));
  return fromFolder === "" || (!fromFolder.startsWith("..") && !isAbsolute(fromFolder));
};

const ToolInput = z.object({
  file_path: z.string().optional(),
  path: z.string().optional(),
  pattern: z.string().optional(),
  glob: z.string().optional(),
});

/**
 * Checked before every tool call: only the read-only tools, and only inside the workspace folder.
 * Claude Code's own rules allow reading anywhere, so this is where "nothing outside it" is kept.
 * Each file read is reported as it happens.
 */
const confineTo =
  (folder: string, report: TurnInput["report"]): HookCallback =>
  async (input) => {
    const deny = (reason: string): SyncHookJSONOutput => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    });
    if (input.hook_event_name !== "PreToolUse") return {};
    if (!READ_ONLY_TOOLS.includes(input.tool_name)) return deny("Only reading is allowed here.");

    const tool = ToolInput.safeParse(input.tool_input);
    if (!tool.success) return deny("That request couldn't be checked.");
    const { file_path, path, pattern, glob } = tool.data;
    // A pattern that climbs out (`..`) or starts somewhere absolute could match outside the folder.
    const climbs = (text: string | undefined) =>
      text !== undefined && (isAbsolute(text) || text.split(/[\\/]/).includes(".."));
    const paths = [file_path, path].filter((p): p is string => p !== undefined);
    if (paths.some((p) => !isInside(folder, p)) || climbs(pattern) || climbs(glob)) {
      return deny("Only files in this workspace's folder can be read.");
    }

    if (input.tool_name === "Read" && file_path !== undefined) {
      const shown = relative(folder, resolve(folder, file_path)).split(sep).join("/");
      await report({ kind: "read-file", path: shown });
    }
    const allow: SyncHookJSONOutput = {
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    };
    return allow;
  };

const systemPromptFor = (workspace: TurnWorkspace) =>
  [
    `You're helping the owner of Courtyard with one area of their life: their "${workspace.name}" workspace.`,
    "You can read and search the files in this workspace's folder, your working directory, images included. You can't change anything or run commands. Read files when they help you answer.",
    workspace.contextFile === null
      ? "This workspace has no context file yet, so you know nothing about it beyond its files and what the owner tells you."
      : [
          "The workspace's context file is below. Facts are true now. Plans are decided but not done yet. Ideas are only being considered. Never describe a plan or an idea as something that has already happened.",
          `<context_file>\n${workspace.contextFile}\n</context_file>`,
        ].join("\n\n"),
  ].join("\n\n");

/** Everything said so far, then the new message last. */
const promptFor = (lines: readonly SessionLine[]) => {
  const newest = lines.at(-1)?.text ?? "";
  const earlier = lines.slice(0, -1);
  if (earlier.length === 0) return newest;
  const said = earlier
    .map((line) => `${line.speaker === "owner" ? "Owner" : "You"}: ${line.text}`)
    .join("\n\n");
  return `Earlier in this session:\n\n${said}\n\nThe owner's new message:\n\n${newest}`;
};

/**
 * Claude through the Agent SDK and the worker machine's own Claude Code sign-in, or an API key
 * (ADR 0003). Nothing outside this file knows how Claude is signed in or billed, and Courtyard
 * never reads, stores or logs the credentials.
 */
export const createClaudeProvider = (
  options: { claudeCode?: ClaudeCode; now?: () => number } = {},
): Provider => {
  const claudeCode = options.claudeCode ?? realClaudeCode;
  const now = options.now ?? Date.now;
  let cached: { at: number; status: ProviderStatus } | undefined;

  const checkStatus = async (): Promise<ProviderStatus> => {
    const unavailable = (reason: string): ProviderStatus => ({
      id,
      label: LABEL,
      available: false,
      reason,
    });
    let answer: unknown;
    try {
      answer = await Promise.race([
        claudeCode.check(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timed out")), CHECK_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch {
      return unavailable("Claude Code couldn't start on the worker machine.");
    }
    const parsed = CheckAnswer.safeParse(answer);
    if (!parsed.success)
      return unavailable("Claude Code answered in a way Courtyard doesn't understand.");
    const { account, models } = parsed.data;
    const signedIn = Boolean(
      account.email || account.subscriptionType || account.tokenSource || account.apiKeySource,
    );
    if (!signedIn) return unavailable(SIGNED_OUT);
    // The short names (default, opus, sonnet…) follow the newest models; pinned versions are left out.
    const offered = models.filter((m) => !m.value.startsWith("claude-"));
    return {
      id,
      label: LABEL,
      available: true,
      models: offered.map((m) => ({
        id: ModelId.parse(m.value),
        label: `Claude · ${m.displayName}`,
      })),
      capabilities: { readsFiles: true, codes: false, usesTools: false },
    };
  };

  return {
    id,

    status: async () => {
      if (cached && now() - cached.at < STATUS_TTL_MS) return cached.status;
      const status = await checkStatus();
      cached = { at: now(), status };
      return status;
    },

    runTurn: async (input) => {
      const folder = resolve(input.workspace.folder);
      let resetAt: string | undefined;
      let failure: FailureReason | undefined;
      let finished = false;

      try {
        const messages = claudeCode.run({
          prompt: promptFor(input.lines),
          options: {
            ...(input.model === "default" ? {} : { model: input.model }),
            cwd: folder,
            systemPrompt: systemPromptFor(input.workspace),
            // Isolation (ADR 0003): none of the machine's settings, memory, connectors or servers.
            settingSources: [],
            strictMcpConfig: true,
            mcpServers: {},
            env: isolatedEnv(),
            tools: READ_ONLY_TOOLS,
            allowedTools: READ_ONLY_TOOLS,
            permissionMode: "dontAsk",
            hooks: { PreToolUse: [{ hooks: [confineTo(folder, input.report)] }] },
            includePartialMessages: true,
            maxTurns: MAX_TURNS,
          },
        });

        for await (const message of messages) {
          const delta = TextDelta.safeParse(message);
          if (delta.success) {
            if (!delta.data.parent_tool_use_id) await input.emit(delta.data.event.delta.text);
            continue;
          }
          const limit = RateLimitEvent.safeParse(message);
          if (limit.success) {
            if (limit.data.rate_limit_info.status === "rejected") {
              resetAt = resetTimeFrom(limit.data.rate_limit_info.resetsAt);
              failure = { kind: "rate-limited", ...(resetAt ? { resetAt } : {}) };
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
            finished = true;
            if (result.data.is_error) failure ??= failureFor("unknown", resetAt);
          }
        }
      } catch (error) {
        // Claude Code itself failed (it couldn't start, or stopped). The details go to the
        // worker's log; the session gets plain words.
        console.error("Claude Code stopped:", error instanceof Error ? error.message : error);
        failure ??= {
          kind: "provider-unavailable",
          message: "Claude Code stopped unexpectedly on the worker machine.",
        };
      }

      if (!failure && !finished) failure = failureFor("unknown", resetAt);
      return failure ? err(failure) : ok(null);
    },
  };
};
