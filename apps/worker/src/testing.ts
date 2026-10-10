import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ApiError,
  ATTACHMENTS_FIELD,
  MESSAGE_FIELD,
  ModelId,
  ProviderId,
  SessionEvent,
  SessionSummary,
} from "@courtyard/contract";
import type { Hono } from "hono";
import { git } from "./git.ts";
import { SAVE_TOOL_NAME } from "./prompts/index.ts";
import {
  type CodeTurn,
  createFakeProvider,
  type Framing,
  type Provider,
} from "./providers/index.ts";
import { err, ok, type Result } from "./result.ts";
import type { TestFile } from "./test-files.ts";
import { createWorker, type Environment } from "./worker.ts";

export { createFakeGitHub, type FakeGitHub } from "./github/fake.ts";
export { createFakePush, type FakePush } from "./notifications/fake.ts";
export { pdfOf, pngOf, type TestFile } from "./test-files.ts";

/**
 * For tests and the context eval: a worker on the `context` and `data` folders in `root`, with any other options and
 * settings given. Throws if it won't start, since every test that uses it needs one that does.
 */
export const testWorker = (
  options: { root: string; env?: Environment } & Omit<Parameters<typeof createWorker>[0], "env">,
) => {
  const { root, env, ...rest } = options;
  const worker = createWorker({
    // Nothing runs in the background unless a test asks for the job.
    repeat: () => {},
    ...rest,
    env: {
      COURTYARD_CONTEXT_DIR: join(root, "context"),
      COURTYARD_DATA_DIR: join(root, "data"),
      ...env,
    },
  });
  if (!worker.ok) throw new Error(worker.error);
  return worker.value.app;
};

/** For tests: git in `folder`, as a test person, for setting things up and looking at them. */
export const gitIn = (folder: string, ...args: string[]) =>
  git(folder, args, { config: ["user.name=Test", "user.email=test@example.com"] });

/** For tests: the message an error answer carries. */
export const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

/** For tests and the context eval: a request function, like `app.request`. */
export type Requester = (path: string, init?: RequestInit) => Response | Promise<Response>;

/** For tests: the `name=value` part of the login cookie a response set. */
export const loginCookie = (response: Response) => {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /(courtyard_login=[^;]+)/.exec(header);
  if (!match?.[1]) throw new Error(`no login cookie (status ${response.status}): ${header}`);
  return match[1];
};

/** For tests: sets up the owner on a fresh worker and returns this device's login cookie. */
export const setUpOwner = async (app: Hono) =>
  loginCookie(
    await app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "test password" }),
    }),
  );

/** For tests: makes requests to `app` as a device logged in with `cookie`. */
export const requesterFor =
  (app: Hono, cookie: string): Requester =>
  (path, init = {}) =>
    app.request(path, { ...init, headers: { ...init.headers, cookie } });

/**
 * For tests and the context eval: sets up the owner on a fresh worker and returns a way to make requests as the owner.
 * Goes through the API like a browser would, so tests still only touch the worker's front door.
 */
export const asOwner = async (app: Hono) => requesterFor(app, await setUpOwner(app));

/**
 * For tests and the context eval: reads a session's server-sent events until one of type `until` arrives (or one that
 * `until` picks out), then hangs up, like a browser tab closing. Starts after `after`, or after
 * `lastEventId` sent the way a reconnecting browser sends it.
 */
export const followSession = async (
  request: Requester,
  read: {
    sessionId: string;
    until: SessionEvent["type"] | ((event: SessionEvent) => boolean);
    after?: number;
    lastEventId?: number;
    onEvent?: (event: SessionEvent) => void;
  },
) => {
  const response = await request(
    `/api/sessions/${read.sessionId}/events?after=${read.after ?? 0}`,
    read.lastEventId === undefined
      ? {}
      : { headers: { "last-event-id": String(read.lastEventId) } },
  );
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(`not an event stream (status ${response.status})`);
  }
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) throw new Error("no event stream");
  const { until } = read;
  const isLast =
    typeof until === "function" ? until : (event: SessionEvent) => event.type === until;

  const events: SessionEvent[] = [];
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream ended before the event it waited for");
    buffer += value;
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      const data = message.split("\n").find((line) => line.startsWith("data: "));
      if (!data) continue;
      const event = SessionEvent.parse(JSON.parse(data.slice("data: ".length)));
      read.onEvent?.(event);
      events.push(event);
      if (isLast(event)) {
        await reader.cancel();
        return events;
      }
    }
  }
};

/** For tests: the scripted fake provider's model. */
export const FAKE_MODEL = { provider: "fake", model: "echo" };

/** For tests: the second fake's model, which "please hit Fake two's limit" sends to its usage limit. */
export const FAKE_TWO_MODEL = { provider: "fake-two", model: "echo" };

/** For tests: a provider that's there but not signed in, as Codex is before the owner signs in. */
export const signedOutProvider = (): Provider => {
  const id = ProviderId.parse("away");
  const capabilities = {
    readsFiles: false,
    codes: false,
    usesTools: false,
    savesContext: false,
    searchesWeb: false,
  };
  const notSignedIn = { kind: "provider-unavailable", message: "Not signed in." } as const;
  return {
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Away",
      available: false,
      reason: "Away isn't signed in.",
      signedOut: true,
    }),
    runTurn: async () => err(notSignedIn),
    answerOnce: async () => err(notSignedIn),
  };
};

/** For tests and the context eval: sends JSON, the way the web app does. */
export const postJson = (request: Requester, path: string, body: unknown) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** For tests: sends JSON with any method, such as PUT or DELETE. */
export const sendJson = (request: Requester, path: string, method: string, body: unknown) =>
  request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** For tests: starts a session in the garage-gym workspace with the owner's first message. */
export const startSession = async (request: Requester, text: string, model = FAKE_MODEL) => {
  const response = await postJson(request, "/api/workspaces/garage-gym/sessions", { text, model });
  if (response.status !== 201) throw new Error(`starting a session failed with ${response.status}`);
  return SessionSummary.parse(await response.json());
};

/** For tests: gives a session a new title, the way the web app does. */
export const renameSession = (request: Requester, id: string, title: unknown) =>
  request(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

/** For tests: a fake provider that holds each turn open until the test lets it go, if ever. */
export const gatedProvider = () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Held until released, or until the turn is stopped.
  const heldUntilReleased = (signal: AbortSignal) =>
    Promise.race([
      gate,
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
  return { provider: createFakeProvider({ delayMs: 0, beforeReply: heldUntilReleased }), release };
};

/**
 * For tests: one step of a scripted turn: a save the model asks for (its input), a call to another
 * of Courtyard's tools by name (`call`), or something to do mid-turn.
 */
export type ScriptedStep =
  | Readonly<Record<string, unknown>>
  | { readonly call: string; readonly input: unknown }
  /** Text the model writes at that point in its answer. */
  | { readonly write: string }
  /** A file in the workspace the model reads at that point, by its path there, reported as read. */
  | { readonly read: string }
  | (() => Promise<void>);

/** For tests: what the worker told a model about one of its tool calls: whether it did it, and what it said. */
export type ToolCallReply = { readonly ok: boolean; readonly reply: string };

const isCall = (step: ScriptedStep): step is { call: string; input: unknown } =>
  typeof step !== "function" && "call" in step && typeof step.call === "string";

const isWrite = (step: ScriptedStep): step is { write: string } =>
  typeof step !== "function" && "write" in step && typeof step.write === "string";

const isRead = (step: ScriptedStep): step is { read: string } =>
  typeof step !== "function" && "read" in step && typeof step.read === "string";

/** For tests: the model the saving provider offers. */
export const SAVING_MODEL = { provider: "saver", model: "one" };

/**
 * For tests: a provider that, in each turn, hands the worker the saves and tool calls scripted for
 * that turn in order (running any function steps between them), keeps the worker's replies, and
 * answers "Done." With `holdAfterSaves`, it then waits until the turn is stopped.
 */
export const savingProvider = (
  turns: readonly (readonly ScriptedStep[])[],
  options: {
    holdAfterSaves?: boolean;
    /** Whether it codes, so it can work in a code workspace (ADR 0007); it never edits anything. */
    codes?: boolean;
  } = {},
) => {
  const replies: ToolCallReply[][] = [];
  const framings: Framing[] = [];
  const id = ProviderId.parse("saver");
  const capabilities = {
    readsFiles: false,
    codes: options.codes ?? false,
    usesTools: false,
    savesContext: true,
    searchesWeb: false,
  };
  const provider: Provider = {
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Saver",
      available: true,
      models: [{ id: ModelId.parse("one"), label: "One", efforts: [] }],
      capabilities,
    }),
    runTurn: async (input) => {
      const turnReplies: ToolCallReply[] = [];
      const steps = turns[replies.length] ?? [];
      replies.push(turnReplies);
      framings.push(input.framing);
      for (const step of steps) {
        if (typeof step === "function") await step();
        else if (isWrite(step)) await input.emit(step.write);
        else if (isRead(step)) await input.report({ kind: "read-file", path: step.read });
        else {
          const reply = await input.callTool(
            isCall(step)
              ? { name: step.call, input: step.input }
              : { name: SAVE_TOOL_NAME, input: step },
          );
          const text = reply.content
            .map((part) => (part.kind === "text" ? part.text : ""))
            .join("");
          turnReplies.push({ ok: reply.ok, reply: text });
        }
      }
      if (options.holdAfterSaves) {
        await new Promise((resolve) =>
          input.signal.addEventListener("abort", resolve, { once: true }),
        );
        return ok(null);
      }
      await input.emit("Done.");
      return ok(null);
    },
    answerOnce: async () => err({ kind: "unknown", message: "The saver only saves." }),
  };
  return { provider, replies, framings };
};

/** For tests: the model the coding provider offers. */
export const CODING_MODEL = { provider: "coder", model: "one" };

/**
 * For tests: a provider that codes (ADR 0007). In each turn it asks the worker about each edit
 * (`edit`, a path) and command (`run`) scripted for it, in order, keeps the worker's answers, and
 * answers "Done." It never edits or runs anything itself, so any command can be asked about. A
 * `<branch>` in a command stands for the branch its worktree is on, the session branch.
 */
export const codingProvider = (
  steps: readonly (
    | { readonly edit: string }
    /** A command, and what the model says it's for (shown on an approval, #171). */
    | { readonly run: string; readonly why?: string }
  )[],
) => {
  const answers: Result<null, string>[] = [];
  const id = ProviderId.parse("coder");
  const capabilities = {
    readsFiles: true,
    codes: true,
    usesTools: false,
    savesContext: false,
    searchesWeb: false,
  };
  const provider: Provider = {
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Coder",
      available: true,
      models: [{ id: ModelId.parse("one"), label: "One", efforts: [] }],
      capabilities,
    }),
    runTurn: async (input) => {
      const { code } = input;
      if (code === null) return err({ kind: "unknown", message: "The coder only codes." });
      const branch = await git(code.worktree, ["branch", "--show-current"]);
      for (const step of steps) {
        answers.push(
          "edit" in step
            ? await code.edit(step.edit)
            : await code.run(step.run.replaceAll("<branch>", branch), step.why),
        );
      }
      await input.emit("Done.");
      return ok(null);
    },
    answerOnce: async () => err({ kind: "unknown", message: "The coder only codes." }),
  };
  return { provider, answers };
};

/** For tests: the model the running provider offers. */
export const RUNNING_MODEL = { provider: "runner", model: "one" };

/**
 * For tests: a provider that codes and, in each turn, runs each of `commands` itself in the
 * worktree, in the environment the worker gives a code session's commands, as Claude Code runs
 * its commands (#99). It doesn't ask the worker first, so it can run what no model may (`gh auth
 * token`) and show what the environment holds. Keeps whether each one worked and what it printed,
 * and each turn's framing and the environment the worker gave its commands.
 */
export const runningProvider = (
  commands: readonly { readonly command: readonly string[]; readonly input?: string }[],
) => {
  const printed: { ok: boolean; output: string }[] = [];
  const framings: Framing[] = [];
  const envs: CodeTurn["env"][] = [];
  const id = ProviderId.parse("runner");
  const capabilities = {
    readsFiles: true,
    codes: true,
    usesTools: false,
    savesContext: false,
    searchesWeb: false,
  };
  const provider: Provider = {
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Runner",
      available: true,
      models: [{ id: ModelId.parse("one"), label: "One", efforts: [] }],
      capabilities,
    }),
    runTurn: async (input) => {
      const { code } = input;
      if (code === null) return err({ kind: "unknown", message: "The runner only codes." });
      framings.push(input.framing);
      envs.push(code.env);
      for (const { command, input: stdin } of commands) {
        const [program = "", ...args] = command;
        const ran = spawnSync(program, args, {
          cwd: code.worktree,
          env: { ...process.env, ...code.env },
          input: stdin ?? "",
          encoding: "utf8",
          windowsHide: true,
          timeout: 30_000,
        });
        printed.push({ ok: ran.status === 0, output: `${ran.stdout ?? ""}${ran.stderr ?? ""}` });
      }
      await input.emit("Done.");
      return ok(null);
    },
    answerOnce: async () => err({ kind: "unknown", message: "The runner only codes." }),
  };
  return { provider, printed, framings, envs };
};

/** For tests: one turn the held coder is working on: where, with what, and how to let it end. */
export type HeldCodeTurn = {
  readonly worktree: string;
  /** What its commands run with as well. */
  readonly env: CodeTurn["env"];
  /** Lets the turn end, answering "Done.". */
  readonly finish: () => void;
};

/**
 * For tests: a provider that codes (ADR 0007) and holds each turn open until the test finishes it
 * (or it's stopped), so several code sessions can be running at once. `turns` lists every turn it
 * has started, in order, as it starts.
 */
export const heldCoder = () => {
  const turns: HeldCodeTurn[] = [];
  const { provider: coder } = codingProvider([]);
  const provider: Provider = {
    ...coder,
    runTurn: async (input) => {
      const { code } = input;
      if (code === null) return err({ kind: "unknown", message: "The coder only codes." });
      const finished = new Promise<void>((finish) => {
        turns.push({ worktree: code.worktree, env: code.env, finish });
        input.signal.addEventListener("abort", () => finish(), { once: true });
      });
      await finished;
      if (!input.signal.aborted) await input.emit("Done.");
      return ok(null);
    },
  };
  return { provider, turns };
};

/**
 * For tests: writes a skill's folder in `skillsDir`: a SKILL.md with its name and description
 * (none when it's empty) and `body`, any other files given, and a script when it has one.
 */
export const writeSkill = async (
  skillsDir: string,
  name: string,
  options: {
    description?: string;
    body?: string;
    files?: Readonly<Record<string, string>>;
    scripts?: boolean;
  } = {},
) => {
  const folder = join(skillsDir, name);
  await mkdir(folder, { recursive: true });
  const description = options.description ?? `What ${name} does.`;
  const fields = [`name: ${name}`, ...(description === "" ? [] : [`description: ${description}`])];
  const body = options.body ?? "Do it.";
  await writeFile(join(folder, "SKILL.md"), `---\n${fields.join("\n")}\n---\n\n${body}\n`);
  for (const [path, text] of Object.entries(options.files ?? {})) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  if (options.scripts) {
    await mkdir(join(folder, "scripts"));
    await writeFile(join(folder, "scripts", "run.sh"), "echo done\n");
  }
};

/** For tests: a house skills package in `dir`, with `skills.json` and a stand-in for each skill. */
export const writeHouseSkills = async (
  dir: string,
  skills: readonly { name: string; workspaces: readonly string[]; start?: string }[],
) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "skills.json"), JSON.stringify({ skills }));
  for (const { name } of skills) await writeSkill(dir, name);
};

/**
 * For tests: what docs/ai-conduct.md quotes, from the quote starting with `firstWords` (inside a
 * list item too): the quoted lines, wrapped lines joined back up, list items and paragraphs kept.
 * Each `<placeholder>` in it is filled in from `filled`, as the model would read it.
 */
export const quotedInGuide = async (
  firstWords: string,
  filled: Readonly<Record<string, string>> = {},
) => {
  const guide = await readFile(join(import.meta.dirname, "../../../docs/ai-conduct.md"), "utf8");
  const lines = guide
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimStart());
  const start = lines.findIndex((line) => line.startsWith(`> ${firstWords}`));
  if (start === -1) throw new Error(`docs/ai-conduct.md quotes nothing starting "${firstWords}"`);
  const quoted: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith(">")) break;
    quoted.push(line.replace(/^> ?/, ""));
  }
  const text = quoted
    .join("\n")
    .split("\n\n")
    .map((paragraph) => paragraph.replace(/\n(?!- )\s*/g, " "))
    .join("\n\n");
  return Object.entries(filled).reduce(
    (quote, [name, value]) => quote.replaceAll(`<${name}>`, value),
    text,
  );
};

/**
 * For tests: a repository a code workspace works on, as on the worker machine: the owner's
 * checkout (`repo`) of a remote (`origin`, standing in for GitHub) whose default branch is `main`,
 * with one commit, `README.md`. Commits made in it are by a test person. The remote is named by
 * its address on GitHub (`github`, as `owner/name`), which git takes to `origin` on disk.
 */
export const codeRepo = async (root: string) => {
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const github = "octo-owner/side-project";
  await mkdir(origin, { recursive: true });
  await gitIn(origin, "init", "--quiet", "--bare", "--initial-branch=main");
  await gitIn(root, "clone", "--quiet", origin, repo);
  await standInForGitHub(repo, { origin, github });
  await gitIn(repo, "config", "user.name", "Test");
  await gitIn(repo, "config", "user.email", "test@example.com");
  await writeFile(join(repo, "README.md"), "# A project\n");
  await gitIn(repo, "add", ".");
  await gitIn(repo, "commit", "--quiet", "-m", "Start");
  await gitIn(repo, "push", "--quiet", "origin", "main");
  return { origin, repo, github };
};

/**
 * For tests: names `repo`'s remote by its address on GitHub (`github`, as `owner/name`), as a
 * real clone's is, while git reaches the bare repository `origin` on disk in its place.
 */
export const standInForGitHub = async (repo: string, where: { origin: string; github: string }) => {
  const address = `https://github.com/${where.github}.git`;
  await gitIn(repo, "remote", "set-url", "origin", address);
  await gitIn(repo, "config", `url.${where.origin.replaceAll("\\", "/")}.insteadOf`, address);
};

/** For tests: makes the `id` workspace in `root`'s context folder a code workspace on `repoPath`. */
export const codeWorkspace = async (root: string, id: string, repoPath: string) => {
  await mkdir(join(root, "context", id), { recursive: true });
  await writeFile(
    join(root, "context", id, "workspace.json"),
    JSON.stringify({ mode: "code", repoPath }),
  );
};

/** For tests: the context folder's changes, newest first: each one's title and trailers. */
export const changesIn = async (contextDir: string) => {
  const log = await gitIn(contextDir, "log", "--format=%s%x1f%b%x1e");
  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [title = "", body = ""] = entry.split("\x1f");
      return { title, trailers: body.split("\n").filter((line) => line.trim() !== "") };
    });
};

/**
 * For tests and the eval: sends a message with files attached, the way the web app does: its JSON
 * in one field of a multipart form and each file in another.
 */
export const postWithFiles = (
  request: Requester,
  path: string,
  message: unknown,
  files: readonly TestFile[],
) => {
  const form = new FormData();
  form.set(MESSAGE_FIELD, JSON.stringify(message));
  for (const file of files) {
    form.append(ATTACHMENTS_FIELD, new File([file.bytes], file.name, { type: file.type }));
  }
  return request(path, { method: "POST", body: form });
};
