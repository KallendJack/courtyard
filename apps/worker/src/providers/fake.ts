import { exec } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  type Capabilities,
  Effort,
  type FailureReason,
  HelperId,
  ModelId,
  ProviderId,
  type SignInState,
  type UsageWindow,
} from "@courtyard/contract";
import { pngOf } from "../../test/test-files.ts";
import { pageRead, turnSources } from "../features/sources/index.ts";
import { writeTextFileIn } from "../lib/files.ts";
import { err, ok, type Result } from "../lib/result.ts";
import {
  DOCUMENT_TOOL_NAME,
  LEAD_TOOL_NAME,
  PREVIEW_TOOL_NAME,
  PROJECT_TOOL_NAME,
  READ_SESSION_TOOL_NAME,
  SAVE_TOOL_NAME,
  SUGGEST_REPLIES_TOOL_NAME,
  THING_TOOL_NAME,
  USE_SKILL_TOOL_NAME,
} from "../prompts/index.ts";
import type {
  Activity,
  AddedMessage,
  AddedMessages,
  CodeTurn,
  FramedAttachment,
  Framing,
  HeardMeter,
  HelperCode,
  Provider,
  SignIn,
  ToolConnection,
  ToolContent,
  TurnInput,
  TurnToolName,
  UsageReading,
} from "./index.ts";

/** The fake reads nothing; it echoes, and saves, codes and uses Paper when a message scripts it. */
const CAPABILITIES: Capabilities = {
  readsFiles: false,
  codes: true,
  usesTools: true,
  savesContext: true,
  searchesWeb: true,
  steers: true,
};

/** The levels of effort the fake's model takes, so picking one can be seen and tested. */
const EFFORTS = [
  { id: Effort.parse("low"), label: "Low" },
  { id: Effort.parse("medium"), label: "Medium" },
  { id: Effort.parse("high"), label: "High" },
];

const SECTIONS = {
  fact: "facts",
  plan: "plans",
  idea: "ideas",
  preference: "answers",
} as const;
const ADD = /^save (owner )?(fact|plan|idea|preference): (.+)$/i;
const CHANGE = /^change (\w+) to (owner )?(fact|plan|idea|preference): (.+)$/i;
const REMOVE = /^remove (\w+)$/i;

/**
 * Where a scripted save goes: "owner fact" is About me and "preference" How to answer me. Without
 * "owner", it names no place, as a model needn't: an added line goes to the workspace and a
 * changed one stays where it is.
 */
const whereTo = (owner: string | undefined, word: string) => {
  const lower = word.toLowerCase();
  const section =
    SECTIONS[lower === "plan" || lower === "idea" || lower === "preference" ? lower : "fact"];
  return owner ? { place: "owner", section } : { section };
};

/**
 * The saves a message scripts, one per line: "save fact: …", "save owner fact: …", "save
 * preference: …", "change F1 to plan: …", "remove I2".
 */
const scriptedSaves = (message: string): Record<string, string>[] =>
  message.split("\n").flatMap((line): Record<string, string>[] => {
    const text = line.trim();
    const add = ADD.exec(text);
    if (add?.[2] && add[3]) return [{ action: "add", ...whereTo(add[1], add[2]), text: add[3] }];
    const change = CHANGE.exec(text);
    if (change?.[1] && change[3] && change[4]) {
      return [
        {
          action: "change",
          ...whereTo(change[2], change[3]),
          label: change[1],
          text: change[4],
        },
      ];
    }
    const remove = REMOVE.exec(text);
    return remove?.[1] ? [{ action: "remove", label: remove[1] }] : [];
  });

const USE_SKILL = /^use skill ([a-z0-9-]+)(?: (\S+))?$/i;

/**
 * The skills a message scripts loading, one per line: "use skill grilling" for its instructions,
 * "use skill programme-check references/deload-weeks.md" for one of its files.
 */
const scriptedSkillLoads = (message: string): Record<string, string>[] =>
  message.split("\n").flatMap((line) => {
    const [, name, path] = USE_SKILL.exec(line.trim()) ?? [];
    return name === undefined ? [] : [{ name, ...(path === undefined ? {} : { path }) }];
  });

const SUGGEST_REPLIES = /^suggest replies: (.+)$/i;

/** The replies a message scripts suggesting, on a line "suggest replies: Back wall | By the door". */
const scriptedReplies = (message: string): { replies: string[] }[] =>
  message.split("\n").flatMap((line) => {
    const [, replies] = SUGGEST_REPLIES.exec(line.trim()) ?? [];
    return replies === undefined ? [] : [{ replies: replies.split("|").map((r) => r.trim()) }];
  });

const SAVE_DOCUMENT = /^save document:?$/i;
const UPDATE_DOCUMENT = /^update document (\S+?):?(?: (.+))?$/i;

/**
 * The document a message scripts saving (ADR 0020): a line "save document", or "update document
 * docs/packing-list.md: added grips" (what changed after the colon, if anything), with the
 * document's whole text on the lines after it.
 */
const scriptedDocuments = (message: string): Record<string, string>[] => {
  const lines = message.split("\n");
  const at = lines.findIndex(
    (line) => SAVE_DOCUMENT.test(line.trim()) || UPDATE_DOCUMENT.test(line.trim()),
  );
  if (at === -1) return [];
  const text = lines.slice(at + 1).join("\n");
  const [, path, change] = UPDATE_DOCUMENT.exec(lines[at]?.trim() ?? "") ?? [];
  return [
    {
      text,
      ...(path === undefined ? {} : { path }),
      ...(change === undefined ? {} : { change }),
    },
  ];
};

const READ_FILE = /^read file: (\S+)$/i;

const WRITE = /^write: (.+)$/i;

/**
 * What a message scripts the fake writing and reading on its way to its answer, one per line, in
 * order: "write: Now the contract." writes that, as a model writes between what it does, and "read
 * file: docs/notes.md" reads one of the workspace's files.
 */
const scriptedWork = (message: string) =>
  message
    .split("\n")
    .flatMap((line): ({ kind: "write"; text: string } | { kind: "read"; path: string })[] => {
      const [, text] = WRITE.exec(line.trim()) ?? [];
      if (text !== undefined) return [{ kind: "write", text }];
      const [, path] = READ_FILE.exec(line.trim()) ?? [];
      return path === undefined ? [] : [{ kind: "read", path }];
    });

const THING = /^thing (\S+?): *(.*)$/i;
const THING_FIELD =
  /^(name|status|brand|bought|price|condition|size|where|part of|history|photo|remove|upcoming price|upcoming shop|upcoming link|upcoming why|upcoming|fitted)\b *(.*)$/i;

/**
 * The Thing saves a message scripts (ADR 0020), one per line: "thing add: name Tyres | status
 * have | part of T1" adds one, and "thing T2: history Swapped | price £32", "thing T2: upcoming
 * DMR V8 | upcoming price £28" or "thing T2: fitted"
 * (#602), "thing T2: photo 1" or "thing T2: remove" changes or removes the Thing labelled T2.
 * Each field is its name, then its value; an empty value clears it.
 */
const scriptedThings = (message: string): Record<string, unknown>[] =>
  message.split("\n").flatMap((line) => {
    const [, which = "", rest = ""] = THING.exec(line.trim()) ?? [];
    if (which === "") return [];
    const input: Record<string, unknown> = which.toLowerCase() === "add" ? {} : { thing: which };
    for (const part of rest.split("|")) {
      const [, field = "", value = ""] = THING_FIELD.exec(part.trim()) ?? [];
      const key = field.toLowerCase().replace(" ", "_");
      if (key === "") continue;
      input[key] =
        key === "remove" || key === "fitted"
          ? true
          : key === "photo"
            ? Number(value)
            : value.trim();
    }
    return [input];
  });

const PROJECT = /^project: *(\{.*\})$/i;

/**
 * The project saves a message scripts (#603), one per line: "project: " and the tool's input as
 * JSON, such as `project: {"name": "Garage office", "add_steps": [{"kind": "needs a pro", "text":
 * "Sockets"}]}`. A line whose JSON doesn't read is left out.
 */
const scriptedProjects = (message: string): unknown[] =>
  message.split("\n").flatMap((line) => {
    const [, json] = PROJECT.exec(line.trim()) ?? [];
    if (json === undefined) return [];
    try {
      return [JSON.parse(json)];
    } catch {
      return [];
    }
  });

const PREVIEW_SHOT = /^preview screenshot: (\S+)(?: (\S+))?$/i;

/**
 * What a message to a code session scripts its preview screenshot tool doing (#183), one per
 * line: "preview screenshot: <path> <size>", such as "preview screenshot: / cover". Each reply's
 * words go in its answer, "Preview: <reply>", so what the model was told can be seen.
 */
const scriptedPreview = async (
  message: string,
  callTool: TurnInput["callTool"],
): Promise<string> => {
  const said: string[] = [];
  for (const line of message.split("\n")) {
    const [, path, size] = PREVIEW_SHOT.exec(line.trim()) ?? [];
    if (path === undefined) continue;
    const reply = await callTool({
      name: PREVIEW_TOOL_NAME,
      input: { path, ...(size === undefined ? {} : { size }) },
    });
    const words = reply.content.flatMap((part) => (part.kind === "text" ? [part.text] : []));
    said.push(`Preview: ${words.join(" ")}\n\n`);
  }
  return said.join("");
};

const BUILD_ORDER = /^(?:build order: )?(pause|run|skip #?(\d+)|builders (\d+))\.?$/i;

/**
 * What a message to a code workspace's Lead scripts its build order tool doing (#347), one per
 * line: "pause" (as the owner says it), "run", "skip #22" or "builders 3", each with or without
 * "build order: " before it.
 */
const scriptedBuildOrder = (message: string): Record<string, unknown>[] =>
  message.split("\n").flatMap((line) => {
    const [, action = "", issue, count] = BUILD_ORDER.exec(line.trim()) ?? [];
    const verb = action.toLowerCase().split(" ")[0] ?? "";
    if (verb === "") return [];
    if (issue !== undefined) return [{ action: "skip", issue: Number(issue) }];
    if (count !== undefined) return [{ action: "builders", count: Number(count) }];
    return [{ action: verb }];
  });

/**
 * The calls a message scripts to each of Courtyard's tools, in the order the fake makes them:
 * skills loaded first, then saves, documents and Things, then suggested replies, then the Lead's
 * build order tool.
 */
const SCRIPTED_CALLS: readonly (readonly [TurnToolName, (message: string) => unknown[]])[] = [
  [USE_SKILL_TOOL_NAME, scriptedSkillLoads],
  [SAVE_TOOL_NAME, scriptedSaves],
  [DOCUMENT_TOOL_NAME, scriptedDocuments],
  [THING_TOOL_NAME, scriptedThings],
  [PROJECT_TOOL_NAME, scriptedProjects],
  [SUGGEST_REPLIES_TOOL_NAME, scriptedReplies],
  [LEAD_TOOL_NAME, scriptedBuildOrder],
];

const SEARCH = /^search the web for: (.+)$/i;
const READ_PAGE = /^read page: (\S+)$/i;
const CITE = /^cite: (.+)$/i;

/**
 * What a message scripts the fake doing on the web (ADR 0019), one per line: "search the web for:
 * …" searches, "read page: <address>" reads a page, and "cite: [title](address)" lists a page as a
 * source, the way a model's answer links it.
 */
const scriptedWeb = (message: string) => {
  const activities: Activity[] = [];
  const cited: string[] = [];
  for (const line of message.split("\n").map((each) => each.trim())) {
    const [, query] = SEARCH.exec(line) ?? [];
    const [, url] = READ_PAGE.exec(line) ?? [];
    const [, link] = CITE.exec(line) ?? [];
    if (query !== undefined) activities.push({ kind: "web-searched", query });
    const read = url === undefined ? undefined : pageRead(url);
    if (read !== undefined) activities.push(read);
    if (link !== undefined) cited.push(link);
  }
  return {
    activities,
    sources: turnSources({ answer: cited.join("\n"), read: [], searches: [] }),
  };
};

/** How many words of the owner's first message a scripted title keeps. */
const TITLE_WORDS = 5;

/**
 * The title a session's first message scripts: its first few words in title case ("Where should
 * the rack go?" is "Where Should The Rack Go"). "no title please" fails on purpose.
 */
const scriptedTitle = (message: string): Result<{ title: string }, FailureReason> => {
  const first = /^Owner: (.*)$/m.exec(message)?.[1] ?? "";
  if (/no title please/i.test(first)) {
    return err({
      kind: "unknown",
      message: "The fake didn't title it, because it was asked not to.",
    });
  }
  const words = first.match(/[\p{L}\p{N}']+/gu) ?? [];
  const title = words
    .slice(0, TITLE_WORDS)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return ok({ title });
};

const NOTE_LINE = /\b(done|decided|next): ([^;\n]+)/gi;

/**
 * The note a session's conversation scripts (#601): each line as the message last names it,
 * "done: …", "decided: …" and "next: …" ending at a semicolon or the line's end, so the
 * conversation's words win over the note it carries on from; empty for one it doesn't name. "no
 * note please" fails on purpose.
 */
const scriptedNote = (message: string): Result<Record<string, string>, FailureReason> => {
  if (/no note please/i.test(message)) {
    return err({
      kind: "unknown",
      message: "The fake didn't write a note, because it was asked not to.",
    });
  }
  const note: Record<string, string> = { done: "", decided: "", next: "" };
  for (const [, line = "", text = ""] of message.matchAll(NOTE_LINE)) {
    note[line.toLowerCase()] = text.trim();
  }
  return ok(note);
};

const READ_SESSION = /^read session: (\S+)$/i;

/**
 * What a message scripts the read session tool doing (#601), one per line: "read session: <id>".
 * Each reply's words go in its answer, "Session: <reply>", so what the model was told can be seen.
 */
const scriptedSessionReads = async (
  message: string,
  callTool: TurnInput["callTool"],
): Promise<string> => {
  const said: string[] = [];
  for (const line of message.split("\n")) {
    const [, session] = READ_SESSION.exec(line.trim()) ?? [];
    if (session === undefined) continue;
    const reply = await callTool({ name: READ_SESSION_TOOL_NAME, input: { session } });
    const words = reply.content.flatMap((part) => (part.kind === "text" ? [part.text] : []));
    said.push(`Session: ${words.join(" ")}\n\n`);
  }
  return said.join("");
};

const POINT_AT = /point at (\S+) line (\d+)/gi;

/**
 * The answer a quick question about a pull request scripts (#327): "You asked: …", pointing at
 * each line it names as "point at <path> line <n>". "please fail" fails on purpose.
 */
const scriptedQuickAnswer = (message: string): Result<unknown, FailureReason> => {
  const question = /The owner's question: (.*)$/s.exec(message)?.[1] ?? "";
  if (/please fail/i.test(question)) {
    return err({
      kind: "unknown",
      message: "The fake didn't answer, because it was asked not to.",
    });
  }
  const lines = [...question.matchAll(POINT_AT)].map(([, path = "", line = "0"]) => ({
    path,
    line: Number(line),
  }));
  return ok({ answer: `You asked: ${question}`, lines });
};

/**
 * A pretend sign-in, starting signed out, so signing in can be seen and tested with no real
 * provider: its link and code are made up, and it finishes after `finishAfterMs`, or never.
 */
const fakeSignIn = (options: { finishAfterMs?: number }): SignIn => {
  let state: SignInState = { kind: "signed-out" };
  let finishing: ReturnType<typeof setTimeout> | undefined;
  const stopFinishing = () => clearTimeout(finishing);
  return {
    service: "Fake",
    state: async () => state,
    start: async () => {
      stopFinishing();
      state = {
        kind: "waiting",
        link: "https://courtyard.example/device",
        code: "FAKE-2026",
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
      const { finishAfterMs } = options;
      if (finishAfterMs !== undefined) {
        finishing = setTimeout(() => {
          state = { kind: "signed-in", email: "owner@courtyard.example", plan: "pretend" };
        }, finishAfterMs);
      }
      return ok(state);
    },
    cancel: async () => {
      stopFinishing();
      if (state.kind !== "signed-in") state = { kind: "signed-out" };
    },
    signOut: async () => {
      stopFinishing();
      state = { kind: "signed-out" };
      return ok(null);
    },
  };
};

/**
 * What "please look" makes the fake say it was given (#78): the turn's attachments by name, "I see
 * IMG_2041.jpg (a photo) and rack-manual.pdf (a PDF). ", or "I see nothing attached. ".
 */
const seen = (attachments: readonly FramedAttachment[]) => {
  const named = attachments.map(
    ({ name, kind }) => `${name} (${kind === "photo" ? "a photo" : "a PDF"})`,
  );
  const last = named.pop();
  if (last === undefined) return "I see nothing attached. ";
  return `I see ${named.length === 0 ? last : `${named.join(", ")} and ${last}`}. `;
};

const EDIT_FILE = /^edit file (\S+): (.*)$/i;
const RUN_COMMAND = /^run command: (.+?)(?: \(for: (.+)\))?$/i;
const START_TASK = /^start task: (.+?)(?: \(for: (.+)\))?$/i;
const UPDATE_TASKS = /^update the task list$/i;

/** The first line a command printed, or nothing. */
const firstLine = (output: string) =>
  output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");

/**
 * Runs a command the worker allowed in the worktree, with what the session gives its commands (its
 * slot, and Courtyard's GitHub sign-in), as a shell would, and says how it went.
 */
const runIn = (code: HelperCode, command: string) =>
  new Promise<string>((resolve) => {
    exec(
      command,
      {
        cwd: code.worktree,
        env: { ...process.env, ...code.env },
        windowsHide: true,
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        const said = firstLine(error ? `${stderr}\n${stdout}` : stdout);
        const how = error ? `${command} failed` : `Ran ${command}`;
        resolve(said === undefined ? `${how}. ` : `${how}: ${said} `);
      },
    );
  });

/**
 * What a message scripts the fake doing in a code session (ADR 0007), one per line, in order:
 * "edit file notes.md: The rack goes on the back wall" writes that line as the file, and "run
 * command: git status" runs the command in the worktree, each only once the worker allows it (or
 * the owner does, #171). A command can say what it's for at the end: "run command: git --version
 * (for: To check which git runs here)". Says how each went, or why it was refused. "update the
 * task list" updates its task list, as Claude's does (ADR 0025). "start task: pnpm dev" asks for
 * it to run in the background, as a task (#182), and says what the worker said.
 */
const scriptedCoding = async (code: CodeTurn, message: string, report: TurnInput["report"]) => {
  let said = "";
  for (const line of message.split("\n").map((each) => each.trim())) {
    if (UPDATE_TASKS.test(line)) {
      await report({ kind: "updated-tasks" });
      continue;
    }
    const [, task, purpose] = START_TASK.exec(line) ?? [];
    if (task !== undefined) {
      const started = await code.task(task, purpose);
      said += `${started.ok ? started.value : `Couldn't start ${task}: ${started.error}`} `;
      continue;
    }
    const [, path, text] = EDIT_FILE.exec(line) ?? [];
    const [, command, why] = RUN_COMMAND.exec(line) ?? [];
    if (path !== undefined && text !== undefined) {
      const allowed = await code.edit(path);
      if (!allowed.ok) said += `Couldn't edit ${path}: ${allowed.error} `;
      else await writeTextFileIn(resolve(code.worktree, path), `${text}\n`);
    } else if (command !== undefined) {
      const allowed = await code.run(command, why);
      if (allowed.ok) {
        said += await runIn(code, command);
        code.ran(command);
      } else {
        said += `Couldn't run ${command}: ${allowed.error} `;
      }
    }
  }
  return said;
};

const HELPER = /^helper (.+?): (.+)$/i;
const HELPER_REPORT = /^report: (.*)$/i;
const HOLD_COMMAND = /^hold command: (.+)$/i;
const PAUSE = /^pause (\d+)$/i;
const OWN_BRANCH = /^(.+?) \(own branch\)$/i;

/** Waits until the turn is stopped. */
const untilStopped = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

/**
 * One helper a message scripts (#117), on a line "helper Review against standards: read file:
 * src/slots.ts | run command: git diff main | report: Follows the standards.": started by that
 * name once the worker gives it a place, then each step in turn, as the model's own lines do
 * ("read file: …", "edit file …: …", "run command: … (for: …)"). "hold command: pnpm test" asks to
 * run a command and keeps it running (a build's place taken) until the turn is stopped, and
 * "hold" waits until then; "pause 500" waits that many milliseconds. "report: …" is its final
 * report, given as it finishes. A name ending "(own branch)" asks for a worktree and branch of
 * its own (#395), as a helper that writes code does: it works there, and its branch is merged
 * back as it finishes.
 */
const scriptedHelper = async (
  code: CodeTurn,
  helper: { id: number; name: string; steps: readonly string[] },
  signal: AbortSignal,
) => {
  const [, ownName] = OWN_BRANCH.exec(helper.name) ?? [];
  const name = ownName ?? helper.name;
  // A turn that starts no helpers, a Lead builder's (ADR 0031), offers no way to.
  if (code.helper === null) return;
  const turn = await code.helper({ id: HelperId.parse(`helper-${helper.id}`), name });
  if (turn === undefined) return;
  if (ownName !== undefined) {
    const made = await code.branchOff();
    if (made.ok) await turn.workIn(made.value);
  }
  let report = "";
  for (const step of helper.steps) {
    if (signal.aborted) return;
    const [, read] = READ_FILE.exec(step) ?? [];
    const [, path, text] = EDIT_FILE.exec(step) ?? [];
    const [, command, why] = RUN_COMMAND.exec(step) ?? [];
    const [, held] = HOLD_COMMAND.exec(step) ?? [];
    const [, paused] = PAUSE.exec(step) ?? [];
    const [, said] = HELPER_REPORT.exec(step) ?? [];
    if (read !== undefined) await turn.report({ kind: "read-file", path: read });
    else if (path !== undefined && text !== undefined) {
      const allowed = await turn.code.edit(path);
      if (allowed.ok) await writeTextFileIn(resolve(turn.code.worktree, path), `${text}\n`);
      else report += `Couldn't edit ${path}: ${allowed.error} `;
    } else if (command !== undefined) {
      const allowed = await turn.code.run(command, why);
      if (allowed.ok) {
        report += await runIn(turn.code, command);
        turn.code.ran(command);
      } else {
        report += `Couldn't run ${command}: ${allowed.error} `;
      }
    } else if (held !== undefined) {
      if ((await turn.code.run(held)).ok) await untilStopped(signal);
    } else if (/^hold$/i.test(step)) await untilStopped(signal);
    else if (paused !== undefined) await pause(Number(paused), signal);
    else if (said !== undefined) report += said;
  }
  if (!signal.aborted) await turn.finished(report.trim());
};

/**
 * The helpers a message scripts (#117), one per line (see `scriptedHelper`), all at work at once,
 * as a model starts several together. The turn goes on once every one has finished.
 */
const scriptedHelpers = async (code: CodeTurn, message: string, signal: AbortSignal) => {
  const helpers = message.split("\n").flatMap((line, id) => {
    const [, name, steps] = HELPER.exec(line.trim()) ?? [];
    return name === undefined || steps === undefined
      ? []
      : [{ id: id + 1, name, steps: steps.split(" | ").map((step) => step.trim()) }];
  });
  await Promise.all(helpers.map((helper) => scriptedHelper(code, helper, signal)));
};

const PAPER_CALL = /^paper (\w+)(?: (\{.*\}))?$/i;

/** A board the fake draws when a turn asks for a screenshot: a small PNG in Paper's colours. */
const BOARD = Buffer.from(
  pngOf(32, 20, (x, y) => (y < 4 ? [91, 74, 160] : x < 8 ? [212, 175, 55] : [24, 22, 32])),
);

/**
 * What Paper would give back for a call, as the fake plays it: a screenshot is the board above,
 * a new board or node is named by a made-up id, and anything else is the file's id.
 */
const paperAnswer = (tool: string, input: Record<string, unknown>, made: number): ToolContent[] => {
  const header = { fileId: input.fileId };
  if (tool === "get_screenshot") {
    return [
      { kind: "text", text: JSON.stringify(header) },
      { kind: "image", dataUrl: `data:image/png;base64,${BOARD.toString("base64")}` },
    ];
  }
  const id = `fake-${made}`;
  return [
    { kind: "text", text: JSON.stringify(tool.startsWith("create") ? { ...header, id } : header) },
  ];
};

/**
 * What a message scripts the fake doing in Paper (ADR 0023), one call per line: "paper
 * get_screenshot {"fileId": "file-1", "nodeId": "board-1"}" calls the tool with that input, once
 * the worker allows it (or the owner does). Paper itself never runs: the fake plays its answers
 * (see `paperAnswer`). Says when a call was refused, and why.
 */
const scriptedPaper = async (paper: ToolConnection, message: string) => {
  let said = "";
  let made = 0;
  for (const line of message.split("\n").map((each) => each.trim())) {
    const [, tool, json] = PAPER_CALL.exec(line) ?? [];
    if (tool === undefined) continue;
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(json ?? "{}");
      if (typeof parsed === "object" && parsed !== null) input = { ...parsed };
    } catch {
      // Sent as no input at all.
    }
    const allowed = await paper.check({ tool, input });
    if (!allowed.ok) {
      said += `Couldn't use Paper's ${tool}: ${allowed.error} `;
      continue;
    }
    made += 1;
    await paper.done({ tool, input, ok: true, content: paperAnswer(tool, input, made) });
  }
  return said;
};

/**
 * What the owner added while it answered (#252), each noted where it reads it: "noted: …", as a
 * model taking it on board would, and said to be read.
 */
const noted = async (noting: {
  added: AddedMessages;
  taken: readonly AddedMessage[];
  emit: TurnInput["emit"];
}) => {
  for (const each of noting.taken) {
    noting.added.read(each);
    await noting.emit(`noted: ${each.text}\n\n`);
  }
};

/** How long after a pretend usage limit the fake says it resets. */
const LIMIT_RESETS_AFTER_MS = 2 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
/** How long each of the fake's pretend plan windows lasts. */
const WINDOW_MS: Record<UsageWindow, number> = { "five-hour": 5 * HOUR_MS, weekly: 168 * HOUR_MS };

/** "use 82% of Fake's week" or "use 30% of Fake two's 5-hour": a plan window filling (#66). */
const usedIn = (label: string, message: string) =>
  [...message.matchAll(new RegExp(`use (\\d+)% of ${label}'s (week|5-hour)`, "gi"))].map(
    ([, used, window]): { window: UsageWindow; used: number } => ({
      window: window?.toLowerCase() === "week" ? "weekly" : "five-hour",
      used: Number(used),
    }),
  );

/**
 * The fake's pretend plan (#66), as it reads it: the first fake's starts quiet, a fifth of its
 * 5-hour window and a third of its week used; "unreadable" never reads, as a provider whose usage
 * call fails. A turn's "use 82% of Fake's week" fills a window and is heard as the turn runs.
 */
const pretendPlan = (
  start: UsageReading | "unreadable" | undefined,
  now: () => number,
): { reading: () => UsageReading | undefined; fill: (meter: HeardMeter) => HeardMeter } => {
  let plan =
    start ??
    ({
      kind: "plan",
      meters: [
        { window: "five-hour", used: 20, resetAt: new Date(now() + 3 * HOUR_MS).toISOString() },
        { window: "weekly", used: 33, resetAt: new Date(now() + 72 * HOUR_MS).toISOString() },
      ],
      models: [],
    } satisfies UsageReading);
  return {
    reading: () => (plan === "unreadable" ? undefined : plan),
    fill: (meter) => {
      if (plan === "unreadable" || plan.kind === "no-plan") return meter;
      const was = plan.meters.find((each) => each.window === meter.window);
      // A window past its reset has rolled on to its next.
      let resetAt = was?.resetAt === undefined ? undefined : Date.parse(was.resetAt);
      while (resetAt !== undefined && resetAt <= now()) resetAt += WINDOW_MS[meter.window];
      const filled =
        resetAt === undefined ? meter : { ...meter, resetAt: new Date(resetAt).toISOString() };
      plan = {
        ...plan,
        meters: [...plan.meters.filter((each) => each.window !== meter.window), filled].sort(
          (a, b) => (a.window === b.window ? 0 : a.window === "five-hour" ? -1 : 1),
        ),
      };
      return filled;
    },
  };
};

/** Waits `ms`, or less if the turn is stopped first. */
const pause = (ms: number, signal: AbortSignal) =>
  wait(ms, undefined, { signal }).catch(() => undefined);

/**
 * A scripted provider, so everything runs end to end with no models installed and no usage
 * (story 90). It answers "You said: …" a word at a time, and fails on purpose when a message asks
 * it to ("please fail"), so failures can be seen and tested. "please read" reports reading the
 * context file, so activity can be too, and lines such as "save fact: …" make saves (see
 * `scriptedSaves`) when the turn offers the save tool, and "use skill …" loads a skill (see
 * `scriptedSkillLoads`) when it offers the use skill tool, and "suggest replies: …" suggests
 * replies (see `scriptedReplies`) when it offers that tool, and "save document" or "update
 * document …" saves a document (see `scriptedDocuments`) when it offers the document tool, after
 * any "read file: …" it acts out reading, between any "write: …" it writes (see `scriptedWork`), and "thing add: …" or "thing T2:
 * …" saves a Thing (see `scriptedThings`) when it offers the Things tool. On a turn with web search, "search the
 * web for: …", "read page: …" and "cite: …" act out a search (see `scriptedWeb`). A session's title follows its first message (see `scriptedTitle`), and a quick
 * question's answer the question (see `scriptedQuickAnswer`). "please hit
 * Fake's limit" (or "Fake two's", for the second fake) acts out a usage limit that resets two
 * hours on, so overflow can be seen and tested, and "use 82% of Fake's week" (or "5-hour") fills
 * its pretend plan (see `pretendPlan`, #66). "please look", or a message of no words, says
 * which attachments it was given (see `seen`). In a code session, "edit file …" and "run command: …" edit and run, as the worker
 * allows (see `scriptedCoding`), and "helper …: …" starts a helper (see `scriptedHelpers`); Fake two doesn't code. With Paper, "paper <tool> {…}" calls one of
 * Paper's tools as the worker allows, the fake playing Paper (see `scriptedPaper`), and "preview
 * screenshot: <path> <size>" looks at the session's preview (see `scriptedPreview`). To a Lead,
 * "pause" pauses the build order (see `scriptedBuildOrder`). "read session: <id>" opens an
 * earlier session (see `scriptedSessionReads`), and a session's note follows its conversation
 * (see `scriptedNote`).
 */
export const createFakeProvider = (
  options: {
    /** Pause between words, so streaming is visible. */
    delayMs?: number;
    /** Awaited before answering; tests use it to hold a turn open. */
    beforeReply?: (signal: AbortSignal) => Promise<void>;
    /** Told the model and effort of each turn, so tests can see what reached the model. */
    heard?: (turn: { model: ModelId; effort: Effort | undefined }) => void;
    /** Told each turn's framing, so tests can see what the model was told. */
    framed?: (framing: Framing) => void;
    /**
     * Whether it takes what the owner adds while it answers (#252): it does, unless this says
     * not; Fake two never does, so there's a provider that queues instead.
     */
    steers?: boolean;
    /** A pretend sign-in, starting signed out (see `fakeSignIn`). The fake answers either way. */
    signIn?: { finishAfterMs?: number };
    /** The second fake, "Fake two", so there's another provider to carry on with. */
    second?: boolean;
    /** The clock its pretend usage limit's reset time is set by. */
    now?: () => number;
    /**
     * Its pretend plan usage (#66), as it starts (see `pretendPlan`): the first fake has a quiet
     * plan unless this says otherwise; the second has no plan limits unless given one.
     */
    usage?: UsageReading | "unreadable";
  } = {},
): Provider => {
  const delayMs = options.delayMs ?? 40;
  const now = options.now ?? Date.now;
  const id = ProviderId.parse(options.second ? "fake-two" : "fake");
  const label = options.second ? "Fake two" : "Fake";
  const hitsLimit = new RegExp(`please hit ${label}'s limit`, "i");
  const plan =
    options.second && options.usage === undefined ? undefined : pretendPlan(options.usage, now);
  // Fake two doesn't code, so a model that can't is there to be refused in a code workspace, nor
  // steer, so one that queues is there too.
  const capabilities = {
    ...CAPABILITIES,
    ...(options.second ? { codes: false, steers: false } : {}),
    ...(options.steers === undefined ? {} : { steers: options.steers }),
  };

  return {
    id,
    capabilities,
    // Its own model at Low, so an errand's model and effort can be seen (#245).
    errand: { model: ModelId.parse("echo"), effort: Effort.parse("low") },
    ...(options.signIn === undefined ? {} : { signIn: fakeSignIn(options.signIn) }),
    ...(plan === undefined ? {} : { readUsage: async () => plan.reading() }),
    status: async () => ({
      id,
      label,
      available: true,
      models: [
        {
          id: ModelId.parse("echo"),
          label: `${label} (echoes you)`,
          name: label,
          efforts: EFFORTS,
          defaultEffort: Effort.parse("medium"),
        },
      ],
      capabilities,
    }),

    runTurn: async ({
      model,
      effort,
      framing,
      code,
      connections,
      emit,
      report,
      cite,
      callTool,
      signal,
      added,
      heardUsage,
    }) => {
      options.heard?.({ model, effort });
      options.framed?.(framing);
      await options.beforeReply?.(signal);
      if (signal.aborted) return ok(null);
      const last = framing.newMessage;
      for (const meter of usedIn(label, last)) {
        const filled = plan === undefined ? meter : plan.fill(meter);
        heardUsage?.(filled);
      }
      if (/please read/i.test(last)) await report({ kind: "read-file", path: "CONTEXT.md" });
      for (const work of scriptedWork(last)) {
        // Each piece it writes a paragraph, as a model's message between what it does is.
        if (work.kind === "write") await emit(`${work.text}\n\n`);
        else await report({ kind: "read-file", path: work.path });
      }
      const web = framing.webSearch === null ? undefined : scriptedWeb(last);
      for (const activity of web?.activities ?? []) await report(activity);
      for (const [name, scripted] of SCRIPTED_CALLS) {
        if (!framing.tools.some((tool) => tool.name === name)) continue;
        for (const input of scripted(last)) await callTool({ name, input });
      }
      if (hitsLimit.test(last)) {
        return err({
          kind: "rate-limited",
          resetAt: new Date(now() + LIMIT_RESETS_AFTER_MS).toISOString(),
        });
      }
      if (/please fail/i.test(last)) {
        return err({
          kind: "unknown",
          message: "The fake provider failed on purpose, because the message asked it to.",
        });
      }
      if (code !== null) await scriptedHelpers(code, last, signal);
      if (signal.aborted) return ok(null);
      const coded = code === null ? "" : await scriptedCoding(code, last, report);
      const paper = connections.find((connection) => connection.name === "paper");
      const drew = paper === undefined ? "" : await scriptedPaper(paper, last);
      const looked = framing.tools.some((tool) => tool.name === PREVIEW_TOOL_NAME)
        ? await scriptedPreview(last, callTool)
        : "";
      const opened = framing.tools.some((tool) => tool.name === READ_SESSION_TOOL_NAME)
        ? await scriptedSessionReads(last, callTool)
        : "";
      // "wait for more" waits for what the owner adds while it answers (#252).
      if (added !== null && /^wait for more$/im.test(last)) {
        const more = await added.next();
        if (more !== undefined) await noted({ added, taken: [more], emit });
      }
      const saw = /please look/i.test(last) || last === "" ? seen(framing.attachments) : "";
      // A message of only attachments has nothing to echo (#164).
      // A Lead's builder's first message (#590) is answered by asking the owner something, as a
      // builder does that needs them, so it waits on them rather than going Stuck.
      const asks = /^Build issue #/.test(last) ? " Which part should I start with?" : "";
      const said = last === "" ? "" : `You said: ${last}${asks}`;
      for (const word of `${coded}${drew}${looked}${opened}${saw}${said}`
        .trimEnd()
        .split(/(?<= )/)) {
        if (delayMs > 0) await pause(delayMs, signal);
        if (signal.aborted) return ok(null);
        if (added !== null) await noted({ added, taken: added.waiting(), emit });
        await emit(word);
      }
      // One added as it finishes is still answered, in this reply.
      if (added !== null) {
        await noted({ added, taken: added.waiting(), emit });
        added.done();
      }
      if (web !== undefined && web.sources.length > 0) await cite(web.sources);
      return ok(null);
    },

    answerOnce: async ({ purpose, message, signal }) => {
      if (delayMs > 0) await pause(delayMs * 10, signal);
      if (signal.aborted) return err({ kind: "unknown", message: "Stopped." });
      switch (purpose) {
        case "title":
          return scriptedTitle(message);
        case "quick-question":
          return scriptedQuickAnswer(message);
        case "session-note":
          return scriptedNote(message);
      }
    },
  };
};
