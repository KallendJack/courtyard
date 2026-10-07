import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  type ContextSection,
  endsTurn,
  type Save,
  SessionSummary,
  WorkspaceSummary,
} from "@courtyard/contract";
import { createClaudeProvider } from "../src/providers/index.ts";
import { asOwner, followSession, postJson, type Requester, testWorker } from "../src/testing.ts";
import { CONTEXT_FILE } from "../src/workspaces/index.ts";
import {
  contextFileFor,
  type ExpectedSave,
  SCENARIOS,
  type Scenario,
  type Turn,
} from "./scenarios.ts";

/**
 * The context eval (docs/ai-conduct.md): runs every scenario against real Claude, signed in as the
 * owner on this machine, through a worker on a temporary context folder, and prints the score and
 * each miss. Never part of CI or `pnpm verify`: it needs the owner's login and uses their plan.
 *
 *   pnpm eval:context [--only <name,name>] [--times <n>] [--parallel <n>] [--model <id>]
 */

const { values: options } = parseArgs({
  options: {
    /** Only the scenarios whose name has one of these in it, separated by commas. */
    only: { type: "string" },
    /** Runs each scenario this many times, to see which verdicts flip. */
    times: { type: "string", default: "1" },
    /** How many scenarios run at once. */
    parallel: { type: "string", default: "4" },
    /** The Claude model, by the short name the app offers. */
    model: { type: "string", default: "default" },
  },
});

/** The longest one turn may take before the scenario counts as not run. */
const TURN_TIMEOUT_MS = 5 * 60 * 1000;

type Verdict = {
  readonly scenario: Scenario;
  /** What went wrong, in words: empty when the scenario passed. */
  readonly misses: readonly string[];
  readonly checks: number;
  readonly passedChecks: number;
};

const sectionsOf = (section: ContextSection | readonly ContextSection[]) =>
  typeof section === "string" ? [section] : section;

/** Whether a line has every word (`a|b` for either) and none of the words it must not. */
const hasWords = (line: string, words: readonly string[], without: readonly string[] = []) => {
  const lower = line.toLowerCase();
  return (
    words.every((word) => word.split("|").some((either) => lower.includes(either))) &&
    !without.some((word) => lower.includes(word))
  );
};

const describeExpected = (expected: ExpectedSave) => {
  switch (expected.action) {
    case "add":
      return `add to ${sectionsOf(expected.section).join(" or ")} with ${expected.words.join(", ")}${expected.without ? ` and without ${expected.without.join(", ")}` : ""}`;
    case "change":
      return `change "${expected.was}" in ${sectionsOf(expected.section).join(" or ")} with ${expected.words.join(", ")}`;
    case "remove":
      return `remove "${expected.was}"`;
    case "change-or-remove":
      return `change or remove "${expected.was}"`;
  }
};

const describeSave = (save: Save) => {
  switch (save.action) {
    case "add":
      return `added to ${save.saved.section}: "${save.saved.line}"`;
    case "change":
      return `changed "${save.replaced.line}" to ${save.saved.section}: "${save.saved.line}"`;
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
    sectionsOf(expected.section).includes(save.saved.section) &&
    hasWords(save.saved.line, expected.words, expected.action === "add" ? expected.without : [])
  );
};

/**
 * One turn's misses: each expected save matched to one the turn made (an exact match first), each
 * save left over, and a question the answer should have asked. A check is each expected save, the
 * turn saving nothing else, and the question.
 */
const judgeTurn = (turn: Turn, saves: readonly Save[], answer: string) => {
  const misses: string[] = [];
  const left = [...saves];
  for (const expected of turn.expect) {
    const exact = left.findIndex((save) => fullyMatches(expected, save));
    const near = exact === -1 ? left.findIndex((save) => sameTarget(expected, save)) : exact;
    const [found] = near === -1 ? [] : left.splice(near, 1);
    if (found === undefined)
      misses.push(`expected: ${describeExpected(expected)}; saved nothing like it`);
    else if (exact === -1)
      misses.push(`expected: ${describeExpected(expected)}; ${describeSave(found)}`);
  }
  for (const extra of left) misses.push(`not expected: ${describeSave(extra)}`);
  if (turn.asks && !answer.includes("?"))
    misses.push("expected a question in the answer; it asked none");
  const checks = turn.expect.length + 1 + (turn.asks ? 1 : 0);
  return { misses, checks };
};

const withTimeout = <T>(work: Promise<T>, what: string) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} took over 5 minutes`)), TURN_TIMEOUT_MS).unref(),
    ),
  ]);

/** Sends the owner's message, starting the session for the first, and returns the session's id. */
const send = async (
  request: Requester,
  to: { workspaceId: string; sessionId: string | undefined; text: string },
) => {
  const message = { text: to.text, model: { provider: "claude", model: options.model } };
  if (to.sessionId === undefined) {
    const started = await postJson(request, `/api/workspaces/${to.workspaceId}/sessions`, message);
    if (started.status !== 201) throw new Error(`starting a session failed (${started.status})`);
    return SessionSummary.parse(await started.json()).id;
  }
  const sent = await postJson(request, `/api/sessions/${to.sessionId}/messages`, message);
  if (sent.status !== 202) throw new Error(`sending a message failed (${sent.status})`);
  return to.sessionId;
};

/** Runs one scenario on a worker of its own, in a temporary folder it removes afterwards. */
const runScenario = async (scenario: Scenario): Promise<Verdict> => {
  const root = await mkdtemp(join(tmpdir(), "courtyard-eval-"));
  try {
    await mkdir(join(root, "context"));
    const app = testWorker({ root, providers: [createClaudeProvider()] });
    const request = await asOwner(app);
    const made = await postJson(request, "/api/workspaces", { name: scenario.workspace });
    if (made.status !== 201) throw new Error(`adding the workspace failed (${made.status})`);
    const workspace = WorkspaceSummary.parse(await made.json());
    const folder = join(root, "context", workspace.id);
    await writeFile(join(folder, CONTEXT_FILE), contextFileFor(scenario));
    for (const [path, text] of Object.entries(scenario.files ?? {})) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), text);
    }

    const misses: string[] = [];
    let checks = 0;
    let passedChecks = 0;
    let sessionId: string | undefined;
    let after = 0;
    for (const [index, turn] of scenario.turns.entries()) {
      sessionId = await send(request, { workspaceId: workspace.id, sessionId, text: turn.say });
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
      const judged = judgeTurn(
        turn,
        saves.map(({ save }) => save),
        answer,
      );
      const prefix = scenario.turns.length === 1 ? "" : `turn ${index + 1}: `;
      misses.push(...judged.misses.map((miss) => prefix + miss));
      checks += judged.checks;
      passedChecks += Math.max(0, judged.checks - judged.misses.length);

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
    return { scenario, misses, checks, passedChecks };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const checks = scenario.turns.reduce((sum, turn) => sum + turn.expect.length + 1, 0);
    return { scenario, misses: [`didn't run: ${message}`], checks, passedChecks: 0 };
  } finally {
    // Git can hold a file open for a moment on Windows; a leftover temporary folder is harmless.
    await rm(root, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
};

/** Runs `jobs` with at most `limit` at once, keeping their order. */
const pool = async <T>(jobs: readonly (() => Promise<T>)[], limit: number) => {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      if (job) results[index] = await job();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
};

const main = async () => {
  const status = await createClaudeProvider().status();
  if (!status.available) {
    console.error(`Claude isn't available: ${status.reason}`);
    process.exit(1);
  }
  if (!status.models.some((model) => model.id === options.model)) {
    console.error(
      `No Claude model "${options.model}". Try one of: ${status.models.map((m) => m.id).join(", ")}`,
    );
    process.exit(1);
  }

  const scenarios = SCENARIOS.filter(
    (s) =>
      options.only === undefined ||
      options.only.split(",").some((part) => s.name.includes(part.trim())),
  );
  const times = Math.max(1, Number.parseInt(options.times, 10) || 1);
  const parallel = Math.max(1, Number.parseInt(options.parallel, 10) || 1);
  console.log(
    `Running ${scenarios.length} scenarios${times > 1 ? `, ${times} times each` : ""}, against Claude (${options.model})…\n`,
  );

  const jobs = scenarios.flatMap((scenario) =>
    Array.from({ length: times }, () => async () => {
      const verdict = await runScenario(scenario);
      console.log(`${verdict.misses.length === 0 ? "pass" : "MISS"}  ${scenario.name}`);
      for (const miss of verdict.misses) console.log(`      ${miss}`);
      return verdict;
    }),
  );
  const verdicts = await pool(jobs, parallel);

  const passed = verdicts.filter((v) => v.misses.length === 0).length;
  const checks = verdicts.reduce((sum, v) => sum + v.checks, 0);
  const passedChecks = verdicts.reduce((sum, v) => sum + v.passedChecks, 0);
  console.log(
    `\nScore: ${passed}/${verdicts.length} scenarios passed, ${passedChecks}/${checks} checks.`,
  );

  const missed = scenarios.filter((s) =>
    verdicts.some((v) => v.scenario === s && v.misses.length > 0),
  );
  if (missed.length > 0) {
    console.log("\nMissed:");
    for (const scenario of missed) {
      const runs = verdicts.filter((v) => v.scenario === scenario);
      const passes = runs.filter((v) => v.misses.length === 0).length;
      const flipped = passes > 0 ? ` (flips: passed ${passes} of ${runs.length})` : "";
      console.log(`- ${scenario.name}: ${scenario.checks}${flipped}`);
    }
  }
  // Claude Code can leave a process behind for a moment; the eval is done.
  process.exit(0);
};

await main();
