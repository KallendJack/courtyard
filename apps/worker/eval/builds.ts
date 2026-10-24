import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuildSave, SessionEvent } from "@courtyard/contract";
import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import { buildPath, readBuildText } from "../src/features/fabrication/index.ts";
import type { Scenario, Words } from "./scenarios.ts";

// Builds (#697, ADR 0036): asked for something to make, the model uses the Build tool, and every
// number in its answer is one the saved Build derives, never one it worked out. Judged by the saved
// Build, not the answer's wording. Everything here is invented: the shops, prices and links are
// the golden bench's made-up ones.

/**
 * A Build a turn should start or change: words its name has, parameters it should have afterwards
 * by their path (`height.value`), and the only parameters that may differ from the file it started
 * from, by their first key.
 */
export type ExpectedBuild = {
  readonly action: "add" | "change";
  readonly name: Words;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly changesOnly?: readonly string[];
};

type Check = { readonly miss: string | null };

/** Every number in a JSON value, as the Build's file and what it derives hold them. */
const numbersIn = (value: unknown): number[] =>
  typeof value === "number"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(numbersIn)
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(numbersIn)
        : [];

/** Every number written in a text, "1,500" read as 1500. */
const numbersWritten = (text: string) =>
  [...text.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)].map(([n]) => Number(n));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A parameter by its path, `height.value`. */
const at = (value: unknown, path: string) =>
  path.split(".").reduce<unknown>((into, key) => (isRecord(into) ? into[key] : undefined), value);

/**
 * A turn's Build check: the Build it should start or change, saved and worked out as expected, and
 * every number of 10 or more in its answer one the Build gives (in mm, cm or m, or pounds), or the
 * owner said. Nothing when the turn doesn't say.
 */
export const judgeBuilds = async (judge: {
  /** The scenario, and which of its turns this is. */
  scenario: Scenario;
  index: number;
  events: readonly SessionEvent[];
  answer: string;
  /** The workspace's folder, where the Builds are. */
  folder: string;
}): Promise<{ checks: Check[]; notes: string[] }> => {
  const { scenario, index, events, answer, folder } = judge;
  const expected = scenario.turns[index]?.builds;
  const said = scenario.turns.slice(0, index + 1).map(({ say }) => say);
  const saves = events.flatMap((event): BuildSave[] =>
    event.type === "build-saved" ? [event.save] : [],
  );
  const notes = saves.map(
    (save) =>
      `${save.action === "add" ? "started" : "changed"} Build ${save.build.name}${save.changes.length === 0 ? "" : ` (${save.changes.join("; ")})`}`,
  );
  if (expected === undefined) return { checks: [], notes };
  const lower = (text: string) => text.toLowerCase();
  const save = saves.findLast(
    (one) =>
      one.action === expected.action &&
      expected.name.every((word) =>
        (typeof word === "string" ? [word] : word).some((w) => lower(one.build.name).includes(w)),
      ),
  );
  if (save === undefined) {
    return {
      checks: [
        {
          miss: `expected to ${expected.action === "add" ? "start" : "change"} a Build; ${notes.join("; ") || "saved none"}`,
        },
      ],
      notes,
    };
  }
  const path = buildPath(save.build.slug);
  const read = readBuildText(await readFile(join(folder, path), "utf8").catch(() => ""));
  if (!read.ok) return { checks: [{ miss: `${path} can't be read: ${read.error}` }], notes };
  const { file, derived } = read.value;
  const checks: Check[] = Object.entries(expected.parameters ?? {}).map(([where, value]) => ({
    miss:
      JSON.stringify(at(file.parameters, where)) === JSON.stringify(value)
        ? null
        : `expected ${where} to be ${JSON.stringify(value)}, not ${JSON.stringify(at(file.parameters, where))}`,
  }));
  const before = scenario.files?.[path];
  if (expected.changesOnly !== undefined && before !== undefined) {
    const was = readBuildText(before);
    const changed = was.ok
      ? Object.keys(file.parameters).filter(
          (key) =>
            JSON.stringify(file.parameters[key]) !== JSON.stringify(was.value.file.parameters[key]),
        )
      : [];
    const others = changed.filter((key) => !expected.changesOnly?.includes(key));
    checks.push({ miss: others.length === 0 ? null : `changed ${others.join(", ")} too` });
  }
  const given = [...numbersIn(derived), ...numbersIn(file.parameters)];
  const allowed = [
    ...given.flatMap((n) => [n, n / 10, n / 100, n / 1000]),
    ...said.flatMap(numbersWritten),
  ];
  const stray = numbersWritten(answer).filter(
    (n) => n >= 10 && !allowed.some((one) => Math.abs(one - n) < 0.006),
  );
  checks.push({
    miss:
      stray.length === 0
        ? null
        : `the answer gives numbers the Build doesn't: ${[...new Set(stray)].join(", ")}`,
  });
  return { checks, notes };
};

/** A made-up garage workshop with no Build yet, its tools listed in its facts. */
const WORKSHOP: Pick<Scenario, "workspace" | "context"> = {
  workspace: "Workshop",
  context: {
    facts: [
      "A single garage, used as a workshop",
      "Has a tape measure, pencil, square, hand saw, folding workbench, clamps, drill driver and bits, and safety glasses",
    ],
  },
};

/** The workshop with its workbench as a Build already, the golden bench's made-up values. */
const WITH_BENCH: Pick<Scenario, "workspace" | "context" | "files"> = {
  ...WORKSHOP,
  files: {
    "builds/workbench.json": `${JSON.stringify(
      { name: "Workbench", template: "framed-bench", parameters: goldenBench },
      null,
      2,
    )}\n`,
  },
};

export const BUILDS: readonly Scenario[] = [
  {
    name: "build-bench-numbers",
    rule: "asked for a bench, the model makes it a Build with the tool, and every number in its answer is one the saved Build derives (#697)",
    ...WORKSHOP,
    turns: [
      {
        say: [
          "Let's make the workbench. Top 1500 × 600 mm, 900 mm to the top, all measured.",
          "Frame and legs from 45 × 95 C16 in 2400 mm lengths, £6.80 each at Woodstore; the middle support from 45 × 145 C16, 2400 mm, £12.00.",
          "Top, shelf and braces from 18 mm plywood, 2440 × 1220 sheets, £50.00 a sheet at Panel Cutters. 25 mm overhang, shelf 250 mm up, a rear brace and end braces. No castors.",
          "5 × 80 screws for the frame (£5.20 for 100), 4 × 40 for the sheets (£4.20 for 200), 40 mm angle brackets at 89p each. My saw's cut is 3 mm.",
          "What do I need to buy, and what's the total?",
        ].join("\n"),
        expect: [],
        builds: { action: "add", name: [["bench"]] },
      },
    ],
  },
  {
    name: "build-change-one-size",
    rule: "asked to change one size, the model changes that parameter and lets the Build work the lengths out, writing none of its own (#697)",
    ...WITH_BENCH,
    turns: [
      {
        say: "Make the workbench 50 mm lower: I measured again, 850 mm to the top is right. What changes in the cut list?",
        expect: [],
        builds: {
          action: "change",
          name: [["bench"]],
          parameters: { "height.value": 850, "height.source.kind": "measured" },
          changesOnly: ["height"],
        },
      },
    ],
  },
];
