import { join, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { ModelId } from "@courtyard/contract";
import { describe, expect, it } from "vitest";
import { type ClaudeCode, createClaudeProvider } from "./providers/claude.ts";
import type { Activity, TurnInput } from "./providers/index.ts";

const folder = resolve("/path/to/context/garage-gym");

/** A stand-in for Claude Code: records what each turn asked for and replays scripted messages. */
const stubClaudeCode = (script: { check?: () => Promise<unknown>; messages?: unknown[] } = {}) => {
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
    lines: [{ speaker: "owner", text: "Where should the rack go?" }],
    workspace: {
      name: "Garage gym",
      folder,
      contextFile: "# Garage gym\n\n## Facts\n- Single garage.",
    },
    emit: async (text) => {
      emitted.push(text);
    },
    report: async (activity) => {
      activities.push(activity);
    },
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
    expect(status.capabilities).toEqual({ readsFiles: true, codes: false, usesTools: false });
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

  it("puts the context file and the workspace's name in every turn", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode);

    const system = runs[0]?.options.systemPrompt;
    expect(typeof system).toBe("string");
    expect(system).toContain("Garage gym");
    expect(system).toContain("Single garage.");
  });

  it("says so when the workspace has no context file", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, { workspace: { name: "Office", folder, contextFile: null } });

    expect(runs[0]?.options.systemPrompt).toMatch(/no context file/i);
  });

  it("sends what was said earlier along with the new message", async () => {
    const { claudeCode, runs } = stubClaudeCode({ messages: [success] });

    await runTurn(claudeCode, {
      lines: [
        { speaker: "owner", text: "How wide is the garage?" },
        { speaker: "model", text: "About 2.6 metres." },
        { speaker: "owner", text: "Will the rack fit?" },
      ],
    });

    const prompt = runs[0]?.prompt ?? "";
    expect(prompt).toContain("How wide is the garage?");
    expect(prompt).toContain("About 2.6 metres.");
    expect(prompt.trimEnd().endsWith("Will the rack fit?")).toBe(true);
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
