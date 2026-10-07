import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { Effort, ModelId } from "@courtyard/contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type ClaudeCode, createClaudeProvider } from "./providers/claude.ts";
import type { Activity, CourtyardTool, TurnInput } from "./providers/index.ts";

const folder = resolve("/path/to/context/garage-gym");

/** A stand-in for Claude Code: records what each turn asked for and replays scripted messages. */
const stubClaudeCode = (
  script: { check?: (signal: AbortSignal) => Promise<unknown>; messages?: unknown[] } = {},
) => {
  const runs: { prompt: string; options: Options }[] = [];
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
        for (const message of script.messages ?? []) yield message;
      })();
    },
  };
  return { claudeCode, runs };
};

const textDelta = (text: string) => ({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
});
const success = { type: "result", subtype: "success", is_error: false, result: "" };

/** Runs one turn and collects what it emitted and reported. */
const runTurn = async (claudeCode: ClaudeCode, overrides: Partial<TurnInput> = {}) => {
  const provider = createClaudeProvider({ claudeCode });
  const emitted: string[] = [];
  const activities: Activity[] = [];
  const result = await provider.runTurn({
    model: ModelId.parse("sonnet"),
    effort: undefined,
    folder,
    framing: {
      instructions: "The turn's instructions.",
      message: "Where should the rack go?",
      newMessage: "Where should the rack go?",
      saveTool: null,
      fileTools: null,
    },
    save: async () => ({ saved: false, reply: "No saves in this test." }),
    emit: async (text) => {
      emitted.push(text);
    },
    report: async (activity) => {
      activities.push(activity);
    },
    signal: new AbortController().signal,
    ...overrides,
  });
  return { result, emitted, activities };
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

describe("Claude's status", () => {
  it("is available with its models when Claude Code is logged in", async () => {
    const status = await createClaudeProvider({ claudeCode: stubClaudeCode().claudeCode }).status();

    expect(status).toMatchObject({ id: "claude", available: true });
    if (!status.available) throw new Error("expected available");
    expect(status.models.map((m) => m.id)).toEqual(["default", "opus", "sonnet"]);
    expect(status.capabilities).toEqual({
      readsFiles: true,
      codes: false,
      usesTools: false,
      savesContext: true,
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
  });

  it("keeps Default's own name when Claude Code's description doesn't name a model", async () => {
    const status = await createClaudeProvider({ claudeCode: stubClaudeCode().claudeCode }).status();

    if (!status.available) throw new Error("expected available");
    expect(status.models[0]?.label).toBe("Claude · Default (recommended)");
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
        saveTool: null,
        fileTools: null,
      },
    });

    expect(runs[0]?.options.systemPrompt).toBe("Exactly these instructions.");
    expect(runs[0]?.prompt).toBe("Exactly this message.");
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

  it("turns a lost login into an unavailable provider, in plain words", async () => {
    const { claudeCode } = stubClaudeCode({
      messages: [{ type: "assistant", error: "authentication_failed", message: { content: [] } }],
    });

    const { result } = await runTurn(claudeCode);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "provider-unavailable", message: expect.stringMatching(/log in/i) },
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

    const status = await createClaudeProvider({ claudeCode, checkTimeoutMs: 20 }).status();

    expect(status).toMatchObject({ available: false, reason: expect.stringMatching(/answer/) });
    expect(stopped).toBe(true);
  });
});

const SAVE_TOOL: CourtyardTool = {
  name: "save_to_context",
  description: "Saves one line to the context file.",
  input: {
    action: z.enum(["add", "change", "remove"]),
    section: z.enum(["facts", "plans", "ideas"]),
    text: z.string().optional(),
  },
};

const framingWith = (saveTool: CourtyardTool | null) => ({
  instructions: "The turn's instructions.",
  message: "I've booked padel lessons for Tuesdays.",
  newMessage: "I've booked padel lessons for Tuesdays.",
  saveTool,
  fileTools: null,
});

describe("the save tool on a Claude turn", () => {
  it("is offered as Courtyard's own tool, allowed through, and hands its input to the worker unchanged", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });
    const handed: unknown[] = [];

    await runTurn(claudeCode, {
      framing: framingWith(SAVE_TOOL),
      save: async (input) => {
        handed.push(input);
        return { saved: false, reply: "That line is too long." };
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

    expect(handed).toEqual([input]);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "That line is too long." }],
    });
  });

  it("isn't offered, or allowed, on a turn whose framing has none", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, { framing: framingWith(null) });

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

describe("a one-off question to Claude (a tidy)", () => {
  const Answer = z.object({ changes: z.array(z.object({ kind: z.string() })) });

  const ask = (claudeCode: ClaudeCode) =>
    createClaudeProvider({ claudeCode }).answerOnce({
      purpose: "tidy",
      model: ModelId.parse("sonnet"),
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
