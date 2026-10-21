import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  createSdkMcpServer,
  type HookCallback,
  type Options,
  type Query,
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
  HelperId,
  ModelId,
  ProviderId,
  type ProviderStatus,
  SkillName,
  type UsageWindow,
} from "@courtyard/contract";
import { z } from "zod";
import { shownPath, staysInside } from "../auth/workspace-files/index.ts";
import { pageKey, pageRead, type SearchHit, turnSources } from "../features/sources/index.ts";
import {
  exists,
  listFolder,
  listSubfolders,
  makeTemporaryFolder,
  readBytes,
  readTextFile,
  removeFolder,
} from "../lib/files.ts";
import { err, ok, type Result } from "../lib/result.ts";
import {
  codeRefusalReason,
  HELPER_NOT_HERE,
  NO_HELPERS_OF_HELPERS,
  OUTSIDE_WORKSPACE,
  PAGE_NOT_ALLOWED,
  SKILL_NOT_HERE,
  UNCHECKED_REQUEST,
} from "../prompts/index.ts";
import {
  type AddedMessage,
  type AddedMessages,
  type CodePlugin,
  type CodeTurn,
  type CourtyardTool,
  createStatusKeeper,
  type HeardMeter,
  type HelperBranch,
  type HelperCode,
  type HelperTurn,
  jsonSchemaOf,
  type Provider,
  photosOf,
  type StatusCheck,
  type ToolConnection,
  type ToolContent,
  type ToolReply,
  type TurnInput,
  type UsageReading,
  type WebSearch,
} from "./index.ts";

const id = ProviderId.parse("claude");
/** Claude reads the workspace's files, saves to context, codes and uses tool connections. */
const CAPABILITIES: Capabilities = {
  readsFiles: true,
  codes: true,
  usesTools: true,
  savesContext: true,
  searchesWeb: true,
  steers: true,
};
const LABEL = "Claude";
/** Claude's own default (Opus 5.5 today) at High, as the owner chose it (#247). */
const STARTING_DEFAULT = { model: ModelId.parse("default"), effort: Effort.parse("high") };
/** Sonnet at Low, for a short errand such as the note a session leaves (#601, ADR 0032). */
const ERRAND = { model: ModelId.parse("sonnet"), effort: Effort.parse("low") };

/**
 * The two things the adapter needs from Claude Code, so tests can stand in for it. Answers come
 * back unparsed: the adapter checks every one with Zod, like any other edge.
 */
export type ClaudeCode = {
  /** Who is signed in, and the models their plan offers, without sending a prompt. */
  readonly check: (signal: AbortSignal) => Promise<unknown>;
  /**
   * How much of the plan's limits is used (#66), without sending a prompt: the Agent SDK's
   * experimental usage call, which may change, so its answer is checked like any other.
   */
  readonly usage: (signal: AbortSignal) => Promise<unknown>;
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
 * then each photo the turn carries as an image, in the order the text numbers them. On a turn the
 * owner can add to (#252), the input stays open: each message they add follows as it's sent, for
 * Claude Code to fold in at Claude's next step (`priority: "next"`), told to `sent`, until the
 * turn takes no more.
 */
async function* turnPrompt(turn: {
  framing: TurnInput["framing"];
  added: AddedMessages | null;
  sent: (added: AddedMessage) => void;
}): AsyncIterable<SDKUserMessage> {
  const { framing, added, sent } = turn;
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
  if (added === null) return;
  for (;;) {
    const more = await added.next();
    if (more === undefined) return;
    sent(more);
    yield {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: more.text }] },
      parent_tool_use_id: null,
      priority: "next",
    };
  }
}

/** The tools a planning workspace gets: looking at its files, never changing them (ADR 0003). */
const PLANNING_TOOLS = ["Read", "Glob", "Grep"];
/**
 * The tools a code session gets as well: editing files and running commands, each asked of the
 * worker first (ADR 0007), its task list, and loading the skills it was given (ADRs 0024, 0025).
 */
const CODING_TOOLS = ["Edit", "Write", "Bash", "TodoWrite", "Skill"];
/**
 * Starting helpers, Claude Code's own sub-agents (#117, ADR 0027): on a code turn that starts
 * them, never a Lead builder's (ADR 0031).
 */
const HELPER_TOOL = "Agent";
/**
 * How long Claude Code waits on the worker's say in a code session, which may be an approval the
 * owner answers in the morning (#171), or a heavy check's turn in the builds queue (#281): the
 * longest a timer can wait (about 24 days), so in practice no limit. Only a stop ends the wait
 * sooner.
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

/**
 * A tool connection's MCP server as Claude Code starts it (ADR 0023): its command on the worker
 * machine, its tools always offered, since a turn has no tool search to find them with.
 */
const connectionServer = (connection: ToolConnection) => ({
  type: "stdio" as const,
  command: connection.server.command,
  args: [...connection.server.args],
  alwaysLoad: true,
});

/** A tool connection's tool, by the name Claude Code calls it: `mcp__paper__get_screenshot`. */
const ConnectionTool = /^mcp__(.+?)__(.+)$/;

/** The tool connection a tool belongs to, and the tool by its own name, or `undefined`. */
const connectionCall = (
  connections: readonly ToolConnection[],
  toolName: string,
  input: unknown,
) => {
  const [, server, tool] = ConnectionTool.exec(toolName) ?? [];
  const connection = connections.find((each) => each.name === server);
  return connection === undefined || tool === undefined
    ? undefined
    : { connection, call: { tool, input } };
};

/** One part of a tool's result as Claude Code gives it to a hook: text, or an image either way. */
const ResultPart = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }),
  z.object({
    type: z.literal("image"),
    source: z.object({ type: z.literal("base64"), data: z.string(), media_type: z.string() }),
  }),
  z.unknown().transform(() => undefined),
]);
/** A tool's result: its parts, wrapped or not, or only text. Anything else counts as nothing. */
const ToolResult = z.union([
  z.array(ResultPart),
  z.object({ content: z.array(ResultPart) }).transform((result) => result.content),
  z.string().transform((text) => [{ type: "text" as const, text }]),
  z.unknown().transform(() => []),
]);

/** A tool's result that says it failed. */
const ToolError = z.object({ isError: z.literal(true) });

/** A tool's result as the worker reads it: its text, and each image as a data URL. */
const contentOf = (response: unknown): ToolContent[] =>
  ToolResult.parse(response).flatMap((part): ToolContent[] => {
    if (part === undefined) return [];
    if (part.type === "text") return [{ kind: "text", text: part.text }];
    const [type, data] =
      "source" in part ? [part.source.media_type, part.source.data] : [part.mimeType, part.data];
    return [{ kind: "image", dataUrl: `data:${type};base64,${data}` }];
  });

/**
 * Checked after every call to a tool connection's tool: its result goes to the worker (ADR
 * 0023), and anything the worker adds for a failed one goes to Claude.
 */
const handResults =
  (connections: readonly ToolConnection[], helpers: Helpers | null): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure") {
      return {};
    }
    // A helper's own, which tell the worker what it did (#117).
    const helper = await helperOf(helpers, input.agent_id);
    const found = connectionCall(
      helper?.connections ?? connections,
      input.tool_name,
      input.tool_input,
    );
    if (found === undefined) return {};
    const failed = input.hook_event_name === "PostToolUseFailure";
    const added = await found.connection.done({
      ...found.call,
      ok: !failed && !ToolError.safeParse(input.tool_response).success,
      content: failed ? [{ kind: "text", text: input.error }] : contentOf(input.tool_response),
    });
    return added === undefined
      ? {}
      : { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: added } };
  };

/**
 * How long a status check may take before it counts as no answer: longer until Claude Code has
 * answered once, since everything starts at once after the worker does (#282).
 */
const CHECK_TIMEOUTS = { firstMs: 30_000, laterMs: 15_000 };
/** A planning turn's limit on Claude's round trips. A code turn has none (ADR 0025). */
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
    Object.entries(process.env).filter(
      // Nor the folders of plugins the owner's own Claude Code loads (ADR 0024).
      // Nor a model the machine gives its own helpers (#117): a session's use the session's.
      ([key]) =>
        !key.startsWith("COURTYARD_") &&
        key !== "CLAUDE_CODE_PLUGIN_DIRS" &&
        key !== "CLAUDE_CODE_SUBAGENT_MODEL",
    ),
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
/** Where a repository keeps its own Claude Code helpers (ADR 0022), each in a Markdown file. */
const PROJECT_HELPERS = join(".claude", "agents");
/**
 * The types of helper Claude Code has itself that a code session may start (#117): general
 * purpose, exploring a codebase and planning. Never the machine's own (ADR 0003).
 */
const BUILT_IN_HELPERS = ["general-purpose", "Explore", "Plan"];
/** A helper file's frontmatter: the text between its opening and closing `---` lines. */
const Frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/;
/** A helper's type in its frontmatter, Claude Code's name for it: `name: code-reviewer`. */
const HelperName = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m;

/** The types of the repository's own helpers (ADR 0022), by the name each file gives it. */
const projectHelpers = async (worktree: string) => {
  const files = await listFolder(join(worktree, PROJECT_HELPERS));
  const names: string[] = [];
  for (const file of files.ok ? files.value : []) {
    if (!file.endsWith(".md")) continue;
    const text = await readTextFile(join(worktree, PROJECT_HELPERS, file));
    const front = text.ok ? Frontmatter.exec(text.value ?? "")?.[1] : undefined;
    const name = HelperName.exec(front ?? "")?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
};

/**
 * What a code session takes from its repository (ADR 0022): Claude Code's project settings
 * source, so its `CLAUDE.md` (and the `AGENTS.md` that points to) and its settings, and only the
 * repository's own skills and helpers. The machine's user and local settings, memory and
 * connectors stay off, as on every turn. The project settings can enable plugins, so Claude Code
 * looks for installed plugins in `noPlugins`, an empty folder of the turn's own, never the
 * machine's. A command Claude runs in the background is the worker's task (#182), never Claude
 * Code's (`askWorker`). Matt Pocock's skills come as one local
 * plugin, Courtyard's pinned copy, with only the skills it's given turned on (ADR 0024). Every
 * helper works on the session's model, whatever its type or the model asks for (#117).
 */
const projectSetup = async (
  worktree: string,
  noPlugins: string,
  plugin: CodePlugin | null,
): Promise<{
  options: Partial<Options> & Pick<Options, "env">;
  projectSkills: string[];
  helperTypes: string[];
}> => {
  const folders = await listSubfolders(join(worktree, PROJECT_SKILLS));
  const projectSkills = [];
  for (const name of folders.ok ? folders.value : []) {
    const found = await exists(join(worktree, PROJECT_SKILLS, name, "SKILL.md"));
    if (found.ok && found.value) projectSkills.push(name);
  }
  return {
    options: {
      settingSources: ["project"],
      skills: [
        ...projectSkills,
        ...(plugin?.skills.map((skill) => `${plugin.name}:${skill}`) ?? []),
      ],
      ...(plugin === null ? {} : { plugins: [{ type: "local", path: plugin.folder }] }),
      env: {
        CLAUDE_CODE_PLUGIN_CACHE_DIR: noPlugins,
        CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
        // Claude's background flag starts a task (#182), whatever the machine's own setting says.
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: undefined,
        // Every helper on the session's model (#117): Claude Code then ignores the model a
        // helper's type names (Explore's Haiku) and any the Agent call asks for.
        CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
      },
    },
    projectSkills,
    helperTypes: [...BUILT_IN_HELPERS, ...(await projectHelpers(worktree))],
  };
};

/** The Skill tool's input as Claude Code sends it: which skill, and what's passed to it. */
const SkillInput = z.strictObject({ skill: z.string(), args: z.string().optional() });

/**
 * The skill a code turn's Skill tool call loads, when it's one the turn turned on, with where it
 * comes from: one of Matt's (`mattpocock-skills:tdd`, or its name alone) or the repository's own.
 */
const skillLoaded = (
  skills: { readonly project: readonly string[]; readonly plugin: CodePlugin | null },
  input: unknown,
): { name: SkillName; source: "matt" | "project" } | undefined => {
  const parsed = SkillInput.safeParse(input);
  if (!parsed.success) return undefined;
  const { plugin, project } = skills;
  const asked = parsed.data.skill;
  const named = (name: string, source: "matt" | "project") => {
    const skill = SkillName.safeParse(name);
    return skill.success ? { name: skill.data, source } : undefined;
  };
  if (plugin !== null && asked.startsWith(`${plugin.name}:`)) {
    const name = asked.slice(plugin.name.length + 1);
    return plugin.skills.some((skill) => skill === name) ? named(name, "matt") : undefined;
  }
  if (project.includes(asked)) return named(asked, "project");
  return plugin?.skills.some((skill) => skill === asked) ? named(asked, "matt") : undefined;
};

/**
 * One of Matt's skills' own files, as its read is reported: the skill (its folder in his
 * `skills/<group>/<name>/`) and the file's path inside it. `undefined` for one in no skill.
 */
const skillFileIn = (plugin: CodePlugin, path: string) => {
  const [top, , name, ...rest] = shownPath(plugin.folder, path).split("/");
  const skill = SkillName.safeParse(name);
  return top === "skills" && skill.success && rest.length > 0
    ? { name: skill.data, path: rest.join("/") }
    : undefined;
};

/**
 * Starts Claude Code with a prompt that never arrives, asks it something, then stops it: what
 * Courtyard asks of Claude Code outside a turn.
 */
const askClaudeCode = async <T>(signal: AbortSignal, ask: (session: Query) => Promise<T>) => {
  const stop = new AbortController();
  const stopNow = () => stop.abort();
  signal.addEventListener("abort", stopNow);
  const silence: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  };
  const session = query({
    prompt: silence,
    options: { ...isolatedOptions(), abortController: stop },
  });
  try {
    return await ask(session);
  } finally {
    signal.removeEventListener("abort", stopNow);
    stop.abort();
  }
};

/** Claude Code as it really is: the Agent SDK, with this machine's sign-in. */
const realClaudeCode: ClaudeCode = {
  check: (signal) =>
    askClaudeCode(signal, async (session) => ({
      account: await session.accountInfo(),
      models: await session.supportedModels(),
    })),
  // Only the plan's limits: the scan of the machine's transcripts is skipped.
  usage: (signal) =>
    askClaudeCode(signal, (session) =>
      session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
    ),
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
  const named = defaultsTo(model);
  return named ? `${LABEL} · Default (${named})` : `${LABEL} · ${model.displayName}`;
};

/**
 * The model Claude Code's Default is, when its description says: "Use the default model
 * (currently Opus 5.5) · …", or "Opus 5.5 · …".
 */
const defaultsTo = (model: z.infer<typeof ClaudeModel>) => {
  if (model.value !== "default") return undefined;
  const [first, ...rest] = model.description.split(" · ");
  const now = /\(currently ([^)]+)\)/.exec(first ?? "")?.[1]?.trim();
  if (now !== undefined) return now || undefined;
  return rest.length > 0 ? first?.trim() || undefined : undefined;
};

/** A model on its own, where there's little room: Default by the model it is, if known. */
const nameFor = (model: z.infer<typeof ClaudeModel>) =>
  model.value === "default" ? (defaultsTo(model) ?? "Default") : model.displayName;

const TextDelta = z.object({
  type: z.literal("stream_event"),
  parent_tool_use_id: z.string().nullable().optional(),
  event: z.object({
    type: z.literal("content_block_delta"),
    delta: z.object({ type: z.literal("text_delta"), text: z.string() }),
  }),
});
/** One of Claude's messages starting: its own, or a subagent's (with the tool use it's under). */
const MessageStart = z.object({
  type: z.literal("stream_event"),
  parent_tool_use_id: z.string().nullable().optional(),
  event: z.object({ type: z.literal("message_start") }),
});
/**
 * What goes between the text of two of Claude's messages: a new paragraph, as Claude shows it,
 * so what it writes between what it does never runs together (#200).
 */
const BETWEEN_MESSAGES = "\n\n";
const RateLimitEvent = z.object({
  type: z.literal("rate_limit_event"),
  rate_limit_info: z.object({
    status: z.string(),
    resetsAt: z.number().optional(),
    /** The window it's about, when it says; anything new or unreadable is none of Courtyard's. */
    rateLimitType: z.string().optional().catch(undefined),
    /** How much of that window is used, as a fraction. */
    utilization: z.number().optional().catch(undefined),
  }),
});
/** Claude's plan windows as Courtyard shows them (#66), by Claude Code's names for them. */
const CLAUDE_WINDOWS: Partial<Record<string, UsageWindow>> = {
  five_hour: "five-hour",
  seven_day: "weekly",
};

/** One window in Claude Code's usage answer: percent used, and when it resets. */
const UsageWindowAnswer = z
  .object({
    utilization: z.number().nullable(),
    resets_at: z.string().nullable().optional(),
  })
  .nullable()
  .optional();
/**
 * The plan's limits in Claude Code's usage answer (#66). Overage and the per-app window are left
 * out; a per-model family's weekly window is named as Claude Code names it.
 */
const UsageAnswer = z.object({
  rate_limits_available: z.boolean(),
  rate_limits: z
    .object({
      five_hour: UsageWindowAnswer,
      seven_day: UsageWindowAnswer,
      seven_day_opus: UsageWindowAnswer,
      seven_day_sonnet: UsageWindowAnswer,
      model_scoped: z
        .array(
          z.object({
            display_name: z.string().min(1),
            utilization: z.number().nullable(),
            resets_at: z.string().nullable().optional(),
          }),
        )
        .optional()
        .catch(undefined),
    })
    .nullable(),
});

/** A reset time as Claude Code wrote it, as an ISO time, or nothing when it isn't one. */
const resetFrom = (resetsAt: string | null | undefined) => {
  const at = resetsAt === null || resetsAt === undefined ? Number.NaN : Date.parse(resetsAt);
  return Number.isNaN(at) ? {} : { resetAt: new Date(at).toISOString() };
};

/** Claude Code's usage answer as a reading of the plan (#66), or nothing when it can't be read. */
const usageReadingOf = (answer: unknown): UsageReading | undefined => {
  const parsed = UsageAnswer.safeParse(answer);
  if (!parsed.success) return undefined;
  const limits = parsed.data.rate_limits;
  if (!parsed.data.rate_limits_available || limits === null) return { kind: "no-plan" };
  const meters = (
    [
      ["five-hour", limits.five_hour],
      ["weekly", limits.seven_day],
    ] as const
  ).flatMap(([window, found]) =>
    found?.utilization === null || found?.utilization === undefined
      ? []
      : [{ window, used: found.utilization, ...resetFrom(found.resets_at) }],
  );
  const families = [
    { name: "Opus", found: limits.seven_day_opus },
    { name: "Sonnet", found: limits.seven_day_sonnet },
    ...(limits.model_scoped ?? []).map((each) => ({ name: each.display_name, found: each })),
  ];
  const models = families.flatMap(({ name, found }) =>
    found?.utilization === null || found?.utilization === undefined
      ? []
      : [{ name, used: found.utilization, ...resetFrom(found.resets_at) }],
  );
  return { kind: "plan", meters, models };
};

/** What a rate limit event says of one of the plan's windows (#66), when it says anything. */
const heardMeterOf = (info: z.infer<typeof RateLimitEvent>["rate_limit_info"]) => {
  const window = info.rateLimitType === undefined ? undefined : CLAUDE_WINDOWS[info.rateLimitType];
  if (window === undefined || info.utilization === undefined) return undefined;
  const resetAt = resetTimeFrom(info.resetsAt);
  return {
    window,
    // A fraction, as Claude's API sends it, in percent to a tenth.
    used: Math.round(info.utilization * 1000) / 10,
    ...(resetAt === undefined ? {} : { resetAt }),
  };
};
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
    "cloud_credential_error",
    "unknown",
  ])
  .catch("unknown");
type AnswerError = z.infer<typeof AnswerError>;
/**
 * An assistant message that failed, and what it says. Ordinary assistant messages have no `error`
 * at all; the field has to be there before its value is read, or every answer would count as a
 * failure.
 */
const AssistantError = z.object({
  type: z.literal("assistant"),
  error: z.string().pipe(AnswerError),
  message: z
    .object({ content: z.array(z.unknown()) })
    .optional()
    .catch(undefined),
});
const ResultMessage = z.object({
  type: z.literal("result"),
  /**
   * The owner's messages Claude Code still has to answer (#252): more than none means another
   * answer, and result, follows.
   */
  queued_turn_count: z.number().optional().catch(undefined),
  is_error: z.boolean().optional(),
  /** The HTTP status Claude's API answered with, when a turn ended on an error from it. */
  api_error_status: z.number().nullable().optional().catch(undefined),
  /** A one-off question's answer, in the shape it asked for. */
  structured_output: z.unknown().optional(),
});
/** Claude Code trying a request again; with no status, it got no answer at all (#200). */
const RetryMessage = z.object({
  type: z.literal("system"),
  subtype: z.literal("api_retry"),
  error_status: z.number().nullable(),
});

const SIGNED_OUT =
  "Claude Code isn't logged in on the worker machine. Run `claude` there and log in, or set an API key.";
/** Said only until Claude Code has answered once: after that, a check out of time keeps its answer. */
const NO_ANSWER = "Claude Code didn't answer in time. The worker machine may be busy.";

/** Plain words for why a turn failed (#200), as the session shows them. */
const FAILED = {
  signInExpired: {
    kind: "provider-unavailable",
    message: "Claude's sign-in expired. Retry in a minute, or sign in again from Connections.",
  },
  noConnection: {
    kind: "provider-unavailable",
    message:
      "Courtyard couldn't reach Claude. Check the worker machine's internet connection, then retry.",
  },
  overloaded: { kind: "unknown", message: "Claude is overloaded right now. Retry in a moment." },
  account: {
    kind: "provider-unavailable",
    message: "Claude's account needs attention. Check it at claude.ai.",
  },
  other: { kind: "unknown", message: "Claude couldn't answer this time." },
} as const satisfies Record<string, FailureReason>;

/** What Claude Code says when its sign-in is refused, expired or couldn't be refreshed. */
const SIGN_IN_WORDS = /oauth|authenticat|\/login|api key/i;
/** What Claude Code says when it couldn't reach Claude at all. */
const OFFLINE_WORDS = /connection error|unable to connect|connection refused|fetch failed/i;
/** What Claude Code says when Claude is too busy to answer. */
const BUSY_WORDS = /overloaded|at capacity/i;

/** `resetsAt` arrives as a Unix time; accept seconds or milliseconds. */
const resetTimeFrom = (resetsAt: number | undefined) =>
  resetsAt === undefined
    ? undefined
    : new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString();

/** What a run's messages said about a failure: its words and HTTP status, as far as they said. */
type Heard = {
  resetAt?: string | undefined;
  /** The failed answer's words, which only ever pick the reason, never reach the owner. */
  said?: string;
  status?: number | null | undefined;
  /** Claude Code's last retry got no answer at all. */
  offline?: boolean;
};

/**
 * Plain words for each way Claude Code reports a failed answer. An error it gives no kind of its
 * own (a server error, say) is named by what it said, and only the rest is the generic line.
 */
const failureFor = (error: AnswerError, heard: Heard): FailureReason => {
  const { resetAt, said = "", status } = heard;
  switch (error) {
    case "rate_limit":
      return { kind: "rate-limited", ...(resetAt ? { resetAt } : {}) };
    case "authentication_failed":
    case "cloud_credential_error":
      return FAILED.signInExpired;
    case "oauth_org_not_allowed":
    case "billing_error":
    case "account_on_hold":
    case "verification_required":
      return FAILED.account;
    case "overloaded":
      return FAILED.overloaded;
    case "unknown":
      if (status === 401 || status === 403 || SIGN_IN_WORDS.test(said)) return FAILED.signInExpired;
      if (status === 529 || BUSY_WORDS.test(said)) return FAILED.overloaded;
      if (heard.offline === true || OFFLINE_WORDS.test(said)) return FAILED.noConnection;
      return FAILED.other;
  }
};

/** What a run's messages have said so far about how it went. */
type Progress = {
  resetAt?: string | undefined;
  /** Claude Code's last retry got no answer at all. */
  offline?: boolean;
  failure?: FailureReason;
  result?: z.infer<typeof ResultMessage>;
};

/** The words of a failed answer. */
const saidIn = (message: z.infer<typeof AssistantError>["message"]) =>
  (message?.content ?? [])
    .flatMap((block) => {
      const text = z.object({ type: z.literal("text"), text: z.string() }).safeParse(block);
      return text.success ? [text.data.text] : [];
    })
    .join("\n");

/**
 * Notes what a message says about the run: a usage limit, a retry, a failed answer, or its
 * result.
 */
const noteProgress = (
  message: unknown,
  progress: Progress,
  heardUsage?: (meter: HeardMeter) => void,
) => {
  const limit = RateLimitEvent.safeParse(message);
  if (limit.success) {
    const meter = heardMeterOf(limit.data.rate_limit_info);
    if (meter !== undefined) heardUsage?.(meter);
    if (limit.data.rate_limit_info.status === "rejected") {
      progress.resetAt = resetTimeFrom(limit.data.rate_limit_info.resetsAt);
      progress.failure = failureFor("rate_limit", progress);
    }
    return;
  }
  const retry = RetryMessage.safeParse(message);
  if (retry.success) {
    progress.offline = retry.data.error_status === null;
    return;
  }
  const assistant = AssistantError.safeParse(message);
  if (assistant.success) {
    progress.failure ??= failureFor(assistant.data.error, {
      ...progress,
      said: saidIn(assistant.data.message),
    });
    return;
  }
  const result = ResultMessage.safeParse(message);
  if (result.success) {
    progress.result = result.data;
    if (result.data.is_error) {
      progress.failure ??= failureFor("unknown", {
        ...progress,
        status: result.data.api_error_status,
      });
    }
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
/** A task list: it touches nothing outside Claude Code, so only its shape is checked. */
const TodoWriteInput = z.strictObject({ todos: z.array(z.unknown()) });
/**
 * Starting a helper (#117): what it's for in a few words, its task and its type, and for one that
 * writes code, a worktree of its own (#395), which Courtyard makes (`makeWorktree`). Strict, so a
 * helper in a folder it names, or elsewhere, is refused rather than let through unchecked.
 */
const AgentInput = z.strictObject({
  description: z.string(),
  prompt: z.string(),
  subagent_type: z.string().optional(),
  model: z.string().optional(),
  run_in_background: z.boolean().optional(),
  name: z.string().optional(),
  isolation: z.literal("worktree").optional(),
});

/** What Claude Code hands back of a helper that worked in a worktree of its own (#395). */
const InWorktree = z.object({ worktreePath: z.string() });

/**
 * The name Claude Code gives a helper's own worktree when it asks for one (#395): `agent-` and
 * the id it gave the helper, which tags each of its tool calls.
 */
const AgentWorktree = /^agent-(.+)$/;

/** Claude Code saying a helper is running (#117): the id it gave it, and its Agent call's. */
const TaskStarted = z.object({
  type: z.literal("system"),
  subtype: z.literal("task_started"),
  task_id: z.string(),
  tool_use_id: z.string(),
});

/**
 * A code turn's helpers (#117), as the hooks keep track of them: what each one running does its
 * work through, by the id of the Agent call that started it, and that call's id by the id Claude
 * Code gave the helper, which tags each of its tool calls.
 */
type Helpers = {
  readonly running: Map<string, HelperTurn>;
  readonly callOf: Map<string, string>;
  /** The types it may start: Claude Code's own, and the repository's. */
  readonly types: readonly string[];
  /**
   * The worktrees Courtyard made for helpers that write code (#395), by the id Claude Code gave
   * the helper each is for, until that helper is given it.
   */
  readonly made: Map<string, HelperBranch>;
};

/**
 * Gives a helper the worktree Courtyard made for it (#395), once it's known which helper that
 * is: by the id Claude Code gave it, or by the folder Claude Code runs it in. Before its first
 * tool call is decided, so that's decided in its own worktree, or as it finishes.
 */
const giveWorktree = async (
  helpers: Helpers,
  given: { helper: HelperTurn; agent: string | undefined; cwd: string | undefined },
) => {
  const { agent, cwd } = given;
  for (const [madeFor, own] of helpers.made) {
    if (madeFor !== agent && (cwd === undefined || !samePath(own.worktree, cwd))) continue;
    helpers.made.delete(madeFor);
    await given.helper.workIn(own);
    return;
  }
};

/** Whether two paths name the same folder, as Windows reads them too (case aside). */
const samePath = (one: string, other: string) =>
  process.platform === "win32"
    ? resolve(one).toLowerCase() === resolve(other).toLowerCase()
    : resolve(one) === resolve(other);

/** How long a helper's tool call waits to hear which helper it is, checking this often. */
const HELPER_KNOWN = { checks: 20, everyMs: 50 };

/**
 * The helper making a tool call, from the id Claude Code tags it with: the one it started as, or
 * the only helper running. Waits a moment for word of which it is. `undefined` for the model's
 * own call, or one from a helper it can't tell.
 */
const helperOf = async (helpers: Helpers | null, agent: string | undefined) => {
  if (helpers === null || agent === undefined) return undefined;
  for (let check = 0; check < HELPER_KNOWN.checks && !helpers.callOf.has(agent); check += 1) {
    if (helpers.running.size <= 1) break;
    await wait(HELPER_KNOWN.everyMs);
  }
  const call = helpers.callOf.get(agent);
  if (call !== undefined) return helpers.running.get(call);
  const [only, ...others] = helpers.running.values();
  return others.length === 0 ? only : undefined;
};

/** A helper's report as Claude Code hands its Agent call's result back: its text. */
const reportOf = (response: unknown) =>
  contentOf(response)
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();

/**
 * Checked after every Agent call (#117): the helper it started has finished, so the worker hears
 * its report, or what stopped it. One that worked on a branch of its own has it merged back
 * (#395), and Claude is told how that went beside its report.
 */
const noteHelperDone =
  (helpers: Helpers): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure") {
      return {};
    }
    const helper = input.tool_name === "Agent" ? helpers.running.get(input.tool_use_id) : undefined;
    if (helper === undefined) return {};
    helpers.running.delete(input.tool_use_id);
    // One that finished before any tool call of its own is given its worktree now.
    const own =
      input.hook_event_name === "PostToolUse"
        ? InWorktree.safeParse(input.tool_response)
        : undefined;
    if (own?.success) {
      await giveWorktree(helpers, { helper, agent: undefined, cwd: own.data.worktreePath });
    }
    const note = await helper.finished(
      input.hook_event_name === "PostToolUse" ? reportOf(input.tool_response) : input.error,
    );
    return note === undefined
      ? {}
      : { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: note } };
  };

/**
 * Claude Code asking for a worktree for a helper that writes code (#395): Courtyard makes it
 * (`CodeTurn.branchOff`), beside the session's worktree and never in the repository's
 * `.claude/worktrees`, and hands Claude Code its folder to run the helper in. Which helper it's for
 * is known by the id in its name, and it's given to that helper before its first tool call. One
 * that can't be made fails the helper's start, with git's reason in the worker's log.
 */
const makeWorktree =
  (helpers: Helpers, code: CodeTurn): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "WorktreeCreate") return {};
    const made = await code.branchOff();
    if (!made.ok) {
      console.error("A helper's worktree couldn't be made:", made.error);
      return {};
    }
    helpers.made.set(AgentWorktree.exec(input.name)?.[1] ?? input.name, made.value);
    return {
      hookSpecificOutput: { hookEventName: "WorktreeCreate", worktreePath: made.value.worktree },
    };
  };

/**
 * The worker's say on a code session's edit or command (ADR 0007): what it answers, or
 * `undefined` for a tool that neither edits nor runs anything.
 */
const askWorker = async (
  code: HelperCode,
  tool: string,
  input: unknown,
): Promise<Result<null, string> | undefined> => {
  const unchecked = err(UNCHECKED_REQUEST);
  switch (tool) {
    case "Edit":
    case "Write": {
      const edit = (tool === "Edit" ? EditInput : WriteInput).safeParse(input);
      return edit.success ? code.edit(edit.data.file_path) : unchecked;
    }
    case "Bash": {
      const bash = BashInput.safeParse(input);
      if (!bash.success) return unchecked;
      // One to run in the background is the worker's to run, as a task that outlives the turn
      // (#182): Claude Code never runs it, and Claude is told it started, or why it didn't.
      if (bash.data.run_in_background === true) {
        const started = await code.task(bash.data.command, bash.data.description);
        return err(started.ok ? started.value : started.error);
      }
      return code.run(bash.data.command, bash.data.description);
    }
    default:
      return undefined;
  }
};

/**
 * Checked after every command in a code session, however it ended: the worker hears it has ended,
 * so a heavy check frees its place in the builds queue (#281).
 */
const noteEnded =
  (code: CodeTurn): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure") {
      return {};
    }
    if (input.tool_name !== "Bash") return {};
    const bash = BashInput.safeParse(input.tool_input);
    if (bash.success) code.ran(bash.data.command);
    return {};
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

/** A session id as Claude Code makes one: never a path of its own. */
const CLAUDE_SESSION_ID = /^[\w-]+$/;

/**
 * Where Claude Code saved this session's tool output too long to hand over inline (#568): the
 * `tool-results` folder in the session's own folder, beside its transcript. Named by the
 * session's id, so no other session's saved output is in reach. A helper's transcript sits in
 * `<session>/subagents/`, and its output is saved in the same place.
 */
const savedOutputOf = (session: { session_id: string; transcript_path: string }) => {
  const id = session.session_id;
  if (!CLAUDE_SESSION_ID.test(id) || !isAbsolute(session.transcript_path)) return undefined;
  const transcriptFolder = dirname(session.transcript_path);
  const own =
    basename(session.transcript_path) === `${id}.jsonl`
      ? join(transcriptFolder, id)
      : basename(transcriptFolder) === "subagents" && basename(dirname(transcriptFolder)) === id
        ? dirname(transcriptFolder)
        : undefined;
  return own === undefined ? undefined : join(own, "tool-results");
};

const decision = (allowed: boolean, reason?: string): SyncHookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: allowed ? "allow" : "deny",
    ...(reason ? { permissionDecisionReason: reason } : {}),
  },
});

/**
 * Starts a helper the model asked for (#117), once the worker gives it a place: only one of the
 * types the turn may start, only from the model itself, never in the background, and always on
 * the session's model, so any model the call names is dropped.
 */
const startHelper = async (start: {
  helpers: Helpers;
  /** The worker's start of a helper, on a turn that starts them. */
  start: NonNullable<CodeTurn["helper"]>;
  input: { tool_input: unknown; tool_use_id: string; agent_id?: string | undefined };
}): Promise<SyncHookJSONOutput> => {
  const { helpers, input } = start;
  if (input.agent_id !== undefined) return decision(false, NO_HELPERS_OF_HELPERS);
  const agent = AgentInput.safeParse(input.tool_input);
  if (!agent.success) return decision(false, UNCHECKED_REQUEST);
  const { model: _, ...asked } = agent.data;
  const type = asked.subagent_type ?? "general-purpose";
  if (!helpers.types.includes(type)) return decision(false, HELPER_NOT_HERE);
  // One that writes code asks for a worktree of its own (#395), which Courtyard makes when
  // Claude Code asks for it (`makeWorktree`).
  const helper = await start.start({
    id: HelperId.parse(input.tool_use_id),
    // Named by what the model said it's for, or by its type when it said nothing.
    name: asked.description.trim() || type,
  });
  if (helper === undefined) return decision(false, codeRefusalReason({ kind: "stopped" }));
  helpers.running.set(input.tool_use_id, helper);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      // A turn ends only once its helpers have finished, so none runs in the background.
      updatedInput: { ...asked, run_in_background: false },
    },
  };
};

/**
 * Checked before every tool call, and the only way one is allowed: none are pre-approved, so
 * anything this doesn't allow is refused, including when it fails. Only the planning tools, only
 * inside the workspace folder once symlinks are followed (and reading the output Claude Code saved
 * for this session's own calls), and Courtyard's own tools offered this turn, which touch nothing
 * themselves. In a code session, edits and commands too, each as the
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
    /** The tool connections the turn offers, each call to one asked of the worker (ADR 0023). */
    connections: readonly ToolConnection[];
    /** A code turn's repository skills, turned on by name (ADR 0022). */
    projectSkills: readonly string[];
    /** A code turn's helpers (#117), each of whose calls is decided as its own. */
    helpers: Helpers | null;
  }): HookCallback =>
  async (input) => {
    const { courtyardTools, web, helpers } = confine;
    try {
      if (input.hook_event_name !== "PreToolUse") return {};
      // A helper's call goes through the same checks as the model's, told as its own (#117).
      const helper = await helperOf(helpers, input.agent_id);
      // One that writes code works in a worktree of its own once it has one (#395).
      if (helper !== undefined && helpers !== null) {
        await giveWorktree(helpers, { helper, agent: input.agent_id, cwd: input.cwd });
      }
      const folder = helper === undefined ? confine.folder : resolve(helper.code.worktree);
      const report = helper?.report ?? confine.report;
      const code = helper?.code ?? confine.code;
      const connections = helper?.connections ?? confine.connections;
      const startsHelpers = confine.code?.helper ?? null;
      if (startsHelpers !== null && helpers !== null && input.tool_name === "Agent") {
        return await startHelper({ helpers, start: startsHelpers, input });
      }
      if (courtyardTools.includes(input.tool_name)) return decision(true);
      const connected = connectionCall(connections, input.tool_name, input.tool_input);
      if (connected !== undefined) {
        const checked = await connected.connection.check(connected.call);
        return checked.ok ? decision(true) : decision(false, checked.error);
      }
      const asked =
        code === null ? undefined : await askWorker(code, input.tool_name, input.tool_input);
      if (asked !== undefined) return asked.ok ? decision(true) : decision(false, asked.error);
      if (code !== null && input.tool_name === "Skill") {
        const skills = { project: confine.projectSkills, plugin: code.plugin };
        const loaded = skillLoaded(skills, input.tool_input);
        if (loaded === undefined) return decision(false, SKILL_NOT_HERE);
        await report({ kind: "skill-loaded", ...loaded });
        return decision(true);
      }
      if (code !== null && input.tool_name === "TodoWrite") {
        if (!TodoWriteInput.safeParse(input.tool_input).success) {
          return decision(false, UNCHECKED_REQUEST);
        }
        await report({ kind: "updated-tasks" });
        return decision(true);
      }
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

      // A code turn reads the skills of Matt's it loaded from Courtyard's copy (ADR 0024).
      const plugin = code?.plugin ?? null;
      if (plugin !== null && reach.paths.length > 0 && (await staysInside(plugin.folder, reach))) {
        const file =
          "readsFile" in reach && reach.readsFile !== undefined
            ? skillFileIn(plugin, reach.readsFile)
            : undefined;
        if (file !== undefined) await report({ kind: "skill-file-read", ...file });
        return decision(true);
      }

      // A command's output too long to hand over is read from where Claude Code saved it (#568).
      const saved = savedOutputOf(input);
      if (
        saved !== undefined &&
        "readsFile" in reach &&
        reach.readsFile !== undefined &&
        isAbsolute(reach.readsFile) &&
        (await staysInside(saved, reach))
      ) {
        return decision(true);
      }

      if (!(await staysInside(folder, reach))) return decision(false, OUTSIDE_WORKSPACE);

      if ("readsFile" in reach && reach.readsFile !== undefined) {
        await report({ kind: "read-file", path: shownPath(folder, reach.readsFile) });
      }
      return decision(true);
    } catch {
      return decision(false, UNCHECKED_REQUEST);
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
  options: {
    claudeCode?: ClaudeCode;
    now?: () => number;
    checkTimeouts?: { firstMs: number; laterMs: number };
  } = {},
): Provider => {
  const claudeCode = options.claudeCode ?? realClaudeCode;
  const now = options.now ?? Date.now;
  const timeouts = options.checkTimeouts ?? CHECK_TIMEOUTS;
  /** Whether Claude Code has answered a check since the worker started. */
  let answeredYet = false;

  const checkStatus = async (): Promise<StatusCheck> => {
    const unavailable = (reason: string): ProviderStatus => ({
      id,
      label: LABEL,
      available: false,
      reason,
    });
    const answered = (status: ProviderStatus): StatusCheck => {
      answeredYet = true;
      return { kind: "answered", status };
    };
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), answeredYet ? timeouts.laterMs : timeouts.firstMs);
    let answer: unknown;
    try {
      answer = await Promise.race([
        claudeCode.check(stop.signal),
        new Promise((_, reject) =>
          stop.signal.addEventListener("abort", () => reject(new Error("timed out"))),
        ),
      ]);
    } catch {
      // Out of time is no answer, which keeps the last good one; failing to start is an answer.
      return stop.signal.aborted
        ? { kind: "no-answer", status: unavailable(NO_ANSWER) }
        : answered(unavailable("Claude Code couldn't start on the worker machine."));
    } finally {
      clearTimeout(timer);
      stop.abort();
    }

    const parsed = CheckAnswer.safeParse(answer);
    if (!parsed.success) {
      return answered(unavailable("Claude Code answered in a way Courtyard doesn't understand."));
    }
    const { account, models } = parsed.data;
    const signedIn = Boolean(
      account.email || account.subscriptionType || account.tokenSource || account.apiKeySource,
    );
    if (!signedIn) return answered(unavailable(SIGNED_OUT));
    // The short names (default, opus, sonnet…) follow the newest models; pinned versions are left out.
    const offered = models.flatMap((m) => {
      const modelId = ModelId.safeParse(m.value);
      return modelId.success && !m.value.startsWith("claude-")
        ? [
            {
              id: modelId.data,
              label: labelFor(m),
              name: nameFor(m),
              ...(m.value === "default" ? { followsDefault: true as const } : {}),
              efforts: effortsOf(m),
            },
          ]
        : [];
    });
    return answered({
      id,
      label: LABEL,
      available: true,
      models: offered,
      capabilities: CAPABILITIES,
    });
  };
  const keptStatus = createStatusKeeper({ check: checkStatus, now });

  /** The plan's usage from Claude Code (#66), or nothing when it fails or takes too long. */
  const readUsage = async (): Promise<UsageReading | undefined> => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), timeouts.laterMs);
    try {
      const answer = await Promise.race([
        claudeCode.usage(stop.signal),
        new Promise((_, reject) =>
          stop.signal.addEventListener("abort", () => reject(new Error("timed out"))),
        ),
      ]);
      return usageReadingOf(answer);
    } catch {
      // The call is experimental: when it fails, what turns hear is all there is.
      return undefined;
    } finally {
      clearTimeout(timer);
      stop.abort();
    }
  };

  return {
    id,
    capabilities: CAPABILITIES,
    startingDefault: STARTING_DEFAULT,
    errand: ERRAND,
    status: keptStatus.status,
    readUsage,

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
      const { code, connections } = input;
      const courtyardTools = tools.map((offered) => courtyardTool(offered.name));
      const web = webTurnFor(input.framing.webSearch);
      let answer = "";
      const noPlugins = code === null ? undefined : await makeTemporaryFolder("courtyard-plugins-");
      if (noPlugins !== undefined && !noPlugins.ok) {
        input.signal.removeEventListener("abort", stopClaudeCode);
        return err({ kind: "unknown", message: "Claude Code couldn't be set up for this turn." });
      }
      const setup =
        code === null || noPlugins === undefined
          ? undefined
          : await projectSetup(folder, noPlugins.value, code.plugin);
      const helpers: Helpers | null =
        setup === undefined || code?.helper === null
          ? null
          : { running: new Map(), callOf: new Map(), types: setup.helperTypes, made: new Map() };
      // What the owner added that's gone to Claude Code, read once Claude's next message starts.
      const unread: AddedMessage[] = [];
      try {
        const messages = claudeCode.run({
          prompt: turnPrompt({
            framing: input.framing,
            added: input.added,
            sent: (added) => unread.push(added),
          }),
          options: {
            ...isolatedOptions(),
            ...(setup === undefined || code === null
              ? {}
              : // Its commands' git and gh use Courtyard's GitHub sign-in, never the machine's (#99).
                {
                  ...setup.options,
                  env: { ...isolatedEnv(), ...setup.options.env, ...code.env },
                }),
            ...(input.model === "default" ? {} : { model: input.model }),
            ...(effort.value === undefined ? {} : { effort: effort.value }),
            cwd: folder,
            // A code session codes on Claude Code's own instructions, Courtyard's on top (ADR 0025).
            systemPrompt:
              code === null
                ? input.framing.instructions
                : { type: "preset", preset: "claude_code", append: input.framing.instructions },
            tools: [
              ...PLANNING_TOOLS,
              ...(code === null ? [] : CODING_TOOLS),
              ...(helpers === null ? [] : [HELPER_TOOL]),
              ...(web === null ? [] : WEB_TOOLS),
            ],
            // Nothing is pre-approved: the hook allows each call or it's refused.
            permissionMode: "dontAsk",
            mcpServers: {
              ...(tools.length === 0
                ? {}
                : { [COURTYARD_SERVER]: courtyardServer(tools, input.callTool) }),
              ...Object.fromEntries(
                connections.map((connection) => [connection.name, connectionServer(connection)]),
              ),
            },
            hooks: {
              PreToolUse: [
                {
                  hooks: [
                    confineTo({
                      folder,
                      report: input.report,
                      courtyardTools,
                      web,
                      code,
                      connections,
                      projectSkills: setup?.projectSkills ?? [],
                      helpers,
                    }),
                  ],
                  // An approval waits on the owner, however long they take (#171).
                  ...(code === null && connections.length === 0
                    ? {}
                    : { timeout: APPROVAL_WAIT_SECONDS }),
                },
              ],
              ...(web === null && connections.length === 0 && code === null
                ? {}
                : {
                    PostToolUse: [
                      {
                        hooks: [
                          ...(web === null ? [] : [noteResults(web)]),
                          ...(connections.length === 0 ? [] : [handResults(connections, helpers)]),
                          ...(code === null ? [] : [noteEnded(code)]),
                          ...(helpers === null ? [] : [noteHelperDone(helpers)]),
                        ],
                      },
                    ],
                  }),
              ...(connections.length === 0 && code === null
                ? {}
                : {
                    PostToolUseFailure: [
                      {
                        hooks: [
                          ...(connections.length === 0 ? [] : [handResults(connections, helpers)]),
                          ...(code === null ? [] : [noteEnded(code)]),
                          ...(helpers === null ? [] : [noteHelperDone(helpers)]),
                        ],
                      },
                    ],
                  }),
              // A helper's own worktree is Courtyard's to make (#395).
              ...(helpers === null || code === null
                ? {}
                : { WorktreeCreate: [{ hooks: [makeWorktree(helpers, code)] }] }),
            },
            includePartialMessages: true,
            // A code turn runs until Claude finishes, the owner stops it, or a usage limit.
            ...(code === null ? { maxTurns: MAX_TURNS } : {}),
            abortController: stop,
          },
        });

        // Whether a message of Claude's own has started since the last of its text.
        let newMessage = false;
        for await (const message of untilStopped(messages, stop.signal)) {
          const delta = TextDelta.safeParse(message);
          if (delta.success) {
            if (!delta.data.parent_tool_use_id) {
              const between = newMessage && answer !== "" ? BETWEEN_MESSAGES : "";
              const text = `${between}${delta.data.event.delta.text}`;
              newMessage = false;
              answer += text;
              await input.emit(text);
            }
            continue;
          }
          const started = MessageStart.safeParse(message);
          if (started.success) {
            if (!started.data.parent_tool_use_id) {
              newMessage = true;
              for (const added of unread.splice(0)) input.added?.read(added);
            }
            continue;
          }
          // The answer's end, with nothing more of the owner's to answer: the turn takes no more,
          // so Claude Code's input ends and it finishes (#252).
          const ended = ResultMessage.safeParse(message);
          if (ended.success && (ended.data.queued_turn_count ?? 0) === 0) input.added?.done();
          // Which helper is which, so each of its tool calls is told as its own (#117).
          const task = TaskStarted.safeParse(message);
          if (task.success) {
            helpers?.callOf.set(task.data.task_id, task.data.tool_use_id);
            continue;
          }
          noteProgress(message, progress, input.heardUsage);
        }
      } catch (error) {
        // Stopping can make Claude Code end with an error; that's the stop working, not a failure,
        // and it's handled below. Otherwise Claude Code itself failed (it couldn't start, or
        // stopped), and the session gets plain words.
        if (!input.signal.aborted) progress.failure ??= claudeCodeStopped(error);
      } finally {
        input.signal.removeEventListener("abort", stopClaudeCode);
        if (noPlugins?.ok) await removeFolder(noPlugins.value);
      }
      if (input.signal.aborted) return ok(null);
      const failure =
        progress.failure ??
        (progress.result === undefined ? failureFor("unknown", progress) : undefined);
      if (failure) return err(failure);
      // It proves Claude Code starts and answers, so its status is good for a while longer (#282).
      keptStatus.worked();
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
      if (answer === undefined) return err(failureFor("unknown", progress));
      keptStatus.worked();
      return ok(answer);
    },
  };
};
