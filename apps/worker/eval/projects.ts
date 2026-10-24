import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nextStepOf, type ProjectSave, type ProjectStep } from "@courtyard/contract";
import { projectPath, readProjectText } from "../src/features/projects/index.ts";
import type { Scenario, Words } from "./scenarios.ts";
import { type Check, describeWords, hasWords } from "./words.ts";

// Projects (#603, #710, ADR 0037): the model keeps a project's steps current, by the saved file:
// a step for a pro, a step marked done when the owner says so, a decision under Decisions and
// never a step. The workshop's `project-steps-current` is with the garage build's scenarios.

/**
 * A project a turn should start or change (#603): words its name has, and words its file should
 * have afterwards, such as who does a step and who to get.
 */
export type ExpectedProject = {
  readonly action: "add" | "change";
  readonly name: Words;
  readonly words: Words;
  /** Words its next step, its first not done, has afterwards (#710). */
  readonly next?: Words;
  /** Words none of its steps has afterwards, such as a decision's pick (#710). */
  readonly noStep?: readonly string[];
};

export const describeProject = (save: ProjectSave) =>
  `${save.action === "add" ? "started" : "changed"} project ${save.project.name}${save.changes.length === 0 ? "" : ` (${save.changes.join("; ")})`}`;

/** A step's words and detail, as the checks read it. */
const stepText = ({ text, detail }: ProjectStep) => `${text} ${detail ?? ""}`;

/** One project's file checked: its words, its next step's, and words no step has. */
const fileChecks = (wanted: ExpectedProject, path: string, text: string): Check[] => {
  const reads = `it reads "${text.replace(/\s+/g, " ").slice(0, 600)}"`;
  const read = readProjectText(text);
  const steps = read.ok ? read.value.steps : [];
  const next = nextStepOf({ steps: [...steps] });
  return [
    {
      miss: hasWords(text, { words: wanted.words })
        ? null
        : `expected ${path} to have ${describeWords(wanted.words)}; ${reads}`,
    },
    ...(wanted.next === undefined
      ? []
      : [
          {
            miss:
              next !== undefined && hasWords(stepText(next), { words: wanted.next })
                ? null
                : `expected ${path}'s next step to have ${describeWords(wanted.next)}; ${reads}`,
          },
        ]),
    ...(wanted.noStep ?? []).map((word) => ({
      miss: steps.some((step) => stepText(step).toLowerCase().includes(word.toLowerCase()))
        ? `expected no step of ${path} to have "${word}"; ${reads}`
        : null,
    })),
  ];
};

/**
 * A turn's project checks (#603): one for each project it should start or change, judged by its
 * file afterwards, and one for saving no other. Nothing when the turn doesn't say.
 */
export const judgeProjects = async (judge: {
  expected: readonly ExpectedProject[] | undefined;
  saved: readonly ProjectSave[];
  /** The workspace's folder, where the projects are. */
  folder: string;
}): Promise<Check[]> => {
  const { expected, saved, folder } = judge;
  if (expected === undefined) return [];
  const left = [...saved];
  const checks: Check[] = [];
  for (const wanted of expected) {
    const matching = left.filter(
      (save) =>
        save.action === wanted.action && hasWords(save.project.name, { words: wanted.name }),
    );
    const save = matching.at(-1);
    if (save === undefined) {
      checks.push({
        miss: `expected to ${wanted.action === "add" ? "start" : "change"} a project with ${describeWords(wanted.name)}; ${saved.length === 0 ? "saved none" : saved.map(describeProject).join("; ")}`,
      });
      continue;
    }
    // Several saves to the same project are one change to it, judged by its file.
    for (const one of matching) left.splice(left.indexOf(one), 1);
    const path = projectPath(save.project.slug);
    const text = await readFile(join(folder, path), "utf8").catch(() => "");
    checks.push(...fileChecks(wanted, path, text));
  }
  checks.push({
    miss: left.length === 0 ? null : `not expected: ${left.map(describeProject).join("; ")}`,
  });
  return checks;
};

/** A made-up garage's office project, as the project scenarios start with it (#603). */
const GARAGE_OFFICE = [
  "---",
  "name: Turn the garage into an office",
  "goal: Storage and a desk for working from home. Budget £200–500.",
  "status: active",
  "---",
  "",
  "## Steps",
  "",
  "- [you can do this] Decide the layout",
  "- [you can do this] Measure the back wall · about 10 minutes, tape measure",
  "- [you can do this] Pick a desk and chair that fit",
  "",
  "## History",
  "",
  "- 2026-10-12: Started",
  "",
].join("\n");

export const PROJECTS: readonly Scenario[] = [
  {
    name: "project-step-done",
    rule: "\"I've done it\" marks the project's step done, kept and ticked, and the next one is next, not a context line (#603, #710)",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    files: {
      "projects/set-up-the-garage-gym.md": [
        "---",
        "name: Set up the garage gym",
        "status: active",
        "---",
        "",
        "## Steps",
        "",
        "- [you can do this] Fit a pull-up bar on the back wall",
        "- [you can do this] Lay rubber mats",
        "",
        "## History",
        "",
        "- 2026-10-12: Started",
        "",
      ].join("\n"),
    },
    turns: [
      {
        say: "Finished fitting the pull-up bar on the back wall yesterday! What should a first pull-up programme look like?",
        expect: [],
        projects: [
          {
            action: "change",
            name: ["gym"],
            words: ["[x] fit a pull-up bar", "done: fit a pull-up bar"],
            next: ["mats"],
          },
        ],
      },
    ],
  },
  {
    name: "project-needs-a-pro",
    rule: "new sockets asked for on a project are a step that needs a pro, with an electrician, never one the owner does (#603)",
    workspace: "Garage",
    context: { facts: ["A single garage, 2.6 m by 5 m", "Has one double socket by the door"] },
    files: { "projects/turn-the-garage-into-an-office.md": GARAGE_OFFICE },
    turns: [
      {
        say: "For the office I'll want a couple of double sockets by the desk at the back. Add that to the project.",
        expect: [],
        projects: [
          {
            action: "change",
            name: ["office"],
            words: ["[who: a pro]", "socket", ["electrician", "electrical"]],
          },
        ],
      },
    ],
  },
  {
    name: "project-decision-why",
    rule: "a decision the owner makes for a project is recorded under Decisions with the pick and why, never as a step, and the step for deciding it is done (#603, #710)",
    workspace: "Garage",
    context: { facts: ["A single garage, 2.6 m by 5 m"] },
    files: { "projects/turn-the-garage-into-an-office.md": GARAGE_OFFICE },
    turns: [
      {
        say: "I've decided on the layout: storage at the front, the desk at the back, because the back is warmer and away from the door.",
        expect: [],
        projects: [
          {
            action: "change",
            name: ["office"],
            words: ["## decisions", "pick:", "why:", ["warm"], ["back"], "[x] decide the layout"],
            noStep: ["storage at the front", "warm"],
          },
        ],
      },
    ],
  },
];
