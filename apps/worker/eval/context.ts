import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  Effort,
  endsTurn,
  ModelId,
  type PlacedLine,
  type Save,
  type SessionId,
  SessionSummary,
  TidyProposal,
  takesEffort,
  type WorkspaceId,
  WorkspaceSummary,
} from "@courtyard/contract";
import { HOUSE_SKILLS_FOLDER, readHouseManifest } from "@courtyard/skills";
import { z } from "zod";
import { OWNER_FILE } from "../src/owner-context/index.ts";
import {
  createClaudeProvider,
  createCodexProvider,
  type Provider,
} from "../src/providers/index.ts";
import {
  asOwner,
  followSession,
  postJson,
  type Requester,
  testWorker,
  writeSkill,
} from "../src/testing.ts";
import { CONTEXT_FILE } from "../src/workspaces/index.ts";
import {
  contextFileFor,
  type ExpectedSave,
  ownerContextFor,
  type Places,
  SCENARIOS,
  type Scenario,
  type ScenarioSkill,
  type Sections,
  type Turn,
  type Words,
} from "./scenarios.ts";

/**
 * The context eval (docs/ai-conduct.md): runs every scenario against a real model, Claude's or
 * Codex's, signed in as the owner on this machine, through a worker on a temporary context folder,
 * and prints the score and each miss. Codex runs in Courtyard's Codex home, in the data folder
 * `COURTYARD_DATA_DIR` names. Never part of CI or `pnpm verify`: it needs the owner's login and
 * uses their plan.
 *
 *   pnpm eval:context [--only <name,name>] [--times <n>] [--parallel <n>] [--model <id>]
 *                     [--effort <level>]
 */

const Options = z.object({
  /** Only the scenarios whose name has one of these in it, separated by commas. */
  only: z.string().optional(),
  /** Runs each scenario this many times, to see which verdicts flip. */
  times: z.coerce.number().int().min(1).default(1),
  /** How many scenarios run at once. */
  parallel: z.coerce.number().int().min(1).default(4),
  /** The model, any provider's, by the id the app offers: Claude's short names, or Codex's. */
  model: ModelId.default(ModelId.parse("default")),
  /** The model's level of effort; its default when left out. Tidies always use the default. */
  effort: Effort.optional(),
});

/** The command line's options, each a string for `Options` to check. */
const argumentNames = {
  only: { type: "string" },
  times: { type: "string" },
  parallel: { type: "string" },
  model: { type: "string" },
  effort: { type: "string" },
} as const;

/**
 * The model each scenario's messages are sent to, the provider offering it (one for every
 * scenario's worker), and the effort they're sent with.
 */
type Choice = {
  readonly provider: Provider;
  readonly model: ModelId;
  readonly effort: Effort | undefined;
};

/** The longest one turn may take before the scenario counts as not run. */
const TURN_TIMEOUT_MINUTES = 5;

/** One thing a turn is checked for, and what went wrong when it failed. */
type Check = { readonly miss: string | null };

/**
 * A scenario's run: judged on its checks, or not run to the end (a failed turn, a usage limit),
 * which leaves it out of the score.
 */
type Verdict =
  | {
      readonly kind: "judged";
      readonly scenario: Scenario;
      readonly checks: readonly Check[];
      /** What each turn did that isn't scored on its own, such as the skills it loaded. */
      readonly notes: readonly string[];
    }
  /** A scenario that only prints what the model did, for the owner to read (`printsTopics`). */
  | { readonly kind: "printed"; readonly scenario: Scenario; readonly notes: readonly string[] }
  | { readonly kind: "not-run"; readonly scenario: Scenario; readonly reason: string };

const passed = (verdict: Verdict) =>
  verdict.kind === "judged" && verdict.checks.every((check) => check.miss === null);

const sectionsOf = (section: Sections) => (typeof section === "string" ? [section] : section);

const anyOf = (word: string | readonly string[]) => (typeof word === "string" ? [word] : word);

/** Whether text has every word (any one of a list) and none of the words it must not. */
const hasWords = (text: string, has: { words: Words; without?: readonly string[] | undefined }) => {
  const lower = text.toLowerCase();
  return (
    has.words.every((word) => anyOf(word).some((either) => lower.includes(either))) &&
    !(has.without ?? []).some((word) => lower.includes(word))
  );
};

const describeWords = (words: Words) => words.map((word) => anyOf(word).join(" or ")).join(", ");

/** The places a save may go: the workspace's context file unless it says. */
const placesOf = (place: Places | undefined) =>
  place === undefined ? ["workspace"] : typeof place === "string" ? [place] : place;

/** Sections, with the place unless it's only the workspace: "owner facts or plans". */
const describeSections = (place: Places | undefined, section: Sections) => {
  const places = placesOf(place);
  if (places.length === 1 && places[0] === "workspace") return sectionsOf(section).join(" or ");
  const named = places.map((p) => (p === "owner" ? "owner context" : p)).join(" or ");
  return `${named} ${sectionsOf(section).join(" or ")}`;
};

const describeExpected = (expected: ExpectedSave) => {
  switch (expected.action) {
    case "add":
      return `add to ${describeSections(expected.place, expected.section)} with ${describeWords(expected.words)}${expected.without ? ` and without ${expected.without.join(", ")}` : ""}`;
    case "change":
      return `change "${expected.was}" to ${describeSections(expected.place, expected.section)} with ${describeWords(expected.words)}`;
    case "remove":
      return `remove "${expected.was}"`;
    case "change-or-remove":
      return `change or remove "${expected.was}"`;
  }
};

const describeLine = (line: PlacedLine) =>
  `${describeSections(line.place, line.section)}: "${line.line}"`;

const describeSave = (save: Save) => {
  switch (save.action) {
    case "add":
      return `added to ${describeLine(save.saved)}`;
    case "change":
      return `changed "${save.replaced.line}" to ${describeLine(save.saved)}`;
    case "remove":
      return `removed "${save.replaced.line}"`;
  }
};

/** Whether a save is the kind expected, on the expected line: the part that must match exactly. */
const sameTarget = (expected: ExpectedSave, save: Save) => {
  switch (expected.action) {
    case "add":
      return save.action === "add";
    case "change":
      return save.action === "change" && save.replaced.line === expected.was;
    case "remove":
      return save.action === "remove" && save.replaced.line === expected.was;
    case "change-or-remove":
      return save.action !== "add" && save.replaced.line === expected.was;
  }
};

/** Whether a save on the right target also has the right section and wording. */
const fullyMatches = (expected: ExpectedSave, save: Save) => {
  if (!sameTarget(expected, save)) return false;
  if (expected.action === "remove" || expected.action === "change-or-remove") return true;
  if (save.action === "remove") return false;
  return (
    placesOf(expected.place).includes(save.saved.place) &&
    sectionsOf(expected.section).includes(save.saved.section) &&
    hasWords(save.saved.line, {
      words: expected.words,
      without: expected.action === "add" ? expected.without : undefined,
    })
  );
};

/**
 * The questions an answer asks, sentence by sentence. An example put as a question ("For
 * example, is it…?"), or the same question put again as its likely answers ("Is it X, Y or Z?",
 * "Or not?"), belongs to the question before it rather than counting as one of its own.
 */
const questionsIn = (answer: string) => {
  const questions: string[] = [];
  for (const sentence of answer.match(/[^.!?\n]*\?/g) ?? []) {
    const last = questions.at(-1);
    const example = /^[\s*_]*(for example|for instance|e\.g\.)/i.test(sentence);
    // The same question put again as its likely answers: "…? Is it X, Y or Z?", "…? Or not?"
    const options = /^[\s*_]*or\b/i.test(sentence) || /,.*\bor\b/i.test(sentence);
    if ((example || options) && last !== undefined) {
      questions[questions.length - 1] = `${last} ${sentence}`;
    } else questions.push(sentence);
  }
  return questions;
};

/** The items of the lists in an answer, such as the topics Get to know plans, in order. */
const listItemsIn = (answer: string) =>
  (answer.match(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+.+$/gm) ?? []).map((item) =>
    item.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/, "").trim(),
  );

/**
 * One turn's checks: one for each expected save, one for saving nothing else, and one for the
 * question the answer should ask. Every exact match is paired up before any near one, so a save
 * that's wrong can't take the place of one that's right.
 */
const judgeTurn = (judge: {
  turn: Turn;
  saves: readonly Save[];
  answer: string;
  /** The skills the model loaded itself in the turn, in order. */
  loaded: readonly string[];
  /** The replies the answer suggested, if any. */
  replies: readonly string[];
  /** What the turn searched for and the pages it read, and the sources listed under it. */
  web: { searched: readonly string[]; read: readonly string[]; sources: readonly string[] };
}): Check[] => {
  const { turn, answer } = judge;
  const left = [...judge.saves];
  const take = (matches: (save: Save) => boolean) => {
    const index = left.findIndex(matches);
    return index === -1 ? undefined : left.splice(index, 1)[0];
  };
  const exact = turn.expect.map((expected) => take((save) => fullyMatches(expected, save)));
  const saveChecks = turn.expect.map((expected, index): Check => {
    if (exact[index] !== undefined) return { miss: null };
    const near = take((save) => sameTarget(expected, save));
    return {
      miss: `expected: ${describeExpected(expected)}; ${near === undefined ? "saved nothing like it" : describeSave(near)}`,
    };
  });
  const nothingElse: Check = {
    miss: left.length === 0 ? null : `not expected: ${left.map(describeSave).join("; ")}`,
  };
  const { asks } = turn;
  const question: Check[] =
    asks === undefined
      ? []
      : [
          {
            miss: questionsIn(answer).some((asked) => hasWords(asked, { words: asks }))
              ? null
              : `expected a question with ${describeWords(asks)}; asked ${questionsIn(answer).join(" ").trim() || "none"}`,
          },
        ];
  const { questions } = turn;
  const asked = questionsIn(answer);
  const howMany: Check[] =
    questions === undefined
      ? []
      : [
          {
            miss:
              asked.length >= questions.atLeast && asked.length <= questions.atMost
                ? null
                : `expected ${questions.atLeast} to ${questions.atMost} questions; asked ${asked.length}: ${asked.join(" ").trim() || `the answer ends "${answer.trim().slice(-160)}"`}`,
          },
        ];
  const { loads } = turn;
  const loadedRight = (wanted: readonly string[]) =>
    [...new Set(judge.loaded)].sort().join(",") === [...wanted].sort().join(",");
  const skills: Check[] =
    loads === undefined
      ? []
      : [
          {
            miss: loadedRight(loads)
              ? null
              : `expected to load ${loads.join(", ") || "no skill"}; loaded ${judge.loaded.join(", ") || "none"}`,
          },
        ];
  const { says } = turn;
  const said: Check[] =
    says === undefined
      ? []
      : [
          {
            miss: hasWords(answer, { words: says })
              ? null
              : `expected the answer to say ${describeWords(says)}; it began ${answer.slice(0, 300).replace(/\s+/g, " ")}`,
          },
        ];
  const { suggests } = turn;
  const suggested = judge.replies.length > 0;
  const replies: Check[] =
    suggests === undefined
      ? []
      : [
          {
            miss:
              suggests === suggested
                ? null
                : suggests
                  ? `expected suggested replies; suggested none after: ${asked.join(" ").trim() || "no question"}`
                  : `expected no suggested replies; suggested ${judge.replies.map((reply) => `"${reply}"`).join(", ")}`,
          },
        ];
  const { searches } = turn;
  const { web } = judge;
  const usedWeb = web.searched.length + web.read.length > 0;
  const searched: Check[] =
    searches === undefined
      ? []
      : [
          {
            miss: searches
              ? !usedWeb
                ? "expected a web search; searched nothing and read no page"
                : web.sources.length === 0
                  ? "searched the web, but listed no sources"
                  : null
              : usedWeb
                ? `expected no web search; searched ${web.searched.map((query) => `"${query}"`).join(", ") || "nothing"}, read ${web.read.join(", ") || "nothing"}`
                : null,
          },
        ];
  const topics = listItemsIn(answer);
  const listed: Check[] =
    turn.listsTopics === undefined
      ? []
      : [
          {
            miss:
              turn.listsTopics === topics.length >= 2
                ? null
                : turn.listsTopics
                  ? `expected a list of topics; the answer starts "${answer.trim().slice(0, 160)}"`
                  : `expected no list of topics; listed ${topics.join("; ")}`,
          },
        ];
  const known = (turn.avoids ?? []).filter((words) =>
    asked.some((one) => hasWords(one, { words })),
  );
  const avoided: Check[] =
    turn.avoids === undefined
      ? []
      : [
          {
            miss:
              known.length === 0
                ? null
                : `asked what's known (${known.map(describeWords).join("; ")}): ${asked.join(" ").trim()}`,
          },
        ];
  return [
    ...saveChecks,
    nothingElse,
    ...question,
    ...howMany,
    ...skills,
    ...said,
    ...replies,
    ...searched,
    ...listed,
    ...avoided,
  ];
};

/**
 * A house skills folder for a scenario with house skills of its own: Courtyard's, with the
 * scenario's beside them in skills.json. `undefined` when it adds none.
 */
const houseFor = async (root: string, skills: readonly ScenarioSkill[]) => {
  const extra = skills.filter((skill) => skill.where === "house");
  if (extra.length === 0) return undefined;
  const folder = join(root, "house");
  const manifest = await readHouseManifest();
  if (!manifest.ok) throw new Error(manifest.error);
  for (const { name } of manifest.value.skills) {
    await cp(join(HOUSE_SKILLS_FOLDER, name), join(folder, name), { recursive: true });
  }
  for (const { name, description, body } of extra) {
    await writeSkill(folder, name, { description, body });
  }
  const entries = extra.map(({ name, start }) => ({
    name,
    workspaces: ["planning", "code"],
    ...(start === undefined ? {} : { start }),
  }));
  await writeFile(
    join(folder, "skills.json"),
    JSON.stringify({ skills: [...manifest.value.skills, ...entries] }),
  );
  return folder;
};

const withTimeout = <T>(work: Promise<T>, what: string) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${what} took over ${TURN_TIMEOUT_MINUTES} minutes`)),
        TURN_TIMEOUT_MINUTES * 60 * 1000,
      ).unref(),
    ),
  ]);

/** Sends the owner's message, starting the session for the first, and returns the session's id. */
const send = async (
  request: Requester,
  to: {
    workspaceId: WorkspaceId;
    sessionId: SessionId | undefined;
    text: string;
    skill: string | undefined;
    choice: Choice;
  },
): Promise<SessionId> => {
  const { provider, model, effort } = to.choice;
  const message = {
    text: to.text,
    model: { provider: provider.id, model },
    ...(effort === undefined ? {} : { effort }),
    ...(to.skill === undefined ? {} : { skill: to.skill }),
  };
  if (to.sessionId === undefined) {
    const started = await postJson(request, `/api/workspaces/${to.workspaceId}/sessions`, message);
    if (started.status !== 201) throw new Error(`starting a session failed (${started.status})`);
    return SessionSummary.parse(await started.json()).id;
  }
  const sent = await postJson(request, `/api/sessions/${to.sessionId}/messages`, message);
  if (sent.status !== 202) throw new Error(`sending a message failed (${sent.status})`);
  return to.sessionId;
};

/**
 * A tidy of the scenario's starting file, saved with every change ticked, judged on the file it
 * leaves: every fact's words still in some line, the lines that should go gone, and shorter.
 */
const judgeTidy = async (judge: {
  request: Requester;
  workspaceId: WorkspaceId;
  file: string;
  tidy: NonNullable<Scenario["tidy"]>;
  choice: Choice;
}): Promise<Check[]> => {
  const { request, workspaceId, file, tidy, choice } = judge;
  const asked = await withTimeout(
    Promise.resolve(
      postJson(request, `/api/workspaces/${workspaceId}/tidy`, {
        model: { provider: choice.provider.id, model: choice.model },
      }),
    ),
    "the tidy",
  );
  // A usage limit shows here as a failed tidy, so a run that hit it isn't read as misses.
  if (asked.status !== 200)
    throw new Error(`the tidy failed (${asked.status}): ${await asked.text()}`);
  const proposal = TidyProposal.parse(await asked.json());
  const keep = proposal.changes.map((_, index) => index);
  const saved = await postJson(request, `/api/tidies/${proposal.id}/save`, { keep });
  if (saved.status !== 204) throw new Error(`saving the tidy failed (${saved.status})`);
  const after = await readFile(file, "utf8");
  const lines = after.split("\n").filter((line) => line.trim().startsWith("- "));

  const kept = tidy.keeps.map(
    (words): Check => ({
      miss: lines.some((line) => hasWords(line, { words }))
        ? null
        : `lost a fact: no line has ${describeWords(words)}`,
    }),
  );
  const gone = tidy.goes.map((line): Check => {
    const either = anyOf(line);
    return {
      miss: either.some((was) => !lines.includes(`- ${was}`))
        ? null
        : `kept ${either.map((was) => `"${was}"`).join(" and ")}`,
    };
  });
  const shorter: Check = {
    miss: after.length < proposal.characters ? null : "the file isn't shorter",
  };
  return [...kept, ...gone, shorter];
};

/** Runs one scenario on a worker of its own, in a temporary folder it removes afterwards. */
const runScenario = async (scenario: Scenario, choice: Choice): Promise<Verdict> => {
  const root = await mkdtemp(join(tmpdir(), "courtyard-eval-"));
  try {
    await mkdir(join(root, "context"));
    const houseSkills = await houseFor(root, scenario.skills ?? []);
    const app = testWorker({
      root,
      providers: [choice.provider],
      ...(houseSkills === undefined ? {} : { houseSkills }),
    });
    const request = await asOwner(app);
    const made = await postJson(request, "/api/workspaces", { name: scenario.workspace });
    if (made.status !== 201) throw new Error(`adding the workspace failed (${made.status})`);
    const workspace = WorkspaceSummary.parse(await made.json());
    const folder = join(root, "context", workspace.id);
    await writeFile(join(folder, CONTEXT_FILE), contextFileFor(scenario));
    const ownerContext = ownerContextFor(scenario);
    if (ownerContext !== undefined) {
      await writeFile(join(root, "context", OWNER_FILE), ownerContext);
    }
    if (scenario.mode === "code") {
      const config = { mode: "code", repoPath: "/path/to/repo" };
      await writeFile(join(folder, "workspace.json"), JSON.stringify(config));
    }
    for (const [path, text] of Object.entries(scenario.files ?? {})) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), text);
    }
    for (const skill of scenario.skills ?? []) {
      if (skill.where === "house") continue;
      const skillsDir =
        skill.where === "workspace"
          ? join(folder, ".agents", "skills")
          : join(root, "context", ".agents", "skills");
      await writeSkill(skillsDir, skill.name, { description: skill.description, body: skill.body });
    }

    if (scenario.tidy !== undefined) {
      const checks = await judgeTidy({
        request,
        workspaceId: workspace.id,
        file: join(folder, CONTEXT_FILE),
        tidy: scenario.tidy,
        choice,
      });
      return { kind: "judged", scenario, checks, notes: [] };
    }

    const checks: Check[] = [];
    const notes: string[] = [];
    let sessionId: SessionId | undefined;
    let after = 0;
    for (const [index, turn] of scenario.turns.entries()) {
      sessionId = await send(request, {
        workspaceId: workspace.id,
        sessionId,
        text: turn.say,
        skill: turn.skill,
        choice,
      });
      const events = await withTimeout(
        followSession(request, { sessionId, after, until: endsTurn }),
        `turn ${index + 1}`,
      );
      after = events.at(-1)?.seq ?? after;
      const ended = events.at(-1);
      if (ended?.type !== "turn-completed") {
        // A usage limit shows here as rate-limited, so a run that hit it isn't read as misses.
        const why = ended?.type === "turn-failed" ? ` (${JSON.stringify(ended.reason)})` : "";
        throw new Error(`turn ${index + 1} ended with ${ended?.type ?? "nothing"}${why}`);
      }
      const saves = events.flatMap((event) =>
        event.type === "context-saved" ? [{ seq: event.seq, save: event.save }] : [],
      );
      const answer = events
        .map((event) => (event.type === "text-delta" ? event.text : ""))
        .join("");
      const prefix = scenario.turns.length === 1 ? "" : `turn ${index + 1}: `;
      const loaded = events.flatMap((event) =>
        event.type === "activity" && event.activity.kind === "skill-loaded"
          ? [event.activity.name]
          : [],
      );
      if (loaded.length > 0) notes.push(`${prefix}loaded ${loaded.join(", ")}`);
      const replies = events.flatMap((event) =>
        event.type === "suggested-replies" ? event.replies : [],
      );
      if (replies.length > 0) {
        notes.push(`${prefix}suggested ${replies.map((reply) => `"${reply}"`).join(", ")}`);
      }
      const web = {
        searched: events.flatMap((event) =>
          event.type === "activity" && event.activity.kind === "web-searched"
            ? [event.activity.query]
            : [],
        ),
        read: events.flatMap((event) =>
          event.type === "activity" && event.activity.kind === "page-read"
            ? [event.activity.url]
            : [],
        ),
        sources: events.flatMap((event) =>
          event.type === "sources"
            ? event.sources.map((source) => `${source.site} · ${source.title} <${source.url}>`)
            : [],
        ),
      };
      if (web.searched.length > 0) {
        notes.push(`${prefix}searched ${web.searched.map((query) => `"${query}"`).join(", ")}`);
      }
      if (web.read.length > 0) notes.push(`${prefix}read ${web.read.join(", ")}`);
      if (web.sources.length > 0) notes.push(`${prefix}sources: ${web.sources.join("; ")}`);
      if (scenario.printsTopics || turn.listsTopics) {
        const topics = listItemsIn(answer);
        notes.push(
          topics.length > 0
            ? `${prefix}topics: ${topics.join(" | ")}`
            : `${prefix}no topics listed; the answer: ${answer.trim().replace(/\s+/g, " ").slice(0, 600)}`,
        );
        notes.push(`${prefix}asked: ${questionsIn(answer).join(" ").trim() || "nothing"}`);
      }
      const judged = judgeTurn({
        turn,
        saves: saves.map(({ save }) => save),
        answer,
        loaded,
        replies,
        web,
      });
      checks.push(...judged.map(({ miss }) => ({ miss: miss === null ? null : prefix + miss })));

      if (turn.undoSaves) {
        for (const { seq } of saves) {
          // The app sends JSON with every change, and the worker refuses one that doesn't.
          const undone = await postJson(
            request,
            `/api/sessions/${sessionId}/saves/${seq}/undo`,
            {},
          );
          if (undone.status !== 204) throw new Error(`undoing a save failed (${undone.status})`);
        }
      }
    }
    if (scenario.printsTopics) return { kind: "printed", scenario, notes };
    return { kind: "judged", scenario, checks, notes };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "not-run", scenario, reason };
  } finally {
    // Git can hold a file open for a moment on Windows; a leftover temporary folder is harmless.
    await rm(root, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
};

/** Runs `jobs` with at most `limit` at once, keeping their order. */
const pool = async <T>(jobs: readonly (() => Promise<T>)[], limit: number) => {
  const results: T[] = [];
  let next = 0;
  const runNext = async () => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      if (job) results[index] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, runNext));
  return results;
};

const report = (verdict: Verdict) => {
  if (verdict.kind === "not-run") {
    console.log(`----  ${verdict.scenario.name}: didn't run to the end: ${verdict.reason}`);
    return;
  }
  if (verdict.kind === "printed") {
    console.log(`info  ${verdict.scenario.name} (not scored)`);
    for (const note of verdict.notes) console.log(`      ${note}`);
    return;
  }
  console.log(`${passed(verdict) ? "pass" : "MISS"}  ${verdict.scenario.name}`);
  for (const { miss } of verdict.checks) if (miss !== null) console.log(`      ${miss}`);
  for (const note of verdict.notes) console.log(`      (${note})`);
};

const summarise = (scenarios: readonly Scenario[], verdicts: readonly Verdict[]) => {
  const judged = verdicts.filter((v) => v.kind === "judged");
  const checks = judged.flatMap((v) => v.checks);
  const passedChecks = checks.filter((check) => check.miss === null).length;
  console.log(
    `\nScore: ${judged.filter(passed).length}/${judged.length} scenario runs passed, ${passedChecks}/${checks.length} checks.`,
  );

  const runsOf = (scenario: Scenario) => judged.filter((v) => v.scenario === scenario);
  const missed = scenarios.filter((s) => runsOf(s).some((v) => !passed(v)));
  if (missed.length > 0) {
    console.log("\nMissed:");
    for (const scenario of missed) {
      const runs = runsOf(scenario);
      const passes = runs.filter(passed).length;
      const flips = passes > 0 ? ` (flips: passed ${passes} of ${runs.length})` : "";
      console.log(`- ${scenario.name}: ${scenario.rule}${flips}`);
    }
  }
  const notRun = verdicts.filter((v) => v.kind === "not-run");
  if (notRun.length > 0) {
    console.log(
      `\nNot counted: ${notRun.length} runs didn't run to the end. Run them again later.`,
    );
  }
};

const main = async () => {
  const parsed = Options.safeParse(parseArgs({ options: argumentNames }).values);
  if (!parsed.success) {
    console.error(`Those options don't work: ${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  const options = parsed.data;
  // Codex only with a data folder to find Courtyard's Codex home in, as the worker finds it.
  const dataDir = process.env.COURTYARD_DATA_DIR;
  const providers = [
    createClaudeProvider(),
    ...(dataDir ? [createCodexProvider({ dataDir: resolve(dataDir) })] : []),
  ];
  const statuses = await Promise.all(providers.map((provider) => provider.status()));
  for (const status of statuses) {
    if (!status.available) console.error(`${status.label} isn't available: ${status.reason}`);
  }
  const offered = statuses.flatMap((status) => (status.available ? status.models : []));
  const [offer] = providers.flatMap((provider, index) => {
    const status = statuses[index];
    const model = status?.available ? status.models.find((m) => m.id === options.model) : undefined;
    return model === undefined ? [] : [{ provider, model }];
  });
  if (offer === undefined) {
    console.error(
      `No model "${options.model}". Try one of: ${offered.map((m) => m.id).join(", ")}${dataDir ? "" : ". For Codex's, set COURTYARD_DATA_DIR to the data folder holding Courtyard's Codex home"}`,
    );
    process.exit(1);
  }
  const { provider, model } = offer;
  const { effort } = options;
  if (!takesEffort(model, effort)) {
    const levels = model.efforts.map((level) => level.id).join(", ") || "none";
    console.error(`"${model.id}" doesn't take effort "${effort}". It takes: ${levels}`);
    process.exit(1);
  }

  const { only } = options;
  const scenarios = SCENARIOS.filter(
    (s) => only === undefined || only.split(",").some((part) => s.name.includes(part.trim())),
  );
  console.log(
    `Running ${scenarios.length} scenarios${options.times > 1 ? `, ${options.times} times each` : ""}, against ${model.label}${effort === undefined ? "" : ` (${effort} effort)`}…\n`,
  );

  const jobs = scenarios.flatMap((scenario) =>
    Array.from({ length: options.times }, () => async () => {
      const verdict = await runScenario(scenario, { provider, model: model.id, effort });
      report(verdict);
      return verdict;
    }),
  );
  summarise(scenarios, await pool(jobs, options.parallel));
  // Claude Code can leave a process behind for a moment, and Codex's app-server keeps running
  // until the worker's process ends; the eval is done.
  process.exit(0);
};

await main();
