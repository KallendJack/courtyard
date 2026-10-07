import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effort, ModelId, ProviderList, SessionSummary } from "@courtyard/contract";
import { describe, expect, it } from "vitest";
import {
  type AppServerLaunch,
  createCodexProvider,
  type StartAppServer,
} from "./providers/codex.ts";
import type { TurnInput } from "./providers/index.ts";
import { asOwner, followSession, postJson, testWorker } from "./testing.ts";

const dataDir = resolve("/path/to/data");
const folder = resolve("/path/to/context/garage-gym");

type Message = { id?: number | string; method?: string; params?: unknown; result?: unknown };

/** What the stand-in can do during a turn: what Codex would send while it answers. */
type TurnScript = (turn: {
  threadId: string;
  turnId: string;
  notify: (method: string, params: unknown) => void;
  /** Codex finishing the turn, as it does when it's done, stopped or failed. */
  complete: (status: string, error?: unknown) => void;
  /** Codex asking the worker something, as it does for an approval. */
  ask: (method: string, params: unknown) => void;
  /** The app-server process ending without warning. */
  crash: () => void;
}) => void;

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
    turn?: TurnScript;
  } = {},
) => {
  const launches: AppServerLaunch[] = [];
  const received: Message[] = [];
  const answered: Message[] = [];
  let threads = 0;
  let turns = 0;

  const startAppServer: StartAppServer = (launch) => {
    if (script.missing) return "missing";
    launches.push(launch);
    let alive = true;
    const write = (message: unknown) => {
      // Codex writes each message as one line, after the request that caused it.
      setImmediate(() => alive && launch.onLine(JSON.stringify(message)));
    };
    const notify = (method: string, params: unknown) => write({ method, params });
    const reply = (id: Message["id"], result: unknown) => write({ id, result });
    const fail = (id: Message["id"], message: string) =>
      write({ id, error: { code: -32603, message } });
    const crash = () =>
      setImmediate(() => {
        alive = false;
        launch.onExit();
      });

    const handle = (message: Message) => {
      const { id, method } = message;
      if (method === undefined) {
        answered.push(message);
        return;
      }
      if (id === undefined) return;
      if (script.refuse && method !== "initialize") return fail(id, script.refuse);
      switch (method) {
        case "initialize":
          return reply(id, { userAgent: "codex/0.161.0", codexHome: join(dataDir, "codex") });
        case "account/read":
          return reply(id, script.account ?? SIGNED_IN);
        case "model/list":
          return reply(id, { data: script.models ?? MODELS, nextCursor: null });
        case "account/rateLimits/read":
          return reply(id, script.rateLimits ?? {});
        case "thread/start":
          threads += 1;
          return reply(id, { thread: { id: `thread-${threads}` }, model: "gpt-6.1-sol" });
        case "thread/unsubscribe":
          return reply(id, { status: "unsubscribed" });
        case "turn/interrupt": {
          const { threadId, turnId } = message.params as { threadId: string; turnId: string };
          reply(id, {});
          return notify("turn/completed", {
            threadId,
            turn: { id: turnId, status: "interrupted", error: null },
          });
        }
        case "turn/start": {
          turns += 1;
          const threadId = (message.params as { threadId: string }).threadId;
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
            crash,
          });
          return;
        }
        default:
          return fail(id, `unknown method ${method}`);
      }
    };

    return {
      send: (line) => {
        const message = JSON.parse(line) as Message;
        received.push(message);
        handle(message);
      },
      stop: () => {
        alive = false;
      },
    };
  };

  const requests = (method: string) => received.filter((m) => m.method === method);
  return { startAppServer, launches, received, answered, requests };
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
      saveTool: null,
    },
    save: async () => ({ saved: false, reply: "No saves in this test." }),
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
      capabilities: { readsFiles: false, codes: false, usesTools: false, savesContext: false },
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
      reason:
        "Codex isn't signed in. Sign in on the worker machine with Courtyard's own Codex home (see the README).",
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
      return { send: () => {}, stop: () => {} };
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

describe("Codex's turn, after the security review", () => {
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
        message:
          "Codex isn't signed in. Sign in on the worker machine with Courtyard's own Codex home (see the README).",
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
  });
});

describe("Codex in the worker", () => {
  it("offers Codex's models in the model picker, with their effort levels, and answers a turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "courtyard-"));
    try {
      await mkdir(join(root, "context", "garage-gym"), { recursive: true });
      const codex = standIn({
        turn: (turn) => {
          delta(turn, "Against the back wall.");
          turn.complete("completed");
        },
      });
      const provider = createCodexProvider({
        dataDir: join(root, "data"),
        startAppServer: codex.startAppServer,
      });
      const request = await asOwner(testWorker({ root, providers: [provider] }));

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
      // Until Courtyard's tools reach Codex, it's offered no save tool and told it can't read files.
      const [thread] = codex.requests("thread/start");
      expect(thread?.params).toMatchObject({
        model: "gpt-6-astra",
        cwd: join(root, "context", "garage-gym"),
      });
      expect(codex.requests("turn/start")[0]?.params).toMatchObject({ effort: "max" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves Codex out when the worker's settings switch it off", async () => {
    const root = await mkdtemp(join(tmpdir(), "courtyard-"));
    try {
      await mkdir(join(root, "context"), { recursive: true });
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
