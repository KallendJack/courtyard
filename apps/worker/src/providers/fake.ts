import { exec } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  type Capabilities,
  Effort,
  type FailureReason,
  ModelId,
  ProviderId,
  type SignInState,
} from "@courtyard/contract";
import { writeTextFileIn } from "../files.ts";
import {
  DOCUMENT_TOOL_NAME,
  SAVE_TOOL_NAME,
  SUGGEST_REPLIES_TOOL_NAME,
  THING_TOOL_NAME,
  USE_SKILL_TOOL_NAME,
} from "../prompts/index.ts";
import { err, ok, type Result } from "../result.ts";
import { pageRead, turnSources } from "../sources/index.ts";
import type {
  Activity,
  CodeTurn,
  FramedAttachment,
  Provider,
  SignIn,
  TurnToolName,
} from "./index.ts";

/** The fake reads nothing; it echoes, and saves and codes when a message scripts it. */
const CAPABILITIES: Capabilities = {
  readsFiles: false,
  codes: true,
  usesTools: false,
  savesContext: true,
  searchesWeb: true,
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

/** The workspace's files a message scripts reading, one per line: "read file: docs/notes.md". */
const scriptedReads = (message: string) =>
  message.split("\n").flatMap((line) => {
    const [, path] = READ_FILE.exec(line.trim()) ?? [];
    return path === undefined ? [] : [path];
  });

const THING = /^thing (\S+?): *(.*)$/i;
const THING_FIELD =
  /^(name|status|brand|bought|price|condition|size|where|part of|history|photo|remove)\b *(.*)$/i;

/**
 * The Thing saves a message scripts (ADR 0020), one per line: "thing add: name Tyres | status
 * have | part of T1" adds one, and "thing T2: history Swapped | price £32", "thing T2: photo 1" or
 * "thing T2: remove" changes or removes the Thing labelled T2. Each field is its name, then its
 * value; an empty value clears it.
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
      input[key] = key === "remove" ? true : key === "photo" ? Number(value) : value.trim();
    }
    return [input];
  });

/**
 * The calls a message scripts to each of Courtyard's tools, in the order the fake makes them:
 * skills loaded first, then saves, documents and Things, then suggested replies.
 */
const SCRIPTED_CALLS: readonly (readonly [TurnToolName, (message: string) => unknown[]])[] = [
  [USE_SKILL_TOOL_NAME, scriptedSkillLoads],
  [SAVE_TOOL_NAME, scriptedSaves],
  [DOCUMENT_TOOL_NAME, scriptedDocuments],
  [THING_TOOL_NAME, scriptedThings],
  [SUGGEST_REPLIES_TOOL_NAME, scriptedReplies],
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

/** A labelled line as a model reads it: `- [F2] The ceiling is 2.3 m`. */
const LABELLED = /\[([A-Z]+)(\d+)\] (.+)$/;

/**
 * The tidy a file scripts, by markers at the end of its lines: "(stale)" is removed, "(long)" is
 * shortened to the line without the marker, the lines of a section ending "(merge)" are merged
 * into one, and "(adds)" is shortened to "A sauna", a change that adds something new.
 */
const scriptedTidy = (message: string) => {
  const changes: Record<string, unknown>[] = [];
  const merging = new Map<string, { labels: string[]; texts: string[] }>();
  for (const line of message.split("\n")) {
    const [, letters, number, text] = LABELLED.exec(line.trim()) ?? [];
    if (letters === undefined || text === undefined) continue;
    const label = `${letters}${number}`;
    const marked = /^(.*) \((stale|long|merge|adds)\)$/.exec(text);
    const [, words = text, marker] = marked ?? [];
    if (marker === "stale") changes.push({ kind: "remove", labels: [label], why: "It's stale." });
    if (marker === "long") changes.push({ kind: "shorten", labels: [label], text: words });
    if (marker === "adds") changes.push({ kind: "shorten", labels: [label], text: "A sauna" });
    if (marker === "merge") {
      const merge = merging.get(letters) ?? { labels: [], texts: [] };
      merge.labels.push(label);
      merge.texts.push(words);
      merging.set(letters, merge);
    }
  }
  for (const { labels, texts } of merging.values()) {
    if (labels.length > 1) changes.push({ kind: "merge", labels, text: texts.join(", ") });
  }
  return { changes };
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
const runIn = (code: CodeTurn, command: string) =>
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
 * (for: To check which git runs here)". Says how each went, or why it was refused.
 */
const scriptedCoding = async (code: CodeTurn, message: string) => {
  let said = "";
  for (const line of message.split("\n").map((each) => each.trim())) {
    const [, path, text] = EDIT_FILE.exec(line) ?? [];
    const [, command, why] = RUN_COMMAND.exec(line) ?? [];
    if (path !== undefined && text !== undefined) {
      const allowed = await code.edit(path);
      if (!allowed.ok) said += `Couldn't edit ${path}: ${allowed.error} `;
      else await writeTextFileIn(resolve(code.worktree, path), `${text}\n`);
    } else if (command !== undefined) {
      const allowed = await code.run(command, why);
      said += allowed.ok
        ? await runIn(code, command)
        : `Couldn't run ${command}: ${allowed.error} `;
    }
  }
  return said;
};

/** How long after a pretend usage limit the fake says it resets. */
const LIMIT_RESETS_AFTER_MS = 2 * 60 * 60 * 1000;

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
 * any "read file: …" it acts out reading (see `scriptedReads`), and "thing add: …" or "thing T2:
 * …" saves a Thing (see `scriptedThings`) when it offers the Things tool. On a turn with web search, "search the
 * web for: …", "read page: …" and "cite: …" act out a search (see `scriptedWeb`). A tidy follows markers in the file
 * (see `scriptedTidy`), and a session's title its first message (see `scriptedTitle`). "please hit
 * Fake's limit" (or "Fake two's", for the second fake) acts out a usage limit that resets two
 * hours on, so overflow can be seen and tested. "please look" says which attachments it was given
 * (see `seen`). In a code session, "edit file …" and "run command: …" edit and run, as the worker
 * allows (see `scriptedCoding`); Fake two doesn't code.
 */
export const createFakeProvider = (
  options: {
    /** Pause between words, so streaming is visible. */
    delayMs?: number;
    /** Awaited before answering; tests use it to hold a turn open. */
    beforeReply?: (signal: AbortSignal) => Promise<void>;
    /** Told the model and effort of each turn, so tests can see what reached the model. */
    heard?: (turn: { model: ModelId; effort: Effort | undefined }) => void;
    /** A pretend sign-in, starting signed out (see `fakeSignIn`). The fake answers either way. */
    signIn?: { finishAfterMs?: number };
    /** The second fake, "Fake two", so there's another provider to carry on with. */
    second?: boolean;
    /** The clock its pretend usage limit's reset time is set by. */
    now?: () => number;
  } = {},
): Provider => {
  const delayMs = options.delayMs ?? 40;
  const now = options.now ?? Date.now;
  const id = ProviderId.parse(options.second ? "fake-two" : "fake");
  const label = options.second ? "Fake two" : "Fake";
  const hitsLimit = new RegExp(`please hit ${label}'s limit`, "i");
  // Fake two doesn't code, so a model that can't is there to be refused in a code workspace.
  const capabilities = options.second ? { ...CAPABILITIES, codes: false } : CAPABILITIES;

  return {
    id,
    capabilities,
    ...(options.signIn === undefined ? {} : { signIn: fakeSignIn(options.signIn) }),
    status: async () => ({
      id,
      label,
      available: true,
      models: [
        {
          id: ModelId.parse("echo"),
          label: `${label} (echoes you)`,
          efforts: EFFORTS,
          defaultEffort: Effort.parse("medium"),
        },
      ],
      capabilities,
    }),

    runTurn: async ({ model, effort, framing, code, emit, report, cite, callTool, signal }) => {
      options.heard?.({ model, effort });
      await options.beforeReply?.(signal);
      if (signal.aborted) return ok(null);
      const last = framing.newMessage;
      if (/please read/i.test(last)) await report({ kind: "read-file", path: "CONTEXT.md" });
      for (const path of scriptedReads(last)) await report({ kind: "read-file", path });
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
      const coded = code === null ? "" : await scriptedCoding(code, last);
      const saw = /please look/i.test(last) ? seen(framing.attachments) : "";
      for (const word of `${coded}${saw}You said: ${last}`.split(/(?<= )/)) {
        if (delayMs > 0) await pause(delayMs, signal);
        if (signal.aborted) return ok(null);
        await emit(word);
      }
      if (web !== undefined && web.sources.length > 0) await cite(web.sources);
      return ok(null);
    },

    answerOnce: async ({ purpose, message, signal }) => {
      if (delayMs > 0) await pause(delayMs * 10, signal);
      if (signal.aborted) return err({ kind: "unknown", message: "Stopped." });
      switch (purpose) {
        case "tidy":
          return ok(scriptedTidy(message));
        case "title":
          return scriptedTitle(message);
      }
    },
  };
};
