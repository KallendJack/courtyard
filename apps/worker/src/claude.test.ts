import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { Effort, ModelId, SkillName, type Source } from "@courtyard/contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type ClaudeCode, createClaudeProvider } from "./providers/claude.ts";
import type {
  Activity,
  AddedMessage,
  AddedMessages,
  CodeTurn,
  Provider,
  ToolCall,
  ToolConnection,
  ToolContent,
  TurnInput,
  TurnTool,
} from "./providers/index.ts";
import { err, ok } from "./result.ts";
import { quotedInGuide } from "./testing.ts";

const folder = resolve("/path/to/context/garage-gym");

/**
 * A stand-in for Claude Code: records what each turn asked for and replays scripted messages. A
 * function among them is a step Claude Code takes at that point, such as calling a hook.
 */
const stubClaudeCode = (
  script: { check?: (signal: AbortSignal) => Promise<unknown>; messages?: unknown[] } = {},
) => {
  const runs: Parameters<ClaudeCode["run"]>[0][] = [];
  const claudeCode: ClaudeCode = {
    check:
      script.check ??
      (async () => ({
        account: { subscriptionType: "Claude Pro", apiProvider: "firstParty" },
        models: [
          { value: "default", displayName: "Default (recommended)", description: "" },
          { value: "opus", displayName: "Opus 5.5", description: "" },
          { value: "sonnet", displayName: "Sonnet 5.5", description: "" },
          { value: "claude-opus-4-8", displayName: "Opus 4.8", description: "" },
        ],
      })),
    run: (request) => {
      runs.push(request);
      return (async function* () {
        for (const message of script.messages ?? []) {
          if (typeof message === "function") await message(request.options);
          else yield message;
        }
      })();
    },
  };
  return { claudeCode, runs };
};

/**
 * What a turn's streamed prompt says (#78): it must be one user message, and this is its content.
 * A string prompt fails: every turn streams its message.
 */
const streamedContent = async (prompt: Parameters<ClaudeCode["run"]>[0]["prompt"] | undefined) => {
  if (prompt === undefined || typeof prompt === "string") throw new Error("not streamed");
  const messages: unknown[] = [];
  for await (const message of prompt) messages.push(message);
  const [only] = z
    .array(
      z.object({
        type: z.literal("user"),
        parent_tool_use_id: z.null(),
        message: z.object({ role: z.literal("user"), content: z.array(z.unknown()) }),
      }),
    )
    .length(1)
    .parse(messages);
  return only?.message.content;
};

const textDelta = (text: string) => ({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
});
/** One of Claude's messages starting, its own or (with `parent`) a subagent's. */
const messageStart = (parent: string | null = null) => ({
  type: "stream_event",
  parent_tool_use_id: parent,
  event: { type: "message_start", message: { id: "msg", role: "assistant", content: [] } },
});
const success = { type: "result", subtype: "success", is_error: false, result: "" };

/** Runs one turn and collects what it emitted and reported. */
const runTurn = (claudeCode: ClaudeCode, overrides: Partial<TurnInput> = {}) =>
  turnOn(createClaudeProvider({ claudeCode }), overrides);

/** Runs one turn on this provider, as `runTurn` does. */
const turnOn = async (provider: Provider, overrides: Partial<TurnInput> = {}) => {
  const emitted: string[] = [];
  const activities: Activity[] = [];
  const sources: Source[] = [];
  const result = await provider.runTurn({
    model: ModelId.parse("sonnet"),
    effort: undefined,
    folder,
    code: null,
    added: null,
    connections: [],
    framing: {
      instructions: "The turn's instructions.",
      message: "Where should the rack go?",
      newMessage: "Where should the rack go?",
      attachments: [],
      tools: [],
      fileTools: null,
      webSearch: null,
    },
    callTool: async () => ({ ok: false, content: [{ kind: "text", text: "No tools here." }] }),
    emit: async (text) => {
      emitted.push(text);
    },
    report: async (activity) => {
      activities.push(activity);
    },
    cite: async (found) => {
      sources.push(...found);
    },
    signal: new AbortController().signal,
    ...overrides,
  });
  return { result, emitted, activities, sources };
};

/** The PreToolUse hook the adapter gave Claude Code, called the way Claude Code would. */
const preToolUse = async (options: Options, tool: { name: string; input: unknown }) => {
  const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
  if (!hook) throw new Error("no PreToolUse hook");
  return hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: tool.name,
      tool_input: tool.input,
      tool_use_id: "tool-1",
      session_id: "s",
      transcript_path: "",
      cwd: folder,
    },
    "tool-1",
    { signal: new AbortController().signal },
  );
};

/** The PostToolUse hooks the adapter gave Claude Code, called the way Claude Code would. */
const postToolUse = async (
  options: Options,
  tool: { name: string; input: unknown; response: unknown },
) => {
  for (const matcher of options.hooks?.PostToolUse ?? []) {
    for (const hook of matcher.hooks) {
      await hook(
        {
          hook_event_name: "PostToolUse",
          tool_name: tool.name,
          tool_input: tool.input,
          tool_response: tool.response,
          tool_use_id: "tool-1",
          session_id: "s",
          transcript_path: "",
          cwd: folder,
        },
        "tool-1",
        { signal: new AbortController().signal },
      );
    }
  }
};

/**
 * The PostToolUseFailure hooks the adapter gave Claude Code, called the way Claude Code would:
 * what each answered.
 */
const postToolUseFailure = async (
  options: Options,
  tool: { name: string; input: unknown; error: string },
) => {
  const answers: unknown[] = [];
  for (const matcher of options.hooks?.PostToolUseFailure ?? []) {
    for (const hook of matcher.hooks) {
      answers.push(
        await hook(
          {
            hook_event_name: "PostToolUseFailure",
            tool_name: tool.name,
            tool_input: tool.input,
            error: tool.error,
            tool_use_id: "tool-1",
            session_id: "s",
            transcript_path: "",
            cwd: folder,
          },
          "tool-1",
          { signal: new AbortController().signal },
        ),
      );
    }
  }
  return answers;
};

describe("Claude's status", () => {
  it("is available with its models when Claude Code is logged in", async () => {
    const status = await createClaudeProvider({ claudeCode: stubClaudeCode().claudeCode }).status();

    expect(status).toMatchObject({ id: "claude", available: true });
    if (!status.available) throw new Error("expected available");
    expect(status.models.map((m) => m.id)).toEqual(["default", "opus", "sonnet"]);
    expect(status.capabilities).toEqual({
      readsFiles: true,
      codes: true,
      usesTools: true,
      savesContext: true,
      searchesWeb: true,
      steers: true,
    });
  });

  it("says which model Default is, from Claude Code's description of it", async () => {
    const { claudeCode } = stubClaudeCode({
      check: async () => ({
        account: { subscriptionType: "Claude Pro" },
        models: [
          {
            value: "default",
            displayName: "Default (recommended)",
            description: "Opus 5.5 · Best for everyday, complex tasks",
          },
          { value: "sonnet", displayName: "Sonnet 5.5", description: "Most efficient" },
        ],
      }),
    });

    const status = await createClaudeProvider({ claudeCode }).status();

    if (!status.available) throw new Error("expected available");
    expect(status.models.map((m) => m.label)).toEqual([
      "Claude · Default (Opus 5.5)",
      "Claude · Sonnet 5.5",
    ]);
    // Where there's little room, each by its model alone, Default saying it's Claude Code's default.
    expect(status.models.map((m) => [m.name, m.followsDefault])).toEqual([
      ["Opus 5.5", true],
      ["Sonnet 5.5", undefined],
    ]);
  });

  it("says which model Default is when Claude Code describes it as the one it uses now", async () => {
    const { claudeCode } = stubClaudeCode({
      check: async () => ({
        account: { subscriptionType: "Claude Max" },
        models: [
          {
            value: "default",
            displayName: "Default (recommended)",
            description: "Use the default model (currently Opus 5.5) · Best for everyday tasks",
          },
        ],
      }),
    });

    const status = await createClaudeProvider({ claudeCode }).status();

    if (!status.available) throw new Error("expected available");
    expect(status.models[0]?.label).toBe("Claude · Default (Opus 5.5)");
    expect(status.models[0]?.name).toBe("Opus 5.5");
  });

  it("keeps Default's own name when Claude Code's description doesn't name a model", async () => {
    const status = await createClaudeProvider({ claudeCode: stubClaudeCode().claudeCode }).status();

    if (!status.available) throw new Error("expected available");
    expect(status.models[0]?.label).toBe("Claude · Default (recommended)");
    expect(status.models[0]?.name).toBe("Default");
  });

  it("lists the levels of effort each model takes, in Claude's words, and none for a model without", async () => {
    const { claudeCode } = stubClaudeCode({
      check: async () => ({
        account: { subscriptionType: "Claude Max" },
        models: [
          {
            value: "opus",
            displayName: "Opus 5.5",
            description: "",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "haiku",
            displayName: "Haiku 4.5",
            description: "",
            supportsEffort: false,
            supportedEffortLevels: ["low"],
          },
          { value: "sonnet", displayName: "Sonnet 5.5", description: "" },
        ],
      }),
    });

    const status = await createClaudeProvider({ claudeCode }).status();

    if (!status.available) throw new Error("expected available");
    expect(status.models.map((m) => m.efforts)).toEqual([
      [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra high" },
        { id: "max", label: "Max" },
      ],
      [],
      [],
    ]);
    // Claude Code doesn't say which level a model uses by default.
    expect(status.models.map((m) => m.defaultEffort)).toEqual([undefined, undefined, undefined]);
  });

  it("is unavailable with a useful reason when Claude Code isn't logged in", async () => {
    const { claudeCode } = stubClaudeCode({ check: async () => ({ account: {}, models: [] }) });

    const status = await createClaudeProvider({ claudeCode }).status();

    expect(status).toMatchObject({ available: false, reason: expect.stringMatching(/log in/i) });
  });

  it("is unavailable with a useful reason when Claude Code can't start", async () => {
    const { claudeCode } = stubClaudeCode({
      check: async () => {
        throw new Error("spawn claude ENOENT");
      },
    });

    const status = await createClaudeProvider({ claudeCode }).status();

    expect(status).toMatchObject({ available: false, reason: expect.stringMatching(/start/i) });
  });

  it("counts an API key as signed in", async () => {
    const { claudeCode } = stubClaudeCode({
      check: async () => ({
        account: { apiKeySource: "ANTHROPIC_API_KEY", apiProvider: "firstParty" },
        models: [{ value: "sonnet", displayName: "Sonnet 5.5", description: "" }],
      }),
    });

    expect((await createClaudeProvider({ claudeCode }).status()).available).toBe(true);
  });
});

describe("Claude's status, when the worker machine is busy (#282)", () => {
  type Check = ClaudeCode["check"];
  const good: Check = async () => ({
    account: { subscriptionType: "Claude Pro" },
    models: [{ value: "sonnet", displayName: "Sonnet 5.5", description: "" }],
  });
  const signedOut: Check = async () => ({ account: {}, models: [] });
  const noAnswer: Check = () => new Promise(() => {});

  /**
   * A Claude Code whose checks answer in this order (the last one again after that), whose turns
   * finish, and a clock the test moves on.
   */
  const busyMachine = (...answers: Check[]) => {
    let checks = 0;
    let clock = 0;
    const { claudeCode } = stubClaudeCode({
      check: (signal) => {
        const answer = answers[Math.min(checks, answers.length - 1)];
        checks += 1;
        if (answer === undefined) throw new Error("no answers scripted");
        return answer(signal);
      },
      messages: [success],
    });
    const provider = createClaudeProvider({
      claudeCode,
      now: () => clock,
      checkTimeouts: { firstMs: 1000, laterMs: 20 },
    });
    return {
      provider,
      checks: () => checks,
      later: (ms: number) => {
        clock += ms;
      },
    };
  };

  it("keeps the last good answer, with its models, when a check doesn't answer in time", async () => {
    const machine = busyMachine(good, noAnswer);
    await machine.provider.status();
    machine.later(61_000);

    const status = await machine.provider.status();

    expect(status).toMatchObject({ available: true, models: [{ id: "sonnet" }] });
  });

  it("checks again in the background after a check that didn't answer, and keeps what it hears", async () => {
    const machine = busyMachine(good, noAnswer, signedOut);
    await machine.provider.status();
    machine.later(61_000);
    await machine.provider.status();

    await vi.waitFor(() => expect(machine.checks()).toBe(3));

    expect(await machine.provider.status()).toMatchObject({
      available: false,
      reason: expect.stringMatching(/log in/i),
    });
  });

  it("says Claude is unavailable at once when it's signed out, whatever it said before", async () => {
    const machine = busyMachine(good, signedOut);
    await machine.provider.status();
    machine.later(61_000);

    const status = await machine.provider.status();

    expect(status).toMatchObject({ available: false, reason: expect.stringMatching(/log in/i) });
  });

  it("checks again after a few seconds when Claude Code couldn't start", async () => {
    const cantStart: Check = async () => {
      throw new Error("spawn claude ENOENT");
    };
    const machine = busyMachine(cantStart, good);
    expect(await machine.provider.status()).toMatchObject({ available: false });

    machine.later(5_000);
    expect(await machine.provider.status()).toMatchObject({ available: false });
    machine.later(6_000);
    const status = await machine.provider.status();

    expect(status).toMatchObject({ available: true });
    expect(machine.checks()).toBe(2);
  });

  it("gives the first check after the worker starts longer to answer", async () => {
    const slowStart: Check = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return good(new AbortController().signal);
    };
    const machine = busyMachine(slowStart);

    expect(await machine.provider.status()).toMatchObject({ available: true });
  });

  it("counts a turn that finished as a good check", async () => {
    const machine = busyMachine(good, noAnswer);
    await machine.provider.status();
    machine.later(61_000);

    await turnOn(machine.provider);
    const status = await machine.provider.status();

    expect(status).toMatchObject({ available: true });
    expect(machine.checks()).toBe(1);
  });

  it("checks again at once after a turn finished, when the last check said Claude couldn't be used", async () => {
    const machine = busyMachine(signedOut, good);
    await machine.provider.status();

    await turnOn(machine.provider);
    const status = await machine.provider.status();

    expect(status).toMatchObject({ available: true });
    expect(machine.checks()).toBe(2);
  });
});

describe("a Claude turn", () => {
  it("runs isolated from the machine's own Claude Code setup", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode);

    const options = runs[0]?.options;
    expect(options?.settingSources).toEqual([]);
    expect(options?.strictMcpConfig).toBe(true);
    expect(options?.mcpServers).toEqual({});
    expect(options?.env).toMatchObject({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    });
  });

  it("can only read and search, inside the workspace folder", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode);

    const options = runs[0]?.options;
    expect(options?.cwd).toBe(folder);
    expect(options?.tools).toEqual(["Read", "Glob", "Grep"]);
    expect(options?.permissionMode).toBe("dontAsk");
    expect(options?.additionalDirectories ?? []).toEqual([]);
  });

  it("refuses any read outside the workspace folder", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode);
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    for (const input of [
      { file_path: resolve("/path/to/context/homelab/CONTEXT.md") },
      { file_path: join(folder, "..", "secret.txt") },
      { file_path: "../../.ssh/id_rsa" },
    ]) {
      const decision = await preToolUse(options, { name: "Read", input });
      expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    }
    for (const input of [{ pattern: "**/*", path: resolve("/") }, { pattern: "/etc/**" }]) {
      const decision = await preToolUse(options, { name: "Glob", input });
      expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    }
  });

  it("allows reads inside the workspace, images included, and reports each file read", async () => {
    const reported: Activity[] = [];
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, {
      report: async (activity) => {
        reported.push(activity);
      },
    });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const plan = await preToolUse(options, {
      name: "Read",
      input: { file_path: join(folder, "plans", "rack.png") },
    });
    const relative = await preToolUse(options, {
      name: "Read",
      input: { file_path: "CONTEXT.md" },
    });

    expect(plan).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(relative).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(reported).toEqual([
      { kind: "read-file", path: "plans/rack.png" },
      { kind: "read-file", path: "CONTEXT.md" },
    ]);
  });

  it("delivers the framing as given: its instructions as the system prompt, its message as the prompt", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, {
      framing: {
        instructions: "Exactly these instructions.",
        message: "Exactly this message.",
        newMessage: "This message.",
        attachments: [],
        tools: [],
        fileTools: null,
        webSearch: null,
      },
    });

    expect(runs[0]?.options.systemPrompt).toBe("Exactly these instructions.");
    expect(await streamedContent(runs[0]?.prompt)).toEqual([
      { type: "text", text: "Exactly this message." },
    ]);
  });

  it("sends the turn's photos with its message as images, in order (#78)", async () => {
    const root = await mkdtemp(join(tmpdir(), "courtyard-"));
    try {
      const [first, second] = [join(root, "one.png"), join(root, "two.jpg")];
      await writeFile(first, "first photo");
      await writeFile(second, "second photo");
      const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

      await runTurn(claudeCode, {
        framing: {
          instructions: "The instructions.",
          message: "The message, with the PDF's text.",
          newMessage: "The message.",
          attachments: [
            { kind: "photo", name: "one.png", path: first, mediaType: "image/png" },
            { kind: "pdf", name: "manual.pdf" },
            { kind: "photo", name: "two.jpg", path: second, mediaType: "image/jpeg" },
          ],
          tools: [],
          fileTools: null,
          webSearch: null,
        },
      });

      const image = (mediaType: string, text: string) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: Buffer.from(text).toString("base64"),
        },
      });
      expect(await streamedContent(runs[0]?.prompt)).toEqual([
        { type: "text", text: "The message, with the PDF's text." },
        image("image/png", "first photo"),
        image("image/jpeg", "second photo"),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sends a turn of only a photo as the framing's message and the image, no empty text (#164)", async () => {
    const root = await mkdtemp(join(tmpdir(), "courtyard-"));
    try {
      const photo = join(root, "floor-plan.png");
      await writeFile(photo, "the plan");
      const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
      const message = 'The owner\'s new message (attached "floor-plan.png") has no words.';

      await runTurn(claudeCode, {
        framing: {
          instructions: "The instructions.",
          message,
          newMessage: "",
          attachments: [
            { kind: "photo", name: "floor-plan.png", path: photo, mediaType: "image/png" },
          ],
          tools: [],
          fileTools: null,
          webSearch: null,
        },
      });

      expect(await streamedContent(runs[0]?.prompt)).toEqual([
        { type: "text", text: message },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: Buffer.from("the plan").toString("base64"),
          },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("streams the answer as it's written and uses the model asked for", async () => {
    const { claudeCode, runs } = stubClaudeCode({
      messages: [textDelta("Put it "), textDelta("on the left wall."), success],
    });

    const { result, emitted } = await runTurn(claudeCode);

    expect(result.ok).toBe(true);
    expect(emitted).toEqual(["Put it ", "on the left wall."]);
    expect(runs[0]?.options.model).toBe("sonnet");
    expect(runs[0]?.options.includePartialMessages).toBe(true);
  });

  it("sends the chosen effort with the turn, and none for the model's default", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, { effort: Effort.parse("xhigh") });
    await runTurn(claudeCode);

    expect(runs[0]?.options.effort).toBe("xhigh");
    expect(runs[1]?.options).not.toHaveProperty("effort");
  });

  it("fails a turn whose effort Claude doesn't know, rather than send it", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    const { result } = await runTurn(claudeCode, { effort: Effort.parse("ludicrous") });

    expect(result).toEqual({
      ok: false,
      error: { kind: "unknown", message: expect.stringMatching(/effort/) },
    });
    expect(runs).toEqual([]);
  });

  it("completes a turn whose answer arrives as ordinary assistant messages", async () => {
    // The real Claude Code sends whole assistant messages as well as the streamed pieces; one
    // with no error must not count as a failure.
    const { claudeCode } = stubClaudeCode({
      messages: [
        textDelta("The rack fits."),
        { type: "assistant", message: { content: [{ type: "text", text: "The rack fits." }] } },
        success,
      ],
    });

    const { result, emitted } = await runTurn(claudeCode);

    expect(result).toEqual({ ok: true, value: null });
    expect(emitted).toEqual(["The rack fits."]);
  });

  it("keeps what Claude writes between what it does apart, each message its own paragraph", async () => {
    const { claudeCode } = stubClaudeCode({
      messages: [
        messageStart(),
        textDelta("Now the contract and worker side."),
        { type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } },
        // A subagent's messages start too, and don't count.
        messageStart("tool-1"),
        messageStart(),
        textDelta("Good, `classes` is "),
        textDelta("already imported."),
        messageStart(),
        textDelta("Now the queued bubble:"),
        success,
      ],
    });

    const { emitted } = await runTurn(claudeCode);

    expect(emitted.join("")).toBe(
      "Now the contract and worker side.\n\nGood, `classes` is already imported.\n\nNow the queued bubble:",
    );
  });

  it("turns a usage limit into a rate-limited failure with the reset time", async () => {
    const resetsAt = Date.parse("2026-10-05T17:00:00Z") / 1000;
    const { claudeCode } = stubClaudeCode({
      messages: [
        { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt } },
        { type: "assistant", error: "rate_limit", message: { content: [] } },
        { type: "result", subtype: "error_during_execution", is_error: true, errors: ["limit"] },
      ],
    });

    const { result } = await runTurn(claudeCode);

    expect(result).toEqual({
      ok: false,
      error: { kind: "rate-limited", resetAt: "2026-10-05T17:00:00.000Z" },
    });
  });

  describe("a failed turn says why, when Claude Code says (#200)", () => {
    /** The assistant message Claude Code sends in place of an answer that failed. */
    const failed = (error: string, text: string) => ({
      type: "assistant",
      error,
      message: { content: [{ type: "text", text }] },
    });
    const failedResult = {
      type: "result",
      subtype: "success",
      is_error: true,
      result: "",
    };
    /** Claude Code waiting to try again after a request that failed. */
    const retrying = (status: number | null) => ({
      type: "system",
      subtype: "api_retry",
      attempt: 1,
      max_retries: 10,
      retry_delay_ms: 500,
      error_status: status,
      error: "unknown",
    });
    const signInExpired = {
      kind: "provider-unavailable",
      message: "Claude's sign-in expired. Retry in a minute, or sign in again from Connections.",
    };
    const noConnection = {
      kind: "provider-unavailable",
      message:
        "Courtyard couldn't reach Claude. Check the worker machine's internet connection, then retry.",
    };
    const overloaded = {
      kind: "unknown",
      message: "Claude is overloaded right now. Retry in a moment.",
    };

    it.each([
      [
        "its sign-in failed",
        [failed("authentication_failed", "Failed to authenticate"), failedResult],
        signInExpired,
      ],
      [
        "its sign-in expired and couldn't be refreshed",
        [
          failed(
            "server_error",
            "Failed to refresh OAuth token: another Claude Code process is refreshing it. This is usually transient; retry in a moment.",
          ),
          failedResult,
        ],
        signInExpired,
      ],
      [
        "Claude refused its sign-in",
        [{ ...failedResult, api_error_status: 401, result: "API Error: 401" }],
        signInExpired,
      ],
      [
        "it couldn't connect",
        [
          retrying(null),
          retrying(null),
          failed("unknown", "API Error: Connection error."),
          failedResult,
        ],
        noConnection,
      ],
      ["Claude was overloaded", [failed("overloaded", "Overloaded"), failedResult], overloaded],
      [
        "Claude was at capacity",
        [{ ...failedResult, api_error_status: 529, result: "API Error: 529" }],
        overloaded,
      ],
    ])("when %s", async (_, messages, error) => {
      const { claudeCode } = stubClaudeCode({ messages });

      const { result } = await runTurn(claudeCode);

      expect(result).toEqual({ ok: false, error });
    });

    it("says only that it couldn't answer for anything else, even after a dropped connection it got back", async () => {
      const { claudeCode } = stubClaudeCode({
        messages: [
          retrying(null),
          retrying(500),
          failed("server_error", "API Error: 500 Internal server error"),
          failedResult,
        ],
      });

      const { result } = await runTurn(claudeCode);

      expect(result).toEqual({
        ok: false,
        error: { kind: "unknown", message: "Claude couldn't answer this time." },
      });
    });
  });

  it("reports any other failure in plain words, without the details", async () => {
    const { claudeCode } = stubClaudeCode({
      messages: [
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["sk-ant-secret-looking-detail"],
        },
      ],
    });

    const { result } = await runTurn(claudeCode);

    expect(result).toMatchObject({ ok: false, error: { kind: "unknown" } });
    expect(JSON.stringify(result)).not.toContain("sk-ant");
  });
});

describe("after the security review", () => {
  it("delivers prompts verbatim, loads no skills and pre-approves nothing", async () => {
    process.env.COURTYARD_EXAMPLE_SETTING = "worker-only";
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode);

    const options = runs[0]?.options;
    expect(options?.verbatimPrompts).toBe(true);
    expect(options?.skills).toEqual([]);
    expect(options?.allowedTools).toBeUndefined();
    expect(options?.env?.COURTYARD_EXAMPLE_SETTING).toBeUndefined();
    delete process.env.COURTYARD_EXAMPLE_SETTING;
  });

  it("refuses a read that follows a link out of the workspace folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "courtyard-"));
    try {
      const workspace = join(root, "workspace");
      const outside = join(root, "outside");
      await mkdir(workspace);
      await mkdir(outside);
      await writeFile(join(outside, "secret.txt"), "not yours");
      await writeFile(join(workspace, "plan.md"), "the plan");
      await symlink(outside, join(workspace, "linked"), "junction");
      const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
      await runTurn(claudeCode, { folder: workspace });
      const options = runs[0]?.options;
      if (!options) throw new Error("no turn ran");

      const viaLink = await preToolUse(options, {
        name: "Read",
        input: { file_path: join(workspace, "linked", "secret.txt") },
      });
      const inside = await preToolUse(options, { name: "Read", input: { file_path: "plan.md" } });

      expect(viaLink).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      expect(inside).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a tool call with a field it doesn't know, and any other tool", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode);
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const extraField = await preToolUse(options, {
      name: "Read",
      input: { file_path: "CONTEXT.md", another_path: "/etc/passwd" },
    });
    const write = await preToolUse(options, {
      name: "Write",
      input: { file_path: "CONTEXT.md", content: "x" },
    });

    expect(extraField).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(write).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("treats Grep's pattern as text to search for, but its glob as a place", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode);
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const searchText = await preToolUse(options, { name: "Grep", input: { pattern: "../api/" } });
    const climbingGlob = await preToolUse(options, {
      name: "Grep",
      input: { pattern: "rack", glob: "{..,x}/**" },
    });

    expect(searchText).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(climbingGlob).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("checks once for callers asking at the same time", async () => {
    let checks = 0;
    const { claudeCode } = stubClaudeCode({
      check: async () => {
        checks += 1;
        return { account: { subscriptionType: "Claude Pro" }, models: [] };
      },
    });
    const provider = createClaudeProvider({ claudeCode });

    await Promise.all([provider.status(), provider.status(), provider.status()]);

    expect(checks).toBe(1);
  });

  it("stops a check that doesn't answer, and says so", async () => {
    let stopped = false;
    const { claudeCode } = stubClaudeCode({
      check: (signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => {
            stopped = true;
          });
        }),
    });

    const status = await createClaudeProvider({
      claudeCode,
      checkTimeouts: { firstMs: 20, laterMs: 20 },
    }).status();

    expect(status).toMatchObject({ available: false, reason: expect.stringMatching(/answer/) });
    expect(stopped).toBe(true);
  });
});

const SAVE_TOOL: TurnTool = {
  name: "save_to_context",
  description: "Saves one line to the context file.",
  input: {
    action: z.enum(["add", "change", "remove"]),
    section: z.enum(["facts", "plans", "ideas"]),
    text: z.string().optional(),
  },
};

const framingWith = (tools: readonly TurnTool[]) => ({
  instructions: "The turn's instructions.",
  message: "I've booked padel lessons for Tuesdays.",
  newMessage: "I've booked padel lessons for Tuesdays.",
  attachments: [],
  tools,
  fileTools: null,
  webSearch: null,
});

/** A planning turn's framing, which offers web search with the links the owner sent. */
const searchingFraming = (ownerLinks: readonly string[] = []) => ({
  ...framingWith([]),
  webSearch: { ownerLinks },
});

/** What Claude Code's WebSearch gives back: its query, and each search's hits. */
const searchResults = (query: string, hits: readonly { title: string; url: string }[]) => ({
  query,
  results: [{ tool_use_id: "search-1", content: hits }, "Some commentary on the results."],
  durationSeconds: 1.2,
});

describe("a Claude turn in a code session (ADR 0007, ADR 0022)", () => {
  /** A session branch's worktree with the repository's own project skills, and the turn's say. */
  const codeSession = async () => {
    const worktree = await mkdtemp(join(tmpdir(), "courtyard-worktree-"));
    for (const name of ["tdd", "pr"]) {
      await mkdir(join(worktree, ".claude", "skills", name), { recursive: true });
      await writeFile(join(worktree, ".claude", "skills", name, "SKILL.md"), `# ${name}\n`);
    }
    // A folder that isn't a skill, without its SKILL.md.
    await mkdir(join(worktree, ".claude", "skills", "notes"), { recursive: true });
    const asked: string[] = [];
    /** The commands the adapter said ended, in order. */
    const ended: string[] = [];
    const code: CodeTurn = {
      worktree,
      env: {
        COURTYARD_SESSION_SLOT: "2",
        GH_CONFIG_DIR: "/path/to/data/github/gh",
        GH_TOKEN: undefined,
      },
      plugin: null,
      edit: async (path) => {
        asked.push(`edit ${path}`);
        return path.includes("outside") ? err("Not out there.") : ok(null);
      },
      run: async (command) => {
        asked.push(`run ${command}`);
        return command === "pnpm test" ? ok(null) : err("Not that one.");
      },
      ran: (command) => {
        ended.push(command);
      },
      helper: async () => undefined,
      branchOff: async () => err("No helpers here."),
    };
    return { worktree, code, asked, ended };
  };

  it("runs its commands with the worker's GitHub sign-in, never the machine's", async () => {
    const { worktree, code } = await codeSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    process.env.GH_TOKEN = "ghp_machine";
    try {
      await runTurn(claudeCode, { folder: worktree, code });
    } finally {
      delete process.env.GH_TOKEN;
    }

    const env = runs[0]?.options.env;
    expect(env?.GH_CONFIG_DIR).toBe("/path/to/data/github/gh");
    expect(env?.GH_TOKEN).toBeUndefined();
    // Still none of the machine's Claude Code setup.
    expect(env).toMatchObject({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
    await rm(worktree, { recursive: true, force: true });
  });

  it("works in its worktree with edit and command tools, loading only the repository's project settings and skills", async () => {
    const { worktree, code } = await codeSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, { folder: worktree, code });

    const options = runs[0]?.options;
    expect(options?.cwd).toBe(worktree);
    expect(options?.tools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash",
      "TodoWrite",
      "Skill",
      "Agent",
    ]);
    expect(options?.permissionMode).toBe("dontAsk");
    // Its AGENTS.md or CLAUDE.md and its skills, never the machine's own setup.
    expect(options?.settingSources).toEqual(["project"]);
    expect([...(Array.isArray(options?.skills) ? options.skills : [])].sort()).toEqual([
      "pr",
      "tdd",
    ]);
    expect(options?.plugins ?? []).toEqual([]);
    expect(options?.strictMcpConfig).toBe(true);
    expect(options?.mcpServers).toEqual({});
    // Its commands get its slot among the code sessions running, so their checks never share ports.
    expect(options?.env).toMatchObject({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      COURTYARD_SESSION_SLOT: "2",
    });
    await rm(worktree, { recursive: true, force: true });
  });

  it("codes on Claude Code's own instructions with Courtyard's framing appended, and no turn limit (ADR 0025)", async () => {
    const { worktree, code } = await codeSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, { folder: worktree, code });
    await runTurn(claudeCode);

    const [coding, planning] = runs.map((run) => run.options);
    expect(coding?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "The turn's instructions.",
    });
    // A long piece of work runs until Claude finishes, the owner stops it, or a usage limit.
    expect(coding).not.toHaveProperty("maxTurns");
    // A planning turn is as it was: Courtyard's instructions alone, and a limit.
    expect(planning?.systemPrompt).toBe("The turn's instructions.");
    expect(planning?.maxTurns).toBe(30);
    expect(planning?.tools).toEqual(["Read", "Glob", "Grep"]);
    await rm(worktree, { recursive: true, force: true });
  });

  it("lets Claude keep a task list in a code session, reporting each update, and only there", async () => {
    const { worktree, code } = await codeSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const coding = await runTurn(claudeCode, { folder: worktree, code });
    const planning = await runTurn(claudeCode);
    const [codeOptions, planningOptions] = runs.map((run) => run.options);
    if (!codeOptions || !planningOptions) throw new Error("no turn ran");
    const todos = {
      todos: [{ content: "Write the test", status: "in_progress", activeForm: "Writing the test" }],
    };

    const decisions = [
      await preToolUse(codeOptions, { name: "TodoWrite", input: todos }),
      // A field Courtyard doesn't know is refused rather than let through unchecked.
      await preToolUse(codeOptions, { name: "TodoWrite", input: { ...todos, merge: true } }),
      await preToolUse(planningOptions, { name: "TodoWrite", input: todos }),
    ];

    expect(decisions).toEqual([
      { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: await quotedInGuide("That request couldn't be checked"),
        },
      },
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({ permissionDecision: "deny" }),
      }),
    ]);
    expect(coding.activities).toEqual([{ kind: "updated-tasks" }]);
    expect(planning.activities).toEqual([]);
    await rm(worktree, { recursive: true, force: true });
  });

  it("finds none of the machine's installed plugins, whatever the repository's settings enable", async () => {
    const { worktree, code } = await codeSession();
    let pluginsFolder: string | undefined;
    let found: string[] | undefined;
    const { claudeCode } = stubClaudeCode({
      messages: [
        async (options: Options) => {
          pluginsFolder = options.env?.CLAUDE_CODE_PLUGIN_CACHE_DIR;
          if (pluginsFolder !== undefined) found = await readdir(pluginsFolder);
        },
        success,
      ],
    });

    await runTurn(claudeCode, { folder: worktree, code });

    // Claude Code looks for plugins in an empty folder of the turn's own, gone once it ends.
    expect(found).toEqual([]);
    expect(pluginsFolder?.startsWith(worktree)).toBe(false);
    await expect(readdir(pluginsFolder ?? worktree)).rejects.toThrow();
    await rm(worktree, { recursive: true, force: true });
  });

  /** A code session with Courtyard's pinned copy of Matt's plugin (ADR 0024), tdd and grilling on. */
  const withMattsSkills = async () => {
    const session = await codeSession();
    const pluginFolder = await mkdtemp(join(tmpdir(), "courtyard-matt-"));
    await mkdir(join(pluginFolder, "skills", "engineering", "tdd"), { recursive: true });
    await writeFile(join(pluginFolder, "skills", "engineering", "tdd", "tests.md"), "Tests.\n");
    const code: CodeTurn = {
      ...session.code,
      plugin: {
        folder: pluginFolder,
        name: "mattpocock-skills",
        skills: ["tdd", "grilling"].map((name) => SkillName.parse(name)),
      },
    };
    const cleanUp = async () => {
      await rm(session.worktree, { recursive: true, force: true });
      await rm(pluginFolder, { recursive: true, force: true });
    };
    return { ...session, code, pluginFolder, cleanUp };
  };

  it("loads Matt Pocock's skills from Courtyard's pinned copy as a plugin, only those it's given, never the machine's plugins", async () => {
    const { worktree, code, pluginFolder, cleanUp } = await withMattsSkills();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    // The owner's own Claude Code may load plugins from folders of theirs.
    process.env.CLAUDE_CODE_PLUGIN_DIRS = "/path/to/owners/plugins";
    try {
      await runTurn(claudeCode, { folder: worktree, code });
      await runTurn(claudeCode);
    } finally {
      delete process.env.CLAUDE_CODE_PLUGIN_DIRS;
    }

    const [coding, planning] = runs.map((run) => run.options);
    expect(coding?.plugins).toEqual([{ type: "local", path: pluginFolder }]);
    expect([...(Array.isArray(coding?.skills) ? coding.skills : [])].sort()).toEqual([
      "mattpocock-skills:grilling",
      "mattpocock-skills:tdd",
      "pr",
      "tdd",
    ]);
    expect(coding?.env?.CLAUDE_CODE_PLUGIN_CACHE_DIR).not.toBe(pluginFolder);
    // A planning turn never gets them.
    expect(planning?.plugins ?? []).toEqual([]);
    expect(planning?.skills).toEqual([]);
    for (const options of [coding, planning]) {
      expect(options?.env).not.toHaveProperty("CLAUDE_CODE_PLUGIN_DIRS");
    }
    await cleanUp();
  });

  it("lets Claude load a skill it was given with its Skill tool, and read that skill's files, reporting each", async () => {
    const { worktree, code, pluginFolder, cleanUp } = await withMattsSkills();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const { activities } = await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const decisions = [
      await preToolUse(options, { name: "Skill", input: { skill: "mattpocock-skills:tdd" } }),
      await preToolUse(options, { name: "Skill", input: { skill: "grilling", args: "the plan" } }),
      await preToolUse(options, { name: "Skill", input: { skill: "pr" } }),
      await preToolUse(options, {
        name: "Read",
        input: { file_path: join(pluginFolder, "skills", "engineering", "tdd", "tests.md") },
      }),
      // Not one it was given, or a field Courtyard doesn't know.
      await preToolUse(options, { name: "Skill", input: { skill: "mattpocock-skills:retro" } }),
      await preToolUse(options, { name: "Skill", input: { skill: "tdd", model: "opus" } }),
    ].map((decision) => ("hookSpecificOutput" in decision ? decision.hookSpecificOutput : {}));

    expect(
      decisions.map(
        (decision) =>
          z.object({ permissionDecision: z.string() }).parse(decision).permissionDecision,
      ),
    ).toEqual(["allow", "allow", "allow", "allow", "deny", "deny"]);
    expect(
      await preToolUse(options, { name: "Skill", input: { skill: "mattpocock-skills:retro" } }),
    ).toMatchObject({
      hookSpecificOutput: {
        permissionDecisionReason: await quotedInGuide("That skill isn't one you can load here"),
      },
    });
    expect(activities).toEqual([
      { kind: "skill-loaded", name: "tdd", source: "matt" },
      { kind: "skill-loaded", name: "grilling", source: "matt" },
      { kind: "skill-loaded", name: "pr", source: "project" },
      { kind: "skill-file-read", name: "tdd", path: "tests.md" },
    ]);
    await cleanUp();
  });

  it("gives a code turn Matt's skills and Paper's server together, its hook answering each (ADR 0023, ADR 0024)", async () => {
    const { worktree, code, cleanUp } = await withMattsSkills();
    const checked: unknown[] = [];
    const paper: ToolConnection = {
      name: "paper",
      server: { command: "/path/to/paper", args: ["mcp"] },
      check: async (call) => {
        checked.push(call.tool);
        return ok(null);
      },
      done: async () => undefined,
    };
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const { activities } = await runTurn(claudeCode, {
      folder: worktree,
      code,
      connections: [paper],
    });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    expect(options.plugins).toEqual([{ type: "local", path: code.plugin?.folder }]);
    expect(options.mcpServers).toEqual({
      paper: { type: "stdio", command: "/path/to/paper", args: ["mcp"], alwaysLoad: true },
    });
    const decisions = [
      await preToolUse(options, { name: "Skill", input: { skill: "mattpocock-skills:tdd" } }),
      await preToolUse(options, { name: "mcp__paper__get_basic_info", input: { fileId: "f" } }),
    ];
    for (const decision of decisions) {
      expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    }
    expect(checked).toEqual(["get_basic_info"]);
    expect(activities).toEqual([{ kind: "skill-loaded", name: "tdd", source: "matt" }]);
    await cleanUp();
  });

  it("asks the worker before every edit and command, and tells Claude why one is refused", async () => {
    const { worktree, code, asked } = await codeSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const decisions = [
      await preToolUse(options, {
        name: "Edit",
        input: { file_path: join(worktree, "notes.md"), old_string: "a", new_string: "b" },
      }),
      await preToolUse(options, {
        name: "Write",
        input: { file_path: join(worktree, "..", "outside.md"), content: "Escaped" },
      }),
      await preToolUse(options, {
        name: "Bash",
        input: { command: "pnpm test", description: "Run the tests" },
      }),
      await preToolUse(options, { name: "Bash", input: { command: "rm -rf ." } }),
      // A field Courtyard doesn't know is refused rather than let through unchecked.
      await preToolUse(options, { name: "Bash", input: { command: "pnpm test", cwd: "/" } }),
      await preToolUse(options, { name: "NotebookEdit", input: { notebook_path: "a.ipynb" } }),
    ].map((decision) => ("hookSpecificOutput" in decision ? decision.hookSpecificOutput : {}));

    expect(asked).toEqual([
      `edit ${join(worktree, "notes.md")}`,
      `edit ${join(worktree, "..", "outside.md")}`,
      "run pnpm test",
      "run rm -rf .",
    ]);
    const unchecked = await quotedInGuide("That request couldn't be checked");
    expect(decisions).toEqual([
      { hookEventName: "PreToolUse", permissionDecision: "allow" },
      {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Not out there.",
      },
      { hookEventName: "PreToolUse", permissionDecision: "allow" },
      {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Not that one.",
      },
      {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: unchecked,
      },
      expect.objectContaining({ permissionDecision: "deny" }),
    ]);
    await rm(worktree, { recursive: true, force: true });
  });

  it("tells the worker each command has ended, however it ended, so a build frees its place in the queue (#281)", async () => {
    const { worktree, code, ended } = await codeSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { folder: worktree, code });
    const planning = await runTurn(claudeCode);
    const [options, planningOptions] = runs.map((run) => run.options);
    if (!options || !planningOptions) throw new Error("no turn ran");

    await postToolUse(options, {
      name: "Bash",
      input: { command: "pnpm verify", description: "Check everything" },
      response: { stdout: "", stderr: "", interrupted: false },
    });
    await postToolUseFailure(options, {
      name: "Bash",
      input: { command: "pnpm test" },
      error: "Exit code 1",
    });
    await postToolUse(options, {
      name: "Read",
      input: { file_path: join(worktree, "notes.md") },
      response: "",
    });

    expect(ended).toEqual(["pnpm verify", "pnpm test"]);
    // A planning turn runs no commands, so it has nothing to say.
    expect(planningOptions.hooks?.PostToolUse ?? []).toEqual([]);
    expect(planning.result).toEqual(ok(null));
    await rm(worktree, { recursive: true, force: true });
  });

  it("runs nothing in the background, refusing a background command with what to do instead (#178)", async () => {
    const { worktree, code, asked } = await codeSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const background = await preToolUse(options, {
      name: "Bash",
      input: { command: "pnpm test", run_in_background: true },
    });
    const foreground = await preToolUse(options, {
      name: "Bash",
      input: { command: "pnpm test", run_in_background: false },
    });

    // Claude Code's background tasks are off, so Claude isn't offered them at all.
    expect(options.env).toMatchObject({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" });
    // One asked for anyway is refused before the worker is asked, so nothing starts.
    expect(background).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: await quotedInGuide("Run it in the foreground"),
      },
    });
    expect(foreground).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(asked).toEqual(["run pnpm test"]);
    await rm(worktree, { recursive: true, force: true });
  });

  it("waits as long as the owner takes to answer an approval, telling the worker what a command is for (#171)", async () => {
    const { worktree } = await codeSession();
    const heard: (string | undefined)[] = [];
    const code: CodeTurn = {
      worktree,
      env: {},
      plugin: null,
      edit: async () => ok(null),
      run: async (_command, why) => {
        heard.push(why);
        return ok(null);
      },
      ran: () => {},
      helper: async () => undefined,
      branchOff: async () => err("No helpers here."),
    };
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    await preToolUse(options, {
      name: "Bash",
      input: { command: "pnpm add left-pad", description: "Add the padding package" },
    });
    await preToolUse(options, { name: "Bash", input: { command: "git status" } });

    expect(heard).toEqual(["Add the padding package", undefined]);
    // Claude Code gives up on a hook after its timeout: a paused night is far shorter than this.
    const timeout = options.hooks?.PreToolUse?.[0]?.timeout ?? 0;
    expect(timeout).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
    await rm(worktree, { recursive: true, force: true });
  });

  it("gives a planning turn no edits, commands, settings or skills of its own", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode);
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const edit = await preToolUse(options, {
      name: "Write",
      input: { file_path: join(folder, "notes.md"), content: "Hello" },
    });
    const command = await preToolUse(options, { name: "Bash", input: { command: "pnpm test" } });
    const skill = await preToolUse(options, { name: "Skill", input: { skill: "tdd" } });

    expect(options.skills).toEqual([]);
    expect(edit).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(command).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(skill).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });
});

describe("helpers on a Claude code turn (#117, ADR 0027)", () => {
  /**
   * A code turn whose worker gives every helper a place, keeping what each was started as, what
   * each asked and reported, and its report once it finished.
   */
  const helpingSession = async () => {
    const worktree = await mkdtemp(join(tmpdir(), "courtyard-worktree-"));
    const started: { id: string; name: string }[] = [];
    /** What the model and each helper asked of the worker, the helper's by its name. */
    const asked: string[] = [];
    const reported: { helper: string; activity: Activity }[] = [];
    const finished: { helper: string; report: string }[] = [];
    /** The worktrees made for helpers (#395), and which helper was given each. */
    const made: string[] = [];
    const given: { helper: string; branch: string }[] = [];
    const say = (who: string, own?: { worktree: string }) => ({
      get worktree() {
        return own?.worktree ?? worktree;
      },
      env: {},
      plugin: null,
      edit: async (path: string) => {
        asked.push(`${who}: edit ${path}`);
        return ok(null);
      },
      run: async (command: string) => {
        asked.push(`${who}: run ${command}`);
        return ok(null);
      },
      ran: () => {},
    });
    const code: CodeTurn = {
      ...say("model"),
      helper: async (helper) => {
        started.push(helper);
        const own: { worktree?: string; branch?: string } = {};
        return {
          report: async (activity) => {
            reported.push({ helper: helper.name, activity });
          },
          code: say(helper.name, {
            get worktree() {
              return own.worktree ?? worktree;
            },
          }),
          connections: [],
          workIn: async (branch) => {
            given.push({ helper: helper.name, branch: branch.branch });
            Object.assign(own, branch);
          },
          finished: async (report) => {
            finished.push({ helper: helper.name, report });
            return own.branch === undefined ? undefined : `Merged ${own.branch}.`;
          },
        };
      },
      branchOff: async () => {
        const branch = `courtyard/session-helper-${made.length + 1}`;
        const folder = `${worktree}-helper-${made.length + 1}`;
        await mkdir(folder, { recursive: true });
        made.push(folder);
        return ok({ branch, worktree: folder });
      },
    };
    return { worktree, code, started, asked, reported, finished, made, given };
  };

  /** A tool call Claude Code checks with the adapter's hook: the model's, or a helper's. */
  const call = async (
    options: Options,
    tool: { name: string; input: unknown; id?: string; helper?: string },
  ) => {
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!hook) throw new Error("no PreToolUse hook");
    const id = tool.id ?? "tool-1";
    const answer = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: tool.name,
        tool_input: tool.input,
        tool_use_id: id,
        session_id: "s",
        transcript_path: "",
        cwd: folder,
        ...(tool.helper === undefined ? {} : { agent_id: tool.helper, agent_type: "Explore" }),
      },
      id,
      { signal: new AbortController().signal },
    );
    return "hookSpecificOutput" in answer ? answer.hookSpecificOutput : {};
  };

  /** Claude Code saying the helper it started for the Agent call `call` runs as `helper`. */
  const taskStarted = (helper: string, call: string) => ({
    type: "system",
    subtype: "task_started",
    task_id: helper,
    tool_use_id: call,
    description: "A helper",
    task_type: "local_agent",
  });

  it("offers the Agent tool only in a code session, with every helper on the session's model", async () => {
    const { worktree, code } = await helpingSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = "haiku";
    try {
      await runTurn(claudeCode, { folder: worktree, code });
      await runTurn(claudeCode);
    } finally {
      delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
    }
    const [coding, planning] = runs.map((run) => run.options);

    expect(coding?.tools).toContain("Agent");
    expect(planning?.tools).not.toContain("Agent");
    // Claude Code ignores any model a helper's type or its Agent call names, and the machine's.
    expect(coding?.env).toMatchObject({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" });
    expect(coding?.env).not.toHaveProperty("CLAUDE_CODE_SUBAGENT_MODEL");
    await rm(worktree, { recursive: true, force: true });
  });

  it("starts a helper once the worker gives it a place, named by what it's for, never in the background or on another model", async () => {
    const { worktree, code, started } = await helpingSession();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const reviewing = await call(options, {
      name: "Agent",
      input: {
        description: "Review against standards",
        prompt: "Review the branch against the repository's standards.",
        subagent_type: "Explore",
        model: "haiku",
        run_in_background: true,
      },
    });
    const untitled = await call(options, {
      name: "Agent",
      input: { description: " ", prompt: "Plan it.", subagent_type: "Plan" },
      id: "tool-2",
    });

    expect(started).toEqual([
      { id: "tool-1", name: "Review against standards" },
      { id: "tool-2", name: "Plan" },
    ]);
    expect(reviewing).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        description: "Review against standards",
        prompt: "Review the branch against the repository's standards.",
        subagent_type: "Explore",
        run_in_background: false,
      },
    });
    expect(untitled).toMatchObject({ permissionDecision: "allow" });
    await rm(worktree, { recursive: true, force: true });
  });

  it("starts only Claude Code's own types of helper and the repository's, never in a folder it names or remotely", async () => {
    const { worktree, code, started } = await helpingSession();
    await mkdir(join(worktree, ".claude", "agents"), { recursive: true });
    await writeFile(
      join(worktree, ".claude", "agents", "code-reviewer.md"),
      "---\nname: code-reviewer\ndescription: Reviews code.\n---\nReview it.\n",
    );
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");
    const agent = (input: Record<string, unknown>) => ({
      name: "Agent",
      input: { description: "Review it", prompt: "Review it.", ...input },
    });

    const decisions = [
      await call(options, agent({ subagent_type: "code-reviewer" })),
      await call(options, agent({})),
      await call(options, agent({ subagent_type: "statusline-setup" })),
      await call(options, agent({ cwd: "/path/to/elsewhere" })),
      await call(options, agent({ isolation: "remote" })),
    ];
    const unchecked = {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: await quotedInGuide("That request couldn't be checked"),
    };

    expect(decisions).toEqual([
      expect.objectContaining({ permissionDecision: "allow" }),
      expect.objectContaining({ permissionDecision: "allow" }),
      {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: await quotedInGuide("That helper isn't one you can start here"),
      },
      unchecked,
      unchecked,
    ]);
    expect(started.map((helper) => helper.name)).toEqual(["Review it", "Review it"]);
    await rm(worktree, { recursive: true, force: true });
  });

  it("makes a helper's own worktree itself when Claude Code asks for one, holds that helper to it, and tells Claude how its branch merged back (#395)", async () => {
    const { worktree, code, given, made, reported } = await helpingSession();
    const { claudeCode, runs } = stubClaudeCode({
      messages: [taskStarted("a1b2", "tool-1"), taskStarted("c3d4", "tool-2"), success],
    });
    await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");
    const worktreeCreate = options.hooks?.WorktreeCreate?.[0]?.hooks[0];
    if (!worktreeCreate) throw new Error("no WorktreeCreate hook");
    const writes = {
      description: "Build the API",
      prompt: "Build it.",
      subagent_type: "general-purpose",
      isolation: "worktree",
    };
    const reviews = { description: "Review it", prompt: "Review it.", subagent_type: "Explore" };

    const starting = await call(options, { name: "Agent", input: writes });
    await call(options, { name: "Agent", input: reviews, id: "tool-2" });
    // Claude Code asks for the writer's worktree by a name made of the id it gave the helper.
    const asked = await worktreeCreate(
      {
        hook_event_name: "WorktreeCreate",
        name: "agent-a1b2",
        session_id: "s",
        transcript_path: "",
        cwd: worktree,
      },
      undefined,
      { signal: new AbortController().signal },
    );
    const [own] = made;
    if (own === undefined) throw new Error("no worktree made");
    await writeFile(join(own, "api.ts"), "export {};\n");
    await writeFile(join(worktree, "notes.md"), "Notes\n");
    const inOwn = await call(options, {
      name: "Read",
      input: { file_path: join(own, "api.ts") },
      id: "tool-3",
      helper: "a1b2",
    });
    const inSession = await call(options, {
      name: "Read",
      input: { file_path: join(worktree, "notes.md") },
      id: "tool-4",
      helper: "a1b2",
    });
    const reviewing = await call(options, {
      name: "Read",
      input: { file_path: join(worktree, "notes.md") },
      id: "tool-5",
      helper: "c3d4",
    });
    const answers: unknown[] = [];
    for (const hook of options.hooks?.PostToolUse?.flatMap((matcher) => matcher.hooks) ?? []) {
      answers.push(
        await hook(
          {
            hook_event_name: "PostToolUse",
            tool_name: "Agent",
            tool_input: writes,
            tool_response: {
              status: "completed",
              content: [{ type: "text", text: "Built it." }],
              worktreePath: own,
            },
            tool_use_id: "tool-1",
            session_id: "s",
            transcript_path: "",
            cwd: worktree,
          },
          "tool-1",
          { signal: new AbortController().signal },
        ),
      );
    }

    // Claude Code makes nothing itself: the worktree is Courtyard's, beside the session's.
    expect(starting).toMatchObject({ permissionDecision: "allow", updatedInput: writes });
    expect(asked).toEqual({
      hookSpecificOutput: { hookEventName: "WorktreeCreate", worktreePath: own },
    });
    expect(given).toEqual([{ helper: "Build the API", branch: "courtyard/session-helper-1" }]);
    expect([inOwn, inSession, reviewing]).toEqual([
      expect.objectContaining({ permissionDecision: "allow" }),
      expect.objectContaining({ permissionDecision: "deny" }),
      expect.objectContaining({ permissionDecision: "allow" }),
    ]);
    expect(reported).toEqual([
      { helper: "Build the API", activity: { kind: "read-file", path: "api.ts" } },
      { helper: "Review it", activity: { kind: "read-file", path: "notes.md" } },
    ]);
    expect(answers).toContainEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Merged courtyard/session-helper-1.",
      },
    });
    await rm(worktree, { recursive: true, force: true });
    await rm(own, { recursive: true, force: true });
  });

  it("checks each of a helper's tool calls as its own, and hands the worker its report when it finishes", async () => {
    const { worktree, code, asked, reported, finished } = await helpingSession();
    const { claudeCode, runs } = stubClaudeCode({
      messages: [taskStarted("agent-a", "tool-1"), taskStarted("agent-b", "tool-2"), success],
    });
    await runTurn(claudeCode, { folder: worktree, code });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");
    const helper = (description: string) => ({
      description,
      prompt: "Look.",
      subagent_type: "Explore",
    });
    await call(options, { name: "Agent", input: helper("Review against standards") });
    await call(options, { name: "Agent", input: helper("Check the e2e tests"), id: "tool-2" });

    const command = await call(options, {
      name: "Bash",
      input: { command: "pnpm test" },
      id: "tool-3",
      helper: "agent-b",
    });
    await call(options, {
      name: "Read",
      input: { file_path: join(worktree, "slots.ts") },
      id: "tool-4",
      helper: "agent-a",
    });
    await call(options, { name: "Bash", input: { command: "git status" }, id: "tool-5" });
    await postToolUse(options, {
      name: "Agent",
      input: helper("Review against standards"),
      response: {
        status: "completed",
        content: [{ type: "text", text: "Follows the standards." }],
      },
    });

    expect(command).toMatchObject({ permissionDecision: "allow" });
    expect(asked).toEqual(["Check the e2e tests: run pnpm test", "model: run git status"]);
    expect(reported).toEqual([
      { helper: "Review against standards", activity: { kind: "read-file", path: "slots.ts" } },
    ]);
    expect(finished).toEqual([
      { helper: "Review against standards", report: "Follows the standards." },
    ]);
    await rm(worktree, { recursive: true, force: true });
  });

  it("refuses a helper starting helpers of its own, and one the worker couldn't start as the turn stopped", async () => {
    const { worktree, code } = await helpingSession();
    const stopped: CodeTurn = { ...code, helper: async () => undefined };
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { folder: worktree, code });
    await runTurn(claudeCode, { folder: worktree, code: stopped });
    const [options, stoppedOptions] = runs.map((run) => run.options);
    if (!options || !stoppedOptions) throw new Error("no turn ran");
    const agent = { name: "Agent", input: { description: "Dig deeper", prompt: "Dig." } };

    const nested = await call(options, { ...agent, helper: "agent-a" });
    const late = await call(stoppedOptions, agent);

    expect(nested).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: await quotedInGuide("A helper can't start helpers of its own"),
    });
    expect(late).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "The owner stopped this turn, so nothing more is done.",
    });
    await rm(worktree, { recursive: true, force: true });
  });
});

describe("web search on a Claude turn (ADR 0019)", () => {
  it("offers WebSearch and WebFetch beside the planning tools when the framing offers web search", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, { framing: searchingFraming() });
    await runTurn(claudeCode, { framing: framingWith([]) });

    expect(runs.map((run) => run.options.tools)).toEqual([
      ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
      ["Read", "Glob", "Grep"],
    ]);
  });

  it("allows a search and reports it, and refuses both tools on a turn without web search", async () => {
    const reported: Activity[] = [];
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, {
      framing: searchingFraming(),
      report: async (activity) => {
        reported.push(activity);
      },
    });
    await runTurn(claudeCode, { framing: framingWith([]) });
    const [searching, without] = runs.map((run) => run.options);
    if (!searching || !without) throw new Error("no turns ran");

    // As Claude Code sends it, with how thoroughly to search.
    const search = {
      name: "WebSearch",
      input: { query: "Titan T-3 J-hook width", mode: "extended" },
    };
    expect(await preToolUse(searching, search)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    expect(reported).toEqual([{ kind: "web-searched", query: "Titan T-3 J-hook width" }]);
    for (const tool of [
      search,
      { name: "WebFetch", input: { url: "https://titan.fitness/", prompt: "Hook width?" } },
    ]) {
      expect(await preToolUse(without, tool)).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    }
  });

  it("fetches only a page from the turn's search results or the owner's messages, refusing any other with a reason", async () => {
    const reported: Activity[] = [];
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, {
      framing: searchingFraming(["https://courtyard.example/manual.pdf"]),
      report: async (activity) => {
        reported.push(activity);
      },
    });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");
    const fetch = (url: string) =>
      preToolUse(options, { name: "WebFetch", input: { url, prompt: "What's the hook width?" } });

    // Nothing has been searched yet: only the owner's link can be read.
    expect(await fetch("https://titan.fitness/j-hooks")).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringMatching(/search results.*owner/i),
      },
    });
    expect(await fetch("https://courtyard.example/manual.pdf")).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });

    await postToolUse(options, {
      name: "WebSearch",
      input: { query: "Titan T-3 J-hooks" },
      response: searchResults("Titan T-3 J-hooks", [
        { title: "T-3 Series J-Hooks | Titan Fitness", url: "https://titan.fitness/j-hooks" },
      ]),
    });

    expect(await fetch("https://titan.fitness/j-hooks")).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    // A page the results don't name, such as one with the owner's details put into its address.
    for (const url of [
      "https://titan.fitness/j-hooks?owner=Leeds",
      "https://example.com/collect?q=garage-gym",
      "file:///etc/hosts",
    ]) {
      expect(await fetch(url)).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    }
    expect(reported).toEqual([
      { kind: "page-read", url: "https://courtyard.example/manual.pdf", site: "courtyard.example" },
      { kind: "page-read", url: "https://titan.fitness/j-hooks", site: "titan.fitness" },
    ]);
  });

  it("lists the pages the answer links to and the pages it read as its sources, titled from the search results", async () => {
    const search = async (options: Options) => {
      await preToolUse(options, { name: "WebSearch", input: { query: "Titan T-3 J-hooks" } });
      await postToolUse(options, {
        name: "WebSearch",
        input: { query: "Titan T-3 J-hooks" },
        response: searchResults("Titan T-3 J-hooks", [
          { title: "T-3 Series J-Hooks | Titan Fitness", url: "https://titan.fitness/j-hooks" },
          {
            title: "Titan T-3 Power Rack review: what fits",
            url: "https://www.garagegymreviews.com/titan-t3",
          },
          { title: "The Ohio Bar - Black Oxide", url: "https://www.roguefitness.com/gb/ohio" },
          { title: "Not used", url: "https://example.com/unused" },
        ]),
      });
    };
    const read = (options: Options) =>
      preToolUse(options, {
        name: "WebFetch",
        input: { url: "https://www.garagegymreviews.com/titan-t3", prompt: "What fits?" },
      });
    const { claudeCode } = stubClaudeCode({
      messages: [
        search,
        read,
        textDelta(
          "Yes: the hooks take a 28–32 mm shaft ([Titan](https://titan.fitness/j-hooks#specs)). ",
        ),
        textDelta("A bar to go with them: [Ohio Bar](https://www.roguefitness.com/gb/ohio)."),
        success,
      ],
    });

    const { sources } = await runTurn(claudeCode, { framing: searchingFraming() });

    expect(sources).toEqual([
      // The title's last part names the site only when it's the site's own name.
      { site: "Titan Fitness", title: "T-3 Series J-Hooks", url: "https://titan.fitness/j-hooks" },
      {
        site: "roguefitness.com",
        title: "The Ohio Bar - Black Oxide",
        url: "https://www.roguefitness.com/gb/ohio",
      },
      {
        site: "garagegymreviews.com",
        title: "Titan T-3 Power Rack review: what fits",
        url: "https://www.garagegymreviews.com/titan-t3",
      },
    ]);
  });

  it("lists a turn's search results as its sources when the answer neither links nor reads a page, the results it names first", async () => {
    const search =
      (query: string, hits: readonly { title: string; url: string }[]) =>
      async (options: Options) => {
        await preToolUse(options, { name: "WebSearch", input: { query } });
        await postToolUse(options, {
          name: "WebSearch",
          input: { query },
          response: searchResults(query, hits),
        });
      };
    const searches = [
      search("Titan T-3 J-hooks", [
        { title: "T-3 Series J-Hooks | Titan Fitness", url: "https://titan.fitness/j-hooks" },
        { title: "J-hooks guide", url: "https://www.garagegymreviews.com/j-hooks" },
      ]),
      search("Ohio bar price", [
        { title: "The Ohio Bar | Rogue Fitness UK", url: "https://www.roguefitness.com/gb/ohio" },
        { title: "Ohio bar review", url: "https://barbend.com/ohio" },
      ]),
    ];
    const naming = stubClaudeCode({
      messages: [
        ...searches,
        textDelta("Titan Fitness lists 28–32 mm; Rogue Fitness UK sells the Ohio at £350."),
        success,
      ],
    });
    const plain = stubClaudeCode({
      messages: [...searches, textDelta("The hooks take a 28–32 mm shaft."), success],
    });

    const named = await runTurn(naming.claudeCode, { framing: searchingFraming() });
    const unnamed = await runTurn(plain.claudeCode, { framing: searchingFraming() });

    // The results it names, from every search.
    expect(named.sources.map((source) => source.site)).toEqual([
      "Titan Fitness",
      "Rogue Fitness UK",
    ]);
    // Otherwise every result, each search's top ones first.
    expect(unnamed.sources.map((source) => source.url)).toEqual([
      "https://titan.fitness/j-hooks",
      "https://www.roguefitness.com/gb/ohio",
      "https://www.garagegymreviews.com/j-hooks",
      "https://barbend.com/ohio",
    ]);
  });

  it("lists no sources for a turn that didn't use the web, links or not", async () => {
    const { claudeCode } = stubClaudeCode({
      messages: [textDelta("See [the manual](https://titan.fitness/manual)."), success],
    });

    const searching = await runTurn(claudeCode, { framing: searchingFraming() });
    const without = await runTurn(claudeCode, { framing: framingWith([]) });

    expect([searching.sources, without.sources]).toEqual([[], []]);
  });

  it("refuses a search or a fetch with an input it doesn't know", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { framing: searchingFraming(["https://titan.fitness/"]) });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    for (const tool of [
      { name: "WebSearch", input: { query: "J-hooks", to: "https://example.com" } },
      { name: "WebFetch", input: { url: "https://titan.fitness/", prompt: "", method: "POST" } },
    ]) {
      expect(await preToolUse(options, tool)).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    }
  });
});

describe("a tool connection on a Claude turn (ADR 0008, ADR 0023)", () => {
  /** Paper's connection as the worker hands it over: each call checked, each result kept. */
  const paperConnection = () => {
    const checked: ToolCall[] = [];
    const done: (ToolCall & { ok: boolean; content: readonly ToolContent[] })[] = [];
    const connection: ToolConnection = {
      name: "paper",
      server: { command: "/path/to/paper", args: ["mcp"] },
      check: async (call) => {
        checked.push(call);
        return call.tool === "delete_nodes" ? err("The owner denied that.") : ok(null);
      },
      done: async (call) => {
        done.push(call);
        return call.ok ? undefined : "Paper may not be open on the worker machine.";
      },
    };
    return { connection, checked, done };
  };

  it("passes its MCP server to Claude Code as a command on the worker machine, only when the turn has one", async () => {
    const { connection } = paperConnection();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success, success] });

    await runTurn(claudeCode, { connections: [connection] });
    await runTurn(claudeCode);

    expect(runs[0]?.options.mcpServers).toEqual({
      paper: { type: "stdio", command: "/path/to/paper", args: ["mcp"], alwaysLoad: true },
    });
    // Still nothing from the machine's own Claude Code setup.
    expect(runs[0]?.options.strictMcpConfig).toBe(true);
    expect(runs[1]?.options.mcpServers).toEqual({});
  });

  it("asks the worker before each of its tools, by the tool's own name, and tells Claude why one is refused", async () => {
    const { connection, checked } = paperConnection();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { connections: [connection] });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    const drawn = await preToolUse(options, {
      name: "mcp__paper__write_html",
      input: { fileId: "file-1", html: "<div />", targetNodeId: "A-1", mode: "insert-children" },
    });
    const deleted = await preToolUse(options, {
      name: "mcp__paper__delete_nodes",
      input: { fileId: "file-1", nodeIds: ["B-2"] },
    });
    // A server the turn doesn't have is refused, unasked.
    const other = await preToolUse(options, { name: "mcp__homelab__restart", input: {} });

    expect(checked).toEqual([
      {
        tool: "write_html",
        input: { fileId: "file-1", html: "<div />", targetNodeId: "A-1", mode: "insert-children" },
      },
      { tool: "delete_nodes", input: { fileId: "file-1", nodeIds: ["B-2"] } },
    ]);
    expect(drawn).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(deleted).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "The owner denied that.",
      },
    });
    expect(other).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    // An approval waits on the owner, however long they take.
    expect(options.hooks?.PreToolUse?.[0]?.timeout ?? 0).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
  });

  it("hands each result to the worker, images as data URLs, and tells Claude what the worker adds to a failure", async () => {
    const { connection, done } = paperConnection();
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    await runTurn(claudeCode, { connections: [connection] });
    const options = runs[0]?.options;
    if (!options) throw new Error("no turn ran");

    await postToolUse(options, {
      name: "mcp__paper__get_screenshot",
      input: { fileId: "file-1", nodeId: "A-1" },
      response: [
        { type: "text", text: '{"fileId":"file-1"}' },
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
      ],
    });
    const failed = await postToolUseFailure(options, {
      name: "mcp__paper__get_basic_info",
      input: { fileId: "file-1" },
      error: "connect ECONNREFUSED 127.0.0.1",
    });

    expect(done).toEqual([
      {
        tool: "get_screenshot",
        input: { fileId: "file-1", nodeId: "A-1" },
        ok: true,
        content: [
          { kind: "text", text: '{"fileId":"file-1"}' },
          { kind: "image", dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
        ],
      },
      {
        tool: "get_basic_info",
        input: { fileId: "file-1" },
        ok: false,
        content: [{ kind: "text", text: "connect ECONNREFUSED 127.0.0.1" }],
      },
    ]);
    expect(failed).toEqual([
      {
        hookSpecificOutput: {
          hookEventName: "PostToolUseFailure",
          additionalContext: "Paper may not be open on the worker machine.",
        },
      },
    ]);
  });
});

describe("the save tool on a Claude turn", () => {
  it("is offered as Courtyard's own tool, allowed through, and hands its input to the worker unchanged", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const handed: unknown[] = [];

    await runTurn(claudeCode, {
      framing: framingWith([SAVE_TOOL]),
      callTool: async (call) => {
        handed.push(call);
        return { ok: false, content: [{ kind: "text", text: "That line is too long." }] };
      },
    });

    const options = runs[0]?.options;
    const server = options?.mcpServers?.courtyard;
    if (!options || server?.type !== "sdk") throw new Error("no in-process server");
    expect(
      await preToolUse(options, { name: "mcp__courtyard__save_to_context", input: {} }),
    ).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });

    // Called the way Claude Code calls it: over MCP.
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["save_to_context"]);
    const input = { action: "add", section: "facts", text: "Padel lessons on Tuesdays." };
    const result = await client.callTool({ name: "save_to_context", arguments: input });
    await client.close();

    expect(handed).toEqual([{ name: "save_to_context", input }]);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "That line is too long." }],
    });
  });

  it("comes with every other Courtyard tool of the turn, on the same server, each handed over by name", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const handed: unknown[] = [];
    const USE_SKILL: TurnTool = {
      name: "use_skill",
      description: "Loads a skill.",
      input: { name: z.string(), path: z.string().optional() },
    };

    await runTurn(claudeCode, {
      framing: framingWith([SAVE_TOOL, USE_SKILL]),
      callTool: async (call) => {
        handed.push(call);
        return { ok: true, content: [{ kind: "text", text: "---\nname: grilling\n---" }] };
      },
    });

    const options = runs[0]?.options;
    const server = options?.mcpServers?.courtyard;
    if (!options || server?.type !== "sdk") throw new Error("no in-process server");
    expect(
      await preToolUse(options, { name: "mcp__courtyard__use_skill", input: {} }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      "save_to_context",
      "use_skill",
    ]);
    const result = await client.callTool({ name: "use_skill", arguments: { name: "grilling" } });
    await client.close();

    expect(handed).toEqual([{ name: "use_skill", input: { name: "grilling" } }]);
    expect(result).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "---\nname: grilling\n---" }],
    });
  });

  it("hands a list over unchanged, as suggested replies are, even one the worker will refuse", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const handed: unknown[] = [];
    const SUGGEST_REPLIES: TurnTool = {
      name: "suggest_replies",
      description: "Offers the owner replies to tap.",
      input: { replies: z.array(z.string()) },
    };

    await runTurn(claudeCode, {
      framing: framingWith([SAVE_TOOL, SUGGEST_REPLIES]),
      callTool: async (call) => {
        handed.push(call);
        return { ok: false, content: [{ kind: "text", text: "Suggest two or three replies." }] };
      },
    });

    const options = runs[0]?.options;
    const server = options?.mcpServers?.courtyard;
    if (!options || server?.type !== "sdk") throw new Error("no in-process server");
    expect(
      await preToolUse(options, { name: "mcp__courtyard__suggest_replies", input: {} }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const input = { replies: ["One", "Two", "Three", "Four"] };
    const result = await client.callTool({ name: "suggest_replies", arguments: input });
    await client.close();

    expect(handed).toEqual([{ name: "suggest_replies", input }]);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Suggest two or three replies." }],
    });
  });

  it("hands a document over whole, and gives the model the worker's refusal of a stale one", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const handed: unknown[] = [];
    const SAVE_DOCUMENT: TurnTool = {
      name: "save_document",
      description: "Saves a document.",
      input: { text: z.string(), path: z.string().optional(), change: z.string().optional() },
    };
    const stale =
      "docs/packing-list.md has changed since you read it. Read it again, then send its whole new text with your change.";

    await runTurn(claudeCode, {
      framing: framingWith([SAVE_TOOL, SAVE_DOCUMENT]),
      callTool: async (call) => {
        handed.push(call);
        return { ok: false, content: [{ kind: "text", text: stale }] };
      },
    });

    const options = runs[0]?.options;
    const server = options?.mcpServers?.courtyard;
    if (!options || server?.type !== "sdk") throw new Error("no in-process server");
    expect(
      await preToolUse(options, { name: "mcp__courtyard__save_document", input: {} }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const input = {
      path: "docs/packing-list.md",
      text: "# Packing list\n\n- Grips",
      change: "grips",
    };
    const result = await client.callTool({ name: "save_document", arguments: input });
    await client.close();

    expect(handed).toEqual([{ name: "save_document", input }]);
    expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: stale }] });
  });

  it("hands a Thing save over as Claude sent it, photo number and all, and gives back the worker's answer", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const handed: unknown[] = [];
    const SAVE_THING: TurnTool = {
      name: "save_thing",
      description: "Saves a Thing.",
      input: {
        thing: z.string().optional(),
        history: z.string().optional(),
        photo: z.number().int().optional(),
      },
    };

    await runTurn(claudeCode, {
      framing: framingWith([SAVE_TOOL, SAVE_THING]),
      callTool: async (call) => {
        handed.push(call);
        return { ok: true, content: [{ kind: "text", text: "Changed [T2] Chain." }] };
      },
    });

    const options = runs[0]?.options;
    const server = options?.mcpServers?.courtyard;
    if (!options || server?.type !== "sdk") throw new Error("no in-process server");
    expect(
      await preToolUse(options, { name: "mcp__courtyard__save_thing", input: {} }),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const input = { thing: "T2", history: "Swapped", photo: 1 };
    const result = await client.callTool({ name: "save_thing", arguments: input });
    await client.close();

    expect(handed).toEqual([{ name: "save_thing", input }]);
    expect(result).toMatchObject({ content: [{ type: "text", text: "Changed [T2] Chain." }] });
  });

  it("isn't offered, or allowed, on a turn whose framing has none", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, { framing: framingWith([]) });

    const options = runs[0]?.options;
    if (!options) throw new Error("no run");
    expect(options.mcpServers).toEqual({});
    expect(
      await preToolUse(options, { name: "mcp__courtyard__save_to_context", input: {} }),
    ).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
  });
});

describe("stopping a Claude turn", () => {
  it("stops Claude Code promptly when the owner stops the turn, keeping what it wrote", async () => {
    const stop = new AbortController();
    let givenToClaudeCode: AbortController | undefined;
    const claudeCode: ClaudeCode = {
      check: async () => ({ account: {}, models: [] }),
      run: ({ options }) =>
        (async function* () {
          givenToClaudeCode = options.abortController;
          yield textDelta("Half an answer");
          // Claude Code keeps going until it's aborted, then stops with an error.
          await new Promise<void>((resolve) => {
            options.abortController?.signal.addEventListener("abort", () => resolve());
          });
          throw new Error("Claude Code process aborted by user");
        })(),
    };
    const emitted: string[] = [];

    const { result } = await runTurn(claudeCode, {
      signal: stop.signal,
      emit: async (text) => {
        emitted.push(text);
        stop.abort();
      },
    });

    expect(givenToClaudeCode?.signal.aborted).toBe(true);
    expect(emitted).toEqual(["Half an answer"]);
    expect(result).toEqual({ ok: true, value: null });
  });
});

/**
 * What the owner adds while a turn runs (#252), as the worker hands it to a provider: `add` sends
 * one, and it says which the provider took, which it says were read, and whether it's done.
 */
const ownerAdding = () => {
  const waiting: AddedMessage[] = [];
  const read: number[] = [];
  let done = false;
  let wake: ((added: AddedMessage | undefined) => void) | undefined;
  const messages: AddedMessages = {
    next: () => {
      const first = waiting.shift();
      if (first !== undefined || done) return Promise.resolve(first);
      return new Promise((resolve) => {
        wake = resolve;
      });
    },
    waiting: () => waiting.splice(0),
    read: (added) => {
      read.push(added.seq);
    },
    done: () => {
      done = true;
      wake?.(undefined);
    },
  };
  return {
    messages,
    read,
    isDone: () => done,
    add: (added: AddedMessage) => {
      const waiter = wake;
      wake = undefined;
      if (waiter === undefined) waiting.push(added);
      else waiter(added);
    },
  };
};

describe("steering a Claude turn (#252)", () => {
  it("gives what the owner adds to Claude Code at its next step, and ends its input with the answer", async () => {
    const owner = ownerAdding();
    const prompts: unknown[] = [];
    let inputEnded = false;
    const claudeCode: ClaudeCode = {
      check: async () => ({ account: {}, models: [] }),
      run: ({ prompt }) =>
        (async function* () {
          if (typeof prompt === "string") throw new Error("not streamed");
          const input = prompt[Symbol.asyncIterator]();
          prompts.push((await input.next()).value);
          yield messageStart();
          yield textDelta("Working on it.");
          owner.add({ seq: 7, text: "Use the blue one" });
          // The owner's words come in on the turn's input, for Claude Code to fold in.
          prompts.push((await input.next()).value);
          yield messageStart();
          yield textDelta("Blue it is.");
          yield { ...success, queued_turn_count: 0 };
          inputEnded = (await input.next()).done === true;
        })(),
    };

    const { emitted, result } = await runTurn(claudeCode, { added: owner.messages });

    expect(result).toEqual({ ok: true, value: null });
    expect(prompts[1]).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Use the blue one" }] },
      parent_tool_use_id: null,
      priority: "next",
    });
    // Read once Claude's next message started with it in view.
    expect(owner.read).toEqual([7]);
    expect(emitted.join("")).toContain("Blue it is.");
    expect(owner.isDone()).toBe(true);
    expect(inputEnded).toBe(true);
  });

  it("keeps its input open while Claude Code has more of the owner's messages to answer", async () => {
    const owner = ownerAdding();
    let inputEnded = false;
    const claudeCode: ClaudeCode = {
      check: async () => ({ account: {}, models: [] }),
      run: ({ prompt }) =>
        (async function* () {
          if (typeof prompt === "string") throw new Error("not streamed");
          const input = prompt[Symbol.asyncIterator]();
          await input.next();
          owner.add({ seq: 9, text: "And this" });
          await input.next();
          // The answer ended with the owner's message still to answer: another result follows.
          yield { ...success, queued_turn_count: 1 };
          expect(owner.isDone()).toBe(false);
          yield messageStart();
          yield textDelta("And that.");
          yield { ...success, queued_turn_count: 0 };
          inputEnded = (await input.next()).done === true;
        })(),
    };

    const { emitted } = await runTurn(claudeCode, { added: owner.messages });

    expect(emitted.join("")).toContain("And that.");
    expect(owner.read).toEqual([9]);
    expect(inputEnded).toBe(true);
  });
});

describe("a one-off question to Claude (a tidy, a session's title)", () => {
  const Answer = z.object({ changes: z.array(z.object({ kind: z.string() })) });

  const ask = (claudeCode: ClaudeCode, options: { effort?: Effort } = {}) =>
    createClaudeProvider({ claudeCode }).answerOnce({
      purpose: "tidy",
      model: ModelId.parse("sonnet"),
      ...options,
      instructions: "The tidy's instructions.",
      message: "The file.",
      schema: Answer,
      signal: new AbortController().signal,
    });

  it("asks for an answer in the schema's shape, isolated and with no tools, and returns it", async () => {
    const answer = { changes: [{ kind: "remove" }] };
    const { claudeCode, runs } = stubClaudeCode({
      messages: [{ ...success, structured_output: answer }],
    });

    expect(await ask(claudeCode)).toEqual({ ok: true, value: answer });
    const [run] = runs;
    expect(run?.prompt).toBe("The file.");
    expect(run?.options).toMatchObject({
      systemPrompt: "The tidy's instructions.",
      model: "sonnet",
      tools: [],
      permissionMode: "dontAsk",
      settingSources: [],
      outputFormat: { type: "json_schema", schema: { type: "object" } },
    });
    // Claude Code refuses a schema that names its own draft.
    expect(run?.options.outputFormat?.schema).not.toHaveProperty("$schema");
    expect(run?.options.cwd).not.toContain("context");
  });

  it("sends the effort it's asked at, and none for the model's default", async () => {
    const { claudeCode, runs } = stubClaudeCode({
      messages: [{ ...success, structured_output: { changes: [] } }],
    });

    await ask(claudeCode, { effort: Effort.parse("low") });
    await ask(claudeCode);

    expect(runs[0]?.options.effort).toBe("low");
    expect(runs[1]?.options).not.toHaveProperty("effort");
  });

  it("fails an effort Claude doesn't know, rather than send it", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    const answer = await ask(claudeCode, { effort: Effort.parse("ludicrous") });

    expect(runs).toEqual([]);
    expect(answer).toEqual({
      ok: false,
      error: { kind: "unknown", message: expect.stringMatching(/effort/) },
    });
  });

  it("fails in plain words when no answer comes back", async () => {
    const { claudeCode } = stubClaudeCode({ messages: [success] });

    expect(await ask(claudeCode)).toEqual({
      ok: false,
      error: { kind: "unknown", message: "Claude couldn't answer this time." },
    });
  });

  it("turns a usage limit into a rate-limited failure", async () => {
    const { claudeCode } = stubClaudeCode({
      messages: [
        { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
        { ...success, is_error: true },
      ],
    });

    expect(await ask(claudeCode)).toEqual({ ok: false, error: { kind: "rate-limited" } });
  });
});
