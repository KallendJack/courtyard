import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effort, ModelId, ProviderList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type AppServerLaunch,
  createCodexProvider,
  type StartAppServer,
} from "./providers/codex.ts";
import type { TurnInput } from "./providers/index.ts";
import { err, ok } from "./result.ts";
import { asOwner, followSession, postJson, testWorker } from "./testing.ts";

const dataDir = resolve("/path/to/data");
const folder = resolve("/path/to/context/garage-gym");

/** One JSON-RPC message from the worker, as the stand-in reads it. */
const Message = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
type Message = z.infer<typeof Message>;
/** What the worker names when it asks about a turn. */
const TurnParams = z.object({ threadId: z.string(), turnId: z.string().optional() });

/** What the stand-in can do during a turn: what Codex would send while it answers. */
type TurnScript = (turn: {
  threadId: string;
  turnId: string;
  notify: (method: string, params: unknown) => void;
  /** Codex finishing the turn, as it does when it's done, stopped or failed. */
  complete: (status: string, error?: unknown) => void;
  /** Codex asking the worker something, as it does for an approval. */
  ask: (method: string, params: unknown) => void;
  /**
   * Codex calling one of Courtyard's tools (its `item/tool/call`), for this turn unless it names
   * another; resolves with the worker's answer.
   */
  call: (
    tool: string,
    args: unknown,
    ids?: { threadId?: string; turnId?: string },
  ) => Promise<Message>;
  /** The app-server process ending without warning. */
  crash: () => void;
}) => void | Promise<void>;

const MODELS = [
  {
    id: "gpt-6.1-sol",
    model: "gpt-6.1-sol",
    displayName: "GPT-6.1-Sol",
    description: "Latest workhorse model for coding and everyday work.",
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses with lighter reasoning" },
      { reasoningEffort: "medium", description: "Balances speed and reasoning depth" },
      { reasoningEffort: "high", description: "Greater reasoning depth" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning depth" },
      { reasoningEffort: "ultra", description: "Maximum reasoning with automatic task delegation" },
    ],
    defaultReasoningEffort: "low",
    isDefault: true,
  },
  {
    id: "gpt-6-astra",
    model: "gpt-6-astra",
    displayName: "GPT-6-Astra",
    description: "Frontier intelligence.",
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Balances speed and reasoning depth" },
      { reasoningEffort: "max", description: "Maximum reasoning depth" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
  {
    id: "codex-auto-review",
    model: "codex-auto-review",
    displayName: "Auto review",
    description: "Hidden helper model.",
    hidden: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "low",
    isDefault: false,
  },
];

const SIGNED_IN = {
  account: { type: "chatgpt", email: "owner@courtyard.example", planType: "plus" },
  requiresOpenaiAuth: true,
};

/**
 * A stand-in for Codex's app-server: answers the worker's JSON-RPC requests the way the real one
 * does, records every launch and message, and acts out a turn as each test scripts it.
 */
const standIn = (
  script: {
    missing?: boolean;
    account?: unknown;
    models?: unknown[];
    /** An error for any request but `initialize`, as a Codex too old for OpenAI's servers gets. */
    refuse?: string;
    rateLimits?: unknown;
    /** The skills Codex finds itself for a thread's folder (its .agents/skills), by name; none by default. */
    skills?: readonly string[];
    /** An error for `skills/list` only. */
    refuseSkills?: string;
    turn?: TurnScript;
  } = {},
) => {
  const launches: AppServerLaunch[] = [];
  const received: Message[] = [];
  const answered: Message[] = [];
  let threads = 0;
  let turns = 0;
  let calls = 0;
  /** Codex's calls to Courtyard's tools, each waiting for the worker's answer. */
  const waiting = new Map<Message["id"], (answer: Message) => void>();
  /** Who is signed in to this Codex home, changed by signing in and out. */
  let account = script.account ?? SIGNED_IN;
  let logins = 0;
  /** The app-server running now ending without warning. */
  let crashNow = () => {};
  /** Codex's notices from the app-server running now. */
  let notifyNow: (method: string, params: unknown) => void = () => {};

  /**
   * The owner finishing a sign-in on their device, or it failing: Codex's notice, as it sends it,
   * with a token in it that must never go further.
   */
  const finishLogin = (success: boolean, error: string | null = null) => {
    if (success) account = SIGNED_IN;
    notifyNow("account/login/completed", {
      loginId: `login-${logins}`,
      success,
      error,
      onboardingEntrypoint: null,
      accessToken: "sk-test-not-a-real-token",
    });
  };

  const startAppServer: StartAppServer = (launch) => {
    if (script.missing) return err("missing");
    launches.push(launch);
    let alive = true;
    const write = (message: unknown) => {
      // Codex writes each message as one line, after the request that caused it.
      setImmediate(() => alive && launch.onLine(JSON.stringify(message)));
    };
    const notify = (method: string, params: unknown) => write({ method, params });
    notifyNow = notify;
    const reply = (id: Message["id"], result: unknown) => write({ id, result });
    const fail = (id: Message["id"], message: string) =>
      write({ id, error: { code: -32603, message } });
    const crash = () =>
      setImmediate(() => {
        alive = false;
        launch.onExit();
      });
    crashNow = crash;

    const handle = (message: Message) => {
      const { id, method } = message;
      if (method === undefined) {
        answered.push(message);
        waiting.get(message.id)?.(message);
        waiting.delete(message.id);
        return;
      }
      if (id === undefined) return;
      if (script.refuse && method !== "initialize") return fail(id, script.refuse);
      switch (method) {
        case "initialize":
          return reply(id, { userAgent: "codex/0.161.0", codexHome: join(dataDir, "codex") });
        case "account/read":
          return reply(id, account);
        case "account/login/start":
          logins += 1;
          return reply(id, {
            type: "chatgptDeviceCode",
            loginId: `login-${logins}`,
            verificationUrl: "https://auth.openai.com/codex/device",
            userCode: "KQ7M-4821",
          });
        case "account/login/cancel":
          return reply(id, { status: "canceled" });
        case "account/logout":
          account = { account: null, requiresOpenaiAuth: true };
          reply(id, {});
          return notify("account/updated", { authMode: null, planType: null });
        case "model/list":
          return reply(id, { data: script.models ?? MODELS, nextCursor: null });
        case "account/rateLimits/read":
          return reply(id, script.rateLimits ?? {});
        case "skills/list": {
          if (script.refuseSkills) return fail(id, script.refuseSkills);
          const { cwds } = z.object({ cwds: z.array(z.string()) }).parse(message.params);
          const skills = (script.skills ?? []).map((name) => ({
            name,
            description: `What ${name} does.`,
            path: join(cwds[0] ?? "", ".agents", "skills", name, "SKILL.md"),
            scope: "repo",
            enabled: true,
          }));
          return reply(id, { data: cwds.map((cwd) => ({ cwd, skills, errors: [] })) });
        }
        case "thread/start":
          threads += 1;
          return reply(id, { thread: { id: `thread-${threads}` }, model: "gpt-6.1-sol" });
        case "thread/unsubscribe":
          return reply(id, { status: "unsubscribed" });
        case "turn/interrupt": {
          const { threadId, turnId } = TurnParams.parse(message.params);
          reply(id, {});
          return notify("turn/completed", {
            threadId,
            turn: { id: turnId, status: "interrupted", error: null },
          });
        }
        case "turn/start": {
          turns += 1;
          const { threadId } = TurnParams.parse(message.params);
          const turnId = `turn-${turns}`;
          reply(id, { turn: { id: turnId, status: "inProgress", error: null } });
          (
            script.turn ??
            (({ complete }) => {
              complete("completed");
            })
          )({
            threadId,
            turnId,
            notify,
            complete: (status, error = null) =>
              notify("turn/completed", { threadId, turn: { id: turnId, status, error } }),
            ask: (askMethod, params) => write({ id: `codex-${turns}`, method: askMethod, params }),
            call: (tool, args, ids = {}) => {
              calls += 1;
              const callId = `call-${calls}`;
              const answer = new Promise<Message>((resolve) => waiting.set(callId, resolve));
              write({
                id: callId,
                method: "item/tool/call",
                params: {
                  threadId: ids.threadId ?? threadId,
                  turnId: ids.turnId ?? turnId,
                  callId,
                  namespace: null,
                  tool,
                  arguments: args,
                },
              });
              return answer;
            },
            crash,
          });
          return;
        }
        default:
          return fail(id, `unknown method ${method}`);
      }
    };

    return ok({
      send: (line) => {
        const message = Message.parse(JSON.parse(line));
        received.push(message);
        handle(message);
      },
      stop: () => {
        alive = false;
      },
    });
  };

  const requests = (method: string) => received.filter((m) => m.method === method);
  return {
    startAppServer,
    launches,
    received,
    answered,
    requests,
    finishLogin,
    crash: () => crashNow(),
  };
};

/** Runs one Codex turn and collects what it emitted. */
const runTurn = async (
  provider: ReturnType<typeof createCodexProvider>,
  overrides: Partial<TurnInput> = {},
) => {
  const emitted: string[] = [];
  const result = await provider.runTurn({
    model: ModelId.parse("gpt-6.1-sol"),
    effort: undefined,
    folder,
    framing: {
      instructions: "The turn's instructions.",
      message: "Where should the rack go?",
      newMessage: "Where should the rack go?",
      attachments: [],
      tools: [],
      fileTools: null,
    },
    callTool: async () => ({ ok: false, content: [{ kind: "text", text: "No tools here." }] }),
    emit: async (text) => {
      emitted.push(text);
    },
    report: async () => {},
    signal: new AbortController().signal,
    ...overrides,
  });
  return { result, emitted };
};

describe("Codex's status", () => {
  it("is available with the plan's models that aren't hidden, and their effort levels in Codex's words", async () => {
    const codex = standIn();

    const status = await createCodexProvider({
      dataDir,
      startAppServer: codex.startAppServer,
    }).status();

    expect(status).toEqual({
      id: "codex",
      label: "Codex",
      available: true,
      capabilities: { readsFiles: true, codes: false, usesTools: false, savesContext: true },
      models: [
        {
          id: "gpt-6.1-sol",
          label: "Codex · GPT-6.1-Sol",
          // Ultra hands work to sub-agents, which Courtyard switches off, so it isn't offered.
          efforts: [
            { id: Effort.parse("low"), label: "Low" },
            { id: Effort.parse("medium"), label: "Medium" },
            { id: Effort.parse("high"), label: "High" },
            { id: Effort.parse("xhigh"), label: "Extra high" },
          ],
          defaultEffort: "low",
        },
        {
          id: "gpt-6-astra",
          label: "Codex · GPT-6-Astra",
          efforts: [
            { id: Effort.parse("medium"), label: "Medium" },
            { id: Effort.parse("max"), label: "Max" },
          ],
          defaultEffort: "medium",
        },
      ],
    });
  });
});

describe("Codex's usage limit, in its status", () => {
  const window = (usedPercent: number, resetsAt: number) => ({
    usedPercent,
    windowDurationMins: 300,
    resetsAt,
  });
  const limitsOf = async (rateLimits: unknown) => {
    const codex = standIn({ rateLimits });
    const status = await createCodexProvider({
      dataDir,
      startAppServer: codex.startAppServer,
    }).status();
    return status.available ? status.models.map((model) => model.limit) : "unavailable";
  };

  it("is on every model while a window is used up, with the time it resets", async () => {
    const limits = await limitsOf({
      rateLimits: {
        limitId: "codex",
        primary: window(100, Date.UTC(2026, 9, 8, 14) / 1000),
        secondary: window(40, Date.UTC(2026, 9, 12, 9) / 1000),
      },
      rateLimitsByLimitId: null,
    });

    const limit = { resetAt: "2026-10-08T14:00:00.000Z" };
    expect(limits).toEqual([limit, limit]);
  });

  it("isn't there while every window has room", async () => {
    const limits = await limitsOf({
      rateLimits: { limitId: "codex", primary: window(60, Date.UTC(2026, 9, 8, 14) / 1000) },
      rateLimitsByLimitId: null,
    });

    expect(limits).toEqual([undefined, undefined]);
  });
});

describe("Codex's status, when it can't be used", () => {
  const statusWith = (codex: ReturnType<typeof standIn>) =>
    createCodexProvider({ dataDir, startAppServer: codex.startAppServer }).status();

  it("says how to sign in when Codex isn't signed in", async () => {
    const status = await statusWith(
      standIn({ account: { account: null, requiresOpenaiAuth: true } }),
    );

    expect(status).toEqual({
      id: "codex",
      label: "Codex",
      available: false,
      reason: "Codex isn't signed in. Sign in to Codex on the home page.",
      signedOut: true,
    });
  });

  it("says Codex isn't installed when its program is missing", async () => {
    expect(await statusWith(standIn({ missing: true }))).toMatchObject({
      available: false,
      reason:
        "Codex isn't installed on the worker machine. Run `pnpm install` in Courtyard's folder.",
    });
  });

  it("says Codex needs updating when OpenAI's servers turn it away as too old", async () => {
    const codex = standIn({
      refuse: "Your version of Codex is no longer supported. Please upgrade to continue.",
    });

    expect(await statusWith(codex)).toMatchObject({
      available: false,
      reason: "Codex needs updating.",
    });
  });

  it("says Codex didn't start when it ends before answering", async () => {
    const codex = standIn();
    const startAppServer: StartAppServer = (launch) => {
      setImmediate(launch.onExit);
      return ok({ send: () => {}, stop: () => {} });
    };

    const status = await createCodexProvider({ dataDir, startAppServer }).status();

    expect(codex.launches).toEqual([]);
    expect(status).toMatchObject({
      available: false,
      reason: "Codex couldn't start on the worker machine, or didn't answer.",
    });
  });
});

describe("Codex's isolation", () => {
  it("starts in Courtyard's own Codex home, with the shell and Codex's extras off", async () => {
    const codex = standIn();
    process.env.COURTYARD_SECRET_SETTING = "not for Codex";
    try {
      await createCodexProvider({ dataDir, startAppServer: codex.startAppServer }).status();
    } finally {
      delete process.env.COURTYARD_SECRET_SETTING;
    }

    const [launch] = codex.launches;
    expect(launch?.env.CODEX_HOME).toBe(join(dataDir, "codex"));
    expect(launch?.env).not.toHaveProperty("COURTYARD_SECRET_SETTING");
    const args = launch?.args ?? [];
    expect(args[0]).toBe("app-server");
    expect(args).toContain("--strict-config");
    const settings = args.filter((_, i) => args[i - 1] === "-c");
    expect(settings).toEqual(
      expect.arrayContaining([
        'sandbox_mode="read-only"',
        'approval_policy="never"',
        "project_doc_max_bytes=0",
        "skills.bundled.enabled=false",
        "memories.use_memories=false",
        "apps._default.enabled=false",
        "agents.enabled=false",
        'web_search="disabled"',
      ]),
    );
    const off = args.filter((_, i) => args[i - 1] === "--disable");
    expect(off).toEqual(
      expect.arrayContaining([
        "shell_tool",
        "unified_exec",
        "apps",
        "plugins",
        "memories",
        "hooks",
        "browser_use",
        "computer_use",
        "image_generation",
        "multi_agent",
      ]),
    );
    // Codex's models call every tool, Courtyard's included, from code run in its code-mode host:
    // plain JavaScript with no files, network or shell, and only the tools a thread is offered.
    expect(off).not.toContain("code_mode_host");
  });

  it("starts every thread with each skill Codex finds itself turned off, so only Courtyard's reach it", async () => {
    // Codex finds the owner's skills in a workspace folder's .agents/skills, and the context
    // folder's, as a repo's (docs/real-codex-check.md); Courtyard loads them itself (ADR 0016).
    const codex = standIn({ skills: ["programme-check", "grilling"] });
    const provider = createCodexProvider({ dataDir, startAppServer: codex.startAppServer });

    const { result } = await runTurn(provider);

    expect(result.ok).toBe(true);
    expect(codex.requests("skills/list")[0]?.params).toEqual({
      cwds: [folder],
      forceReload: true,
    });
    expect(codex.requests("thread/start")[0]?.params).toMatchObject({
      config: {
        "skills.config": [
          { name: "programme-check", enabled: false },
          { name: "grilling", enabled: false },
        ],
      },
    });
  });

  it("fails a turn, rather than start it, when Codex can't say which skills it would load", async () => {
    const codex = standIn({ skills: ["grilling"], refuseSkills: "no such method" });
    const provider = createCodexProvider({ dataDir, startAppServer: codex.startAppServer });

    const { result } = await runTurn(provider);

    expect(result).toEqual({
      ok: false,
      error: { kind: "unknown", message: "Codex couldn't answer this time." },
    });
    expect(codex.requests("thread/start")).toEqual([]);
  });
});

const delta = (turn: Parameters<TurnScript>[0], text: string) =>
  turn.notify("item/agentMessage/delta", {
    threadId: turn.threadId,
    turnId: turn.turnId,
    itemId: "msg-1",
    delta: text,
  });

describe("a Codex turn", () => {
  it("starts a fresh, unsaved thread each turn, with Courtyard's instructions in place of Codex's own", async () => {
    const codex = standIn();
    const provider = createCodexProvider({ dataDir, startAppServer: codex.startAppServer });

    await runTurn(provider);
    await runTurn(provider, { effort: Effort.parse("high") });

    const threads = codex.requests("thread/start");
    expect(threads).toHaveLength(2);
    for (const thread of threads) {
      expect(thread.params).toEqual({
        model: "gpt-6.1-sol",
        cwd: folder,
        ephemeral: true,
        baseInstructions: "The turn's instructions.",
        sandbox: "read-only",
        approvalPolicy: "never",
        // No environment, so nothing to run commands in.
        environments: [],
        // Courtyard's tools are all it has, and this framing offers none.
        dynamicTools: [],
        // Codex found no skills of its own here to turn off.
        config: { "skills.config": [] },
      });
    }
    const [first, second] = codex.requests("turn/start");
    expect(first?.params).toEqual({
      threadId: "thread-1",
      input: [{ type: "text", text: "Where should the rack go?", text_elements: [] }],
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      approvalPolicy: "never",
    });
    expect(second?.params).toMatchObject({ threadId: "thread-2", effort: "high" });
    // One app-server for every turn.
    expect(codex.launches).toHaveLength(1);
  });

  it("gives the turn's photos with its message as local images, in order (#78)", async () => {
    const codex = standIn();
    const provider = createCodexProvider({ dataDir, startAppServer: codex.startAppServer });
    const photos = [resolve("/path/to/data/one.png"), resolve("/path/to/data/two.jpg")];

    await runTurn(provider, {
      framing: {
        instructions: "The instructions.",
        message: "The message, with the PDF's text.",
        newMessage: "The message.",
        attachments: [
          { kind: "photo", name: "one.png", path: photos[0] ?? "", mediaType: "image/png" },
          { kind: "pdf", name: "manual.pdf" },
          { kind: "photo", name: "two.jpg", path: photos[1] ?? "", mediaType: "image/jpeg" },
        ],
        tools: [],
        fileTools: null,
      },
    });

    expect(codex.requests("turn/start")[0]?.params).toMatchObject({
      input: [
        { type: "text", text: "The message, with the PDF's text.", text_elements: [] },
        { type: "localImage", path: photos[0] },
        { type: "localImage", path: photos[1] },
      ],
    });
  });

  it("streams Codex's answer as it's written, and only this thread's", async () => {
    const codex = standIn({
      turn: (turn) => {
        delta(turn, "Against ");
        turn.notify("item/agentMessage/delta", {
          threadId: "another-thread",
          turnId: "another-turn",
          itemId: "msg-9",
          delta: "Someone else's answer",
        });
        delta(turn, "the back wall.");
        turn.complete("completed");
      },
    });

    const { result, emitted } = await runTurn(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
    );

    expect(result).toEqual({ ok: true, value: null });
    expect(emitted).toEqual(["Against ", "the back wall."]);
  });
});

describe("a Codex turn that fails", () => {
  const failingWith = (error: unknown, rest: Parameters<typeof standIn>[0] = {}) =>
    standIn({
      ...rest,
      turn: (turn) => {
        delta(turn, "Half");
        turn.complete("failed", error);
      },
    });

  it("turns a usage limit into a rate-limited failure, with the reset time of the limit reached", async () => {
    const window = (usedPercent: number, resetsAt: number) => ({
      usedPercent,
      windowDurationMins: 300,
      resetsAt,
    });
    const codex = failingWith(
      { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" },
      {
        rateLimits: {
          rateLimits: {
            limitId: "codex",
            // The five-hour window is used up; the weekly one isn't.
            primary: window(100, Date.UTC(2026, 9, 8, 14) / 1000),
            secondary: window(40, Date.UTC(2026, 9, 12, 9) / 1000),
          },
          rateLimitsByLimitId: null,
        },
      },
    );

    const { result } = await runTurn(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: "rate-limited", resetAt: "2026-10-08T14:00:00.000Z" },
    });
  });

  it("leaves the reset time out when Codex doesn't say which limit was reached", async () => {
    const codex = failingWith({ message: "Limit.", codexErrorInfo: "usageLimitExceeded" });

    const { result } = await runTurn(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
    );

    expect(result).toEqual({ ok: false, error: { kind: "rate-limited" } });
  });
});

describe("a one-off question to Codex", () => {
  const ask = (provider: ReturnType<typeof createCodexProvider>, effort?: Effort) =>
    provider.answerOnce({
      purpose: "title",
      model: ModelId.parse("gpt-6.1-sol"),
      ...(effort === undefined ? {} : { effort }),
      instructions: "The question's instructions.",
      message: "Where should the rack go?",
      schema: z.object({ title: z.string() }),
      signal: new AbortController().signal,
    });

  /** Codex finishing a message, as commentary on the way or as its answer. */
  const message = (
    turn: Parameters<TurnScript>[0],
    { text, phase }: { text: string; phase: string },
  ) =>
    turn.notify("item/completed", {
      threadId: turn.threadId,
      turnId: turn.turnId,
      item: { type: "agentMessage", id: `msg-${phase}`, text, phase },
    });

  it("asks on a fresh, unsaved thread with no tools, sending the answer's shape and the effort, and returns the answer", async () => {
    const codex = standIn({
      turn: (turn) => {
        message(turn, { text: "Thinking of a title.", phase: "commentary" });
        message(turn, { text: '{"title":"Rack position"}', phase: "final_answer" });
        turn.complete("completed");
      },
    });

    const answer = await ask(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
      Effort.parse("low"),
    );

    expect(answer).toEqual({ ok: true, value: { title: "Rack position" } });
    expect(codex.requests("thread/start")[0]?.params).toMatchObject({
      model: "gpt-6.1-sol",
      ephemeral: true,
      baseInstructions: "The question's instructions.",
      sandbox: "read-only",
      environments: [],
      dynamicTools: [],
    });
    expect(codex.requests("turn/start")[0]?.params).toMatchObject({
      input: [{ type: "text", text: "Where should the rack go?", text_elements: [] }],
      effort: "low",
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
    });
    expect(codex.requests("thread/unsubscribe")).toHaveLength(1);
  });

  it("turns a usage limit into a rate-limited failure, with the reset time of the limit reached", async () => {
    const codex = standIn({
      rateLimits: {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1791468000 },
          secondary: null,
        },
        rateLimitsByLimitId: null,
      },
      turn: (turn) =>
        turn.complete("failed", {
          message: "You've hit your usage limit.",
          codexErrorInfo: "usageLimitExceeded",
        }),
    });

    const answer = await ask(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
    );

    expect(answer).toEqual({
      ok: false,
      error: { kind: "rate-limited", resetAt: new Date(1791468000 * 1000).toISOString() },
    });
  });

  it("fails, in plain words, on an answer that isn't the shape asked for", async () => {
    const codex = standIn({
      turn: (turn) => {
        message(turn, { text: "Rack position", phase: "final_answer" });
        turn.complete("completed");
      },
    });

    const answer = await ask(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
    );

    expect(answer).toEqual({
      ok: false,
      error: { kind: "unknown", message: "Codex answered in a way Courtyard doesn't understand." },
    });
  });
});

describe("Codex stopping or being stopped", () => {
  it("fails the turn when the app-server ends mid-turn, and starts it again for the next turn", async () => {
    let turns = 0;
    const codex = standIn({
      turn: (turn) => {
        turns += 1;
        delta(turn, "Half");
        if (turns === 1) turn.crash();
        else turn.complete("completed");
      },
    });
    const provider = createCodexProvider({ dataDir, startAppServer: codex.startAppServer });

    const first = await runTurn(provider);
    const second = await runTurn(provider);

    expect(first.result).toEqual({
      ok: false,
      error: { kind: "provider-unavailable", message: "Codex stopped unexpectedly." },
    });
    expect(second.result).toEqual({ ok: true, value: null });
    expect(codex.launches).toHaveLength(2);
    // The isolation is there on the second start too.
    expect(codex.launches[1]?.args).toEqual(codex.launches[0]?.args);
    expect(codex.launches[1]?.env.CODEX_HOME).toBe(join(dataDir, "codex"));
  });

  it("interrupts the turn when the owner stops it, keeping what Codex wrote", async () => {
    const stop = new AbortController();
    const codex = standIn({
      // Codex keeps going until it's interrupted.
      turn: (turn) => delta(turn, "Half an answer"),
    });

    const emitted: string[] = [];

    const { result } = await runTurn(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
      {
        signal: stop.signal,
        emit: async (text) => {
          emitted.push(text);
          stop.abort();
        },
      },
    );

    expect(result).toEqual({ ok: true, value: null });
    expect(emitted).toEqual(["Half an answer"]);
    expect(codex.requests("turn/interrupt").map((m) => m.params)).toEqual([
      { threadId: "thread-1", turnId: "turn-1" },
    ]);
  });
});

describe("what never passes between Codex and the worker", () => {
  it("refuses anything Codex asks of the worker, such as an approval", async () => {
    const codex = standIn({
      turn: (turn) => {
        turn.ask("item/commandExecution/requestApproval", {
          threadId: turn.threadId,
          turnId: turn.turnId,
          command: "type C:secrets.txt",
        });
        setImmediate(() => turn.complete("completed"));
      },
    });

    await runTurn(createCodexProvider({ dataDir, startAppServer: codex.startAppServer }));

    expect(codex.answered).toEqual([
      { id: "codex-1", error: { code: -32601, message: "Courtyard doesn't allow that here." } },
    ]);
  });

  it("never passes on Codex's own words about a failure, which could carry anything", async () => {
    const secret = "sk-test-not-a-real-key";
    const codex = standIn({
      turn: (turn) =>
        turn.complete("failed", { message: `Bad token ${secret}`, codexErrorInfo: "other" }),
    });

    const { result } = await runTurn(
      createCodexProvider({ dataDir, startAppServer: codex.startAppServer }),
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: "unknown", message: "Codex couldn't answer this time." },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps the account's email out of its status", async () => {
    const codex = standIn();

    const status = await createCodexProvider({
      dataDir,
      startAppServer: codex.startAppServer,
    }).status();

    expect(JSON.stringify(status)).not.toContain("owner@courtyard.example");
  });

  it("turns a lost sign-in or a Codex too old into an unavailable provider, in plain words", async () => {
    const turnFailing = async (error: unknown) => {
      const codex = standIn({ turn: (turn) => turn.complete("failed", error) });
      return (await runTurn(createCodexProvider({ dataDir, startAppServer: codex.startAppServer })))
        .result;
    };

    expect(await turnFailing({ message: "401", codexErrorInfo: "unauthorized" })).toEqual({
      ok: false,
      error: {
        kind: "provider-unavailable",
        message: "Codex isn't signed in. Sign in to Codex on the home page.",
      },
    });
    expect(
      await turnFailing({
        message: "This version of Codex is no longer supported. Please upgrade.",
        codexErrorInfo: "badRequest",
      }),
    ).toEqual({
      ok: false,
      error: { kind: "provider-unavailable", message: "Codex needs updating." },
    });
    // An update that isn't of Codex itself is an ordinary failure.
    expect(
      await turnFailing({ message: "Failed to update the thread.", codexErrorInfo: "other" }),
    ).toEqual({
      ok: false,
      error: { kind: "unknown", message: "Codex couldn't answer this time." },
    });
  });
});

describe("Codex in the worker", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "courtyard-"));
    await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A worker offering Codex, with the stand-in acting out each turn. */
  const workerWith = async (turn: TurnScript) => {
    const codex = standIn({ turn });
    const provider = createCodexProvider({
      dataDir: join(root, "data"),
      startAppServer: codex.startAppServer,
    });
    return { codex, request: await asOwner(testWorker({ root, providers: [provider] })) };
  };

  it("offers Codex's models in the model picker, with their effort levels, and answers a turn", async () => {
    const { codex, request } = await workerWith((turn) => {
      delta(turn, "Against the back wall.");
      turn.complete("completed");
    });

    const { providers } = ProviderList.parse(await (await request("/api/providers")).json());
    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where should the rack go?",
      model: { provider: "codex", model: "gpt-6-astra" },
      effort: "max",
    });
    const { id } = SessionSummary.parse(await response.json());
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    expect(providers[0]).toMatchObject({
      id: "codex",
      available: true,
      models: [
        {
          id: "gpt-6.1-sol",
          efforts: expect.arrayContaining([{ id: "xhigh", label: "Extra high" }]),
        },
        { id: "gpt-6-astra", defaultEffort: "medium" },
      ],
    });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["owner-message", "text-delta", "turn-completed"]),
    );
    // It works in the workspace's folder, with the model and effort the owner chose.
    expect(codex.requests("thread/start")[0]?.params).toMatchObject({
      model: "gpt-6-astra",
      cwd: join(root, "context", "garage-gym"),
    });
    expect(codex.requests("turn/start")[0]?.params).toMatchObject({ effort: "max" });
  });

  it("keeps the sign-in and Codex's own words out of the session's events", async () => {
    const secret = "sk-test-not-a-real-key";
    const { request } = await workerWith((turn) => {
      delta(turn, "Half");
      turn.complete("failed", { message: `Token ${secret} rejected`, codexErrorInfo: "other" });
    });

    const providers = await (await request("/api/providers")).text();
    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where should the rack go?",
      model: { provider: "codex", model: "gpt-6.1-sol" },
    });
    const { id } = SessionSummary.parse(await response.json());
    const events = await followSession(request, { sessionId: id, until: "turn-failed" });

    for (const shown of [providers, JSON.stringify(events)]) {
      expect(shown).not.toContain("owner@courtyard.example");
      expect(shown).not.toContain(secret);
    }
    expect(events.at(-1)).toMatchObject({
      type: "turn-failed",
      reason: { kind: "unknown", message: "Codex couldn't answer this time." },
    });
  });

  it("leaves Codex out when the worker's settings switch it off", async () => {
    const request = await asOwner(
      testWorker({
        root,
        env: {
          COURTYARD_CLAUDE_PROVIDER: "0",
          COURTYARD_CODEX_PROVIDER: "0",
          COURTYARD_FAKE_PROVIDER: "1",
        },
      }),
    );

    const { providers } = ProviderList.parse(await (await request("/api/providers")).json());

    expect(providers.map((p) => p.id)).toEqual(["fake"]);
  });
});

describe("Courtyard's tools on a Codex turn", () => {
  let root: string;
  let workspace: string;
  const SECRET = "swordfish";
  const OUTSIDE = "Only files in this workspace's folder can be read.";
  /** A few bytes that start like a PNG, which is all a read of one looks at. */
  const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "courtyard-"));
    workspace = join(root, "context", "garage-gym");
    await mkdir(join(workspace, "notes"), { recursive: true });
    await writeFile(join(workspace, "CONTEXT.md"), "# Garage gym\n\n## Facts\n\n- Has a rack.\n");
    await writeFile(
      join(workspace, "notes", "rack.md"),
      "Measured twice.\nThe rack goes against the back wall.\n",
    );
    await writeFile(join(workspace, "plan.png"), IMAGE);
    // Just outside the workspace folder, and somewhere reachable only through a link inside it.
    await writeFile(join(root, "context", "secret.txt"), `The word is ${SECRET}.`);
    await mkdir(join(root, "elsewhere"));
    await writeFile(join(root, "elsewhere", "secret.txt"), `The word is ${SECRET}.`);
    await symlink(join(root, "elsewhere"), join(workspace, "linked"), "junction");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  type Call = { tool: string; args: unknown; ids?: { threadId?: string; turnId?: string } };

  /**
   * A Codex turn in garage-gym in which Codex makes the scripted tool calls, then answers. Gives
   * the worker's answer to each call, the session's events, and the stand-in.
   */
  const turnCalling = async (calls: readonly Call[]) => {
    const answers: Message[] = [];
    const codex = standIn({
      turn: async (turn) => {
        for (const { tool, args, ids } of calls) answers.push(await turn.call(tool, args, ids));
        delta(turn, "Done.");
        turn.complete("completed");
      },
    });
    const provider = createCodexProvider({
      dataDir: join(root, "data"),
      startAppServer: codex.startAppServer,
    });
    const request = await asOwner(testWorker({ root, providers: [provider] }));
    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where should the rack go?",
      model: { provider: "codex", model: "gpt-6.1-sol" },
    });
    const { id } = SessionSummary.parse(await response.json());
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    return { answers, events, codex };
  };

  const ToolAnswer = z.object({
    result: z.object({
      success: z.boolean(),
      contentItems: z.array(
        z.union([
          z.object({ type: z.literal("inputText"), text: z.string() }),
          z.object({ type: z.literal("inputImage"), imageUrl: z.string() }),
        ]),
      ),
    }),
  });
  /** A tool's answer as Codex reads it: whether it worked, its text, and everything in it. */
  const answerOf = (message: Message | undefined) => {
    const { result } = ToolAnswer.parse(message);
    const text = result.contentItems.map((item) => ("text" in item ? item.text : "")).join("\n");
    return { success: result.success, text, items: result.contentItems };
  };

  it("offers the file tools, the save tool, the use skill tool and the suggest replies tool on each thread, with what each takes", async () => {
    const { codex } = await turnCalling([]);

    const ToolSpec = z.object({
      type: z.literal("function"),
      name: z.string(),
      description: z.string(),
      inputSchema: z.object({
        type: z.literal("object"),
        properties: z.record(z.string(), z.unknown()),
      }),
    });
    const offered = z
      .object({ dynamicTools: z.array(ToolSpec) })
      .parse(codex.requests("thread/start")[0]?.params).dynamicTools;
    expect(offered.map((tool) => tool.name)).toEqual([
      "list_folder",
      "read_file",
      "search_files",
      "save_to_context",
      "use_skill",
      "suggest_replies",
    ]);
    const read = offered.find((tool) => tool.name === "read_file");
    expect(read?.inputSchema.properties).toHaveProperty("path");
    // Its experimental API is what lets the worker offer them.
    expect(codex.requests("initialize")[0]?.params).toMatchObject({
      capabilities: { experimentalApi: true },
    });
  });

  it("reads a file inside the workspace, and shows the read as an activity", async () => {
    const { answers, events } = await turnCalling([
      { tool: "read_file", args: { path: "notes/rack.md" } },
    ]);

    expect(answerOf(answers[0])).toMatchObject({
      success: true,
      text: expect.stringContaining("The rack goes against the back wall."),
    });
    expect(events.filter((event) => event.type === "activity")).toMatchObject([
      { activity: { kind: "read-file", path: "notes/rack.md" } },
    ]);
  });

  it("reads an image as an image", async () => {
    const { answers } = await turnCalling([{ tool: "read_file", args: { path: "plan.png" } }]);

    const { success, items } = answerOf(answers[0]);
    expect(success).toBe(true);
    expect(items).toContainEqual({
      type: "inputImage",
      imageUrl: `data:image/png;base64,${IMAGE.toString("base64")}`,
    });
  });

  it("lists a folder and searches the files' text, inside the workspace", async () => {
    const { answers } = await turnCalling([
      { tool: "list_folder", args: {} },
      { tool: "search_files", args: { text: "BACK WALL" } },
      { tool: "search_files", args: { text: "measured", glob: "*.md" } },
    ]);

    const [listed, searched, globbed] = answers.map(answerOf);
    expect(listed?.text).toContain("notes/");
    expect(listed?.text).toContain("CONTEXT.md");
    expect(searched?.text).toContain("notes/rack.md:2: The rack goes against the back wall.");
    expect(globbed?.text).toContain("notes/rack.md:1: Measured twice.");
  });

  it("refuses a path outside the workspace, a link out of it and a climbing glob, with Claude's reason", async () => {
    const { answers, events } = await turnCalling([
      { tool: "read_file", args: { path: "../secret.txt" } },
      { tool: "read_file", args: { path: join(root, "context", "secret.txt") } },
      { tool: "read_file", args: { path: "linked/secret.txt" } },
      { tool: "list_folder", args: { path: ".." } },
      { tool: "list_folder", args: { path: "linked" } },
      { tool: "search_files", args: { text: SECRET, glob: "../**" } },
      { tool: "search_files", args: { text: SECRET, path: "linked" } },
    ]);

    expect(answers).toHaveLength(7);
    for (const answer of answers.map(answerOf)) {
      expect(answer).toEqual({
        success: false,
        text: OUTSIDE,
        items: [{ type: "inputText", text: OUTSIDE }],
      });
    }
    expect(events.filter((event) => event.type === "activity")).toEqual([]);
  });

  it("never follows a link out of the workspace while searching all of it", async () => {
    const { answers } = await turnCalling([{ tool: "search_files", args: { text: SECRET } }]);

    expect(JSON.stringify(answers)).not.toContain(SECRET);
    expect(answerOf(answers[0])).toMatchObject({ success: true, text: "No matches." });
  });

  it("hands a save to the worker, which checks it, writes it and says what happened", async () => {
    const { answers, events } = await turnCalling([
      {
        tool: "save_to_context",
        args: { action: "add", section: "facts", text: "The rack is bolted down." },
      },
      { tool: "save_to_context", args: { action: "add", section: "facts", text: "Has a rack" } },
    ]);

    expect(answerOf(answers[0])).toMatchObject({ success: true, text: "Saved." });
    // The second repeats a line already there, so the worker refuses it.
    expect(answerOf(answers[1])).toMatchObject({
      success: false,
      text: expect.stringContaining("That's already saved"),
    });
    expect(events.filter((event) => event.type === "context-saved")).toMatchObject([
      { save: { action: "add", saved: { section: "facts", line: "The rack is bolted down." } } },
    ]);
    expect(await readFile(join(workspace, "CONTEXT.md"), "utf8")).toContain(
      "- The rack is bolted down.",
    );
  });

  it("loads a skill through the worker, and none of the files outside its folder", async () => {
    const { answers, events } = await turnCalling([
      { tool: "use_skill", args: { name: "grilling" } },
      { tool: "use_skill", args: { name: "grilling", path: "../skills.json" } },
      { tool: "use_skill", args: { name: "grilling", path: join(workspace, "CONTEXT.md") } },
    ]);

    expect(answerOf(answers[0])).toMatchObject({
      success: true,
      text: expect.stringContaining("name: grilling"),
    });
    for (const answer of answers.slice(1)) {
      expect(answerOf(answer)).toEqual({
        success: false,
        text: "Only files in the skill's folder can be read.",
        items: [{ type: "inputText", text: "Only files in the skill's folder can be read." }],
      });
    }
    expect(events.filter((event) => event.type === "activity")).toMatchObject([
      { activity: { kind: "skill-loaded", name: "grilling", source: "house" } },
    ]);
  });

  it("hands suggested replies to the worker, which checks them and records them", async () => {
    const { answers, events } = await turnCalling([
      { tool: "suggest_replies", args: { replies: ["Against the back wall"] } },
      { tool: "suggest_replies", args: { replies: ["Against the back wall", "By the door"] } },
    ]);

    expect(answerOf(answers[0])).toMatchObject({
      success: false,
      text: "Suggest two or three replies, not 1.",
    });
    expect(answerOf(answers[1])).toMatchObject({ success: true });
    expect(events.filter((event) => event.type === "suggested-replies")).toMatchObject([
      { replies: ["Against the back wall", "By the door"] },
    ]);
  });

  it("refuses a call for a turn or a thread it doesn't recognise, and a tool it didn't offer", async () => {
    const { answers, events } = await turnCalling([
      { tool: "read_file", args: { path: "notes/rack.md" }, ids: { turnId: "another-turn" } },
      { tool: "read_file", args: { path: "notes/rack.md" }, ids: { threadId: "another-thread" } },
      { tool: "run_command", args: { command: "type secret.txt" } },
    ]);

    expect(answers).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: -32601 }) }),
      expect.objectContaining({ error: expect.objectContaining({ code: -32601 }) }),
      expect.objectContaining({ error: expect.objectContaining({ code: -32601 }) }),
    ]);
    expect(events.filter((event) => event.type === "activity")).toEqual([]);
  });
});

describe("Courtyard's tools on a Codex turn, after the review", () => {
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "courtyard-"));
    workspace = join(root, "context", "garage-gym");
    await mkdir(join(workspace, "notes"), { recursive: true });
    await writeFile(join(workspace, "notes", "rack.md"), "The rack goes against the back wall.\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A Codex turn in garage-gym making the scripted calls: the answers, events and stand-in. */
  const turnCalling = async (calls: readonly { tool: string; args: unknown }[]) => {
    const answers: Message[] = [];
    const codex = standIn({
      turn: async (turn) => {
        for (const { tool, args } of calls) answers.push(await turn.call(tool, args));
        turn.complete("completed");
      },
    });
    const provider = createCodexProvider({
      dataDir: join(root, "data"),
      startAppServer: codex.startAppServer,
    });
    const request = await asOwner(testWorker({ root, providers: [provider] }));
    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where should the rack go?",
      model: { provider: "codex", model: "gpt-6.1-sol" },
    });
    const { id } = SessionSummary.parse(await response.json());
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    return { answers, events, codex };
  };

  const textOf = (message: Message | undefined) =>
    z
      .object({
        result: z.object({
          success: z.boolean(),
          contentItems: z.array(z.object({ text: z.string() })),
        }),
      })
      .parse(message)
      .result.contentItems.map((item) => item.text)
      .join("\n");

  it("keeps a read to its limit, however long one line is", async () => {
    await writeFile(join(workspace, "minified.js"), "x".repeat(300_000));

    const { answers } = await turnCalling([{ tool: "read_file", args: { path: "minified.js" } }]);

    expect(textOf(answers[0]).length).toBeLessThan(110_000);
  });

  it("shows only files it gave the model as read, not one it can't read", async () => {
    await writeFile(join(workspace, "backup.bin"), Buffer.from([0, 1, 2, 3, 0, 0]));

    const { answers, events } = await turnCalling([
      { tool: "read_file", args: { path: "backup.bin" } },
    ]);

    expect(answers[0]).toMatchObject({ result: { success: false } });
    expect(events.filter((event) => event.type === "activity")).toEqual([]);
  });

  it("takes a glob or path written with Windows' backslashes", async () => {
    const { answers } = await turnCalling([
      { tool: "search_files", args: { text: "back wall", glob: "notes\\*.md" } },
    ]);

    expect(textOf(answers[0])).toContain("notes/rack.md:1: The rack goes against the back wall.");
  });

  it("offers a code workspace the save tool for How to answer me only, as Claude's", async () => {
    await writeFile(
      join(workspace, "workspace.json"),
      '{ "mode": "code", "repoPath": "/path/to/repo" }',
    );

    const { answers, codex } = await turnCalling([
      { tool: "save_to_context", args: { action: "add", section: "facts", text: "Has a rack." } },
    ]);

    const offered = z
      .object({ dynamicTools: z.array(z.object({ name: z.string(), description: z.string() })) })
      .parse(codex.requests("thread/start")[0]?.params).dynamicTools;
    expect(offered.find((tool) => tool.name === "save_to_context")?.description).toMatch(
      /to How to answer me in the owner context/,
    );
    expect(textOf(answers[0])).toMatch(/In a code workspace you can save only to How to answer me/);
  });
});

describe("signing in to Codex (ADR 0015)", () => {
  const SIGNED_OUT = { account: null, requiresOpenaiAuth: true };
  const START = Date.parse("2026-10-08T09:00:00Z");

  /** A Codex provider on a signed-out stand-in, with a clock the test moves. */
  const signedOut = () => {
    const codex = standIn({ account: SIGNED_OUT });
    let clock = START;
    const provider = createCodexProvider({
      dataDir,
      startAppServer: codex.startAppServer,
      now: () => clock,
    });
    const { signIn } = provider;
    if (signIn === undefined) throw new Error("Codex has no sign-in");
    return {
      codex,
      provider,
      signIn,
      later: (minutes: number) => {
        clock += minutes * 60_000;
      },
    };
  };

  it("starts a sign-in with a device code, giving only its link and code", async () => {
    const { codex, signIn } = signedOut();

    expect(signIn.service).toBe("ChatGPT");
    expect(await signIn.state()).toEqual({ kind: "signed-out" });
    const started = await signIn.start();

    const waiting = {
      kind: "waiting",
      link: "https://auth.openai.com/codex/device",
      code: "KQ7M-4821",
      // Codex's device codes work for 15 minutes.
      expiresAt: new Date(START + 15 * 60_000).toISOString(),
    };
    expect(started).toEqual({ ok: true, value: waiting });
    expect(await signIn.state()).toEqual(waiting);
    expect(codex.requests("account/login/start").map((m) => m.params)).toEqual([
      { type: "chatgptDeviceCode" },
    ]);
  });

  it("says when the sign-in finishes, and offers Codex's models from then on", async () => {
    const { codex, provider, signIn } = signedOut();
    expect(await provider.status()).toMatchObject({ available: false });

    await signIn.start();
    codex.finishLogin(true);

    await vi.waitFor(async () =>
      expect(await signIn.state()).toEqual({
        kind: "signed-in",
        email: "owner@courtyard.example",
        plan: "plus",
      }),
    );
    // The status checked while signed out isn't kept once the sign-in changes.
    expect(await provider.status()).toMatchObject({ available: true });
  });

  it("says when the code ran out, or the sign-in failed", async () => {
    const expired = signedOut();
    await expired.signIn.start();
    expired.codex.finishLogin(false, "Device code expired before it was used");
    const failed = signedOut();
    await failed.signIn.start();
    failed.codex.finishLogin(false, "Access denied");

    await vi.waitFor(async () => {
      expect(await expired.signIn.state()).toEqual({ kind: "not-finished", why: "expired" });
      expect(await failed.signIn.state()).toEqual({ kind: "not-finished", why: "failed" });
    });
  });

  it("counts a code as run out once its time is up, even if Codex doesn't say", async () => {
    const { codex, signIn, later } = signedOut();
    await signIn.start();

    later(16);

    expect(await signIn.state()).toEqual({ kind: "not-finished", why: "expired" });
    // Codex is told to stop waiting for it.
    expect(codex.requests("account/login/cancel").map((m) => m.params)).toEqual([
      { loginId: "login-1" },
    ]);
  });

  it("cancels a sign-in in progress, and forgets one that didn't finish", async () => {
    const { codex, signIn } = signedOut();
    await signIn.start();

    await signIn.cancel();

    expect(codex.requests("account/login/cancel").map((m) => m.params)).toEqual([
      { loginId: "login-1" },
    ]);
    expect(await signIn.state()).toEqual({ kind: "signed-out" });
  });

  it("signs out, after which Codex isn't offered", async () => {
    const codex = standIn();
    const provider = createCodexProvider({ dataDir, startAppServer: codex.startAppServer });
    expect(await provider.status()).toMatchObject({ available: true });

    expect(await provider.signIn?.signOut()).toEqual({ ok: true, value: null });

    expect(codex.requests("account/logout")).toHaveLength(1);
    expect(await provider.signIn?.state()).toEqual({ kind: "signed-out" });
    expect(await provider.status()).toMatchObject({ available: false });
  });

  it("doesn't keep a status checked while the sign-in changed", async () => {
    const codex = standIn();
    let clock = START;
    const provider = createCodexProvider({
      dataDir,
      startAppServer: codex.startAppServer,
      now: () => clock,
    });
    await provider.status();
    clock += 2 * 60_000;

    // A check that reads the account before the sign-out and finishes after it.
    await Promise.all([provider.status(), provider.signIn?.signOut()]);

    expect(await provider.status()).toMatchObject({ available: false });
  });

  it("starts one sign-in at a time, giving up the earlier one", async () => {
    const { codex, signIn } = signedOut();

    await Promise.all([signIn.start(), signIn.start()]);

    expect(codex.requests("account/login/start")).toHaveLength(2);
    expect(codex.requests("account/login/cancel").map((m) => m.params)).toEqual([
      { loginId: "login-1" },
    ]);
  });

  it("says the sign-in didn't finish when Codex stops partway", async () => {
    const { codex, signIn } = signedOut();
    await signIn.start();

    codex.crash();

    await vi.waitFor(async () =>
      expect(await signIn.state()).toEqual({ kind: "not-finished", why: "failed" }),
    );
  });

  it("says why when Codex can't be reached to sign in", async () => {
    const { signIn } = createCodexProvider({
      dataDir,
      startAppServer: standIn({ missing: true }).startAppServer,
    });

    expect(await signIn?.state()).toEqual({
      kind: "unavailable",
      reason:
        "Codex isn't installed on the worker machine. Run `pnpm install` in Courtyard's folder.",
    });
    expect(await signIn?.start()).toEqual({
      ok: false,
      error:
        "Codex isn't installed on the worker machine. Run `pnpm install` in Courtyard's folder.",
    });
  });

  it("never passes on anything Codex sends but the link and code", async () => {
    const { codex, signIn } = signedOut();
    const seen = [JSON.stringify(await signIn.start())];
    codex.finishLogin(true);
    await vi.waitFor(async () => expect(await signIn.state()).toMatchObject({ kind: "signed-in" }));
    seen.push(JSON.stringify(await signIn.state()));

    for (const shown of seen) {
      expect(shown).not.toContain("sk-test-not-a-real-token");
      expect(shown).not.toContain("login-1");
    }
  });
});
