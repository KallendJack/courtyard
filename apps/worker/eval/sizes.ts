import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecordSourceKind, RecordUnit, SessionEvent, SizeRecord } from "@courtyard/contract";
import { readSizeText, SIZES_FOLDER, valueText } from "../src/features/fabrication/sizes/index.ts";
import { ALCOVE, ESTATE_SPEC } from "./attachments.ts";
import type { Scenario, Words } from "./scenarios.ts";
import { type Check, hasWords } from "./words.ts";

// Sizes (#708, ADR 0037): a size the owner gives is a record with its source, judged by the
// records saved, not the answer's wording. Everything here is invented: the garage, the car and
// its spec sheet are made up.

/** A standing record the workspace should hold after a turn: what it's of, its value, its source. */
export type ExpectedSize = {
  readonly property: Words;
  readonly amount?: { readonly value: number; readonly unit: RecordUnit };
  /** Its source's kind; a list means any of them is right. */
  readonly source: RecordSourceKind | readonly RecordSourceKind[];
};

/**
 * The sizes a turn should end with: each expected record standing, how many stand in all, and
 * sources no standing record may have (a photo's sizes are never measured).
 */
export type ExpectedSizes = {
  readonly records?: readonly ExpectedSize[];
  readonly count?: number;
  readonly never?: readonly RecordSourceKind[];
};

/** Millimetres in each length unit, so 4.26 m matches 4260 mm. */
const MM: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000 };

const sameAmount = (record: SizeRecord, amount: NonNullable<ExpectedSize["amount"]>) => {
  if (record.value.kind !== "quantity") return false;
  const theirs = MM[record.value.unit];
  const ours = MM[amount.unit];
  return theirs === undefined || ours === undefined
    ? record.value.unit === amount.unit && record.value.value === amount.value
    : Math.abs(record.value.value * theirs - amount.value * ours) < 0.5;
};

/** A record as the report prints it: `floor length 4260 mm, measured`. */
const describe = (record: SizeRecord) =>
  `${record.property} ${valueText(record.value)}, ${record.source.kind}`;

/** The standing records in a workspace's folder, read as the worker reads them. */
const standingIn = async (folder: string) => {
  const names = await readdir(join(folder, SIZES_FOLDER)).catch(() => []);
  const records: SizeRecord[] = [];
  for (const name of names.filter((one) => one.endsWith(".json"))) {
    const read = readSizeText(await readFile(join(folder, SIZES_FOLDER, name), "utf8"));
    if (read.ok && read.value.supersededBy === undefined) records.push(read.value);
  }
  return records;
};

/**
 * A turn's size check: the records it should leave standing, how many, and no source it mustn't
 * use. A measured record's tie to the owner's message is the worker's, so it isn't checked here.
 * Nothing when the turn doesn't say.
 */
export const judgeSizes = async (judge: {
  expected: ExpectedSizes | undefined;
  events: readonly SessionEvent[];
  folder: string;
}): Promise<{ checks: Check[]; notes: string[] }> => {
  const saved = judge.events.flatMap((event) => (event.type === "size-saved" ? [event.save] : []));
  const notes = saved.map(
    (save) =>
      `${save.action === "add" ? "recorded" : "corrected"} size ${save.size.thing}: ${save.size.property} ${save.value}, ${save.source}`,
  );
  const { expected } = judge;
  if (expected === undefined) return { checks: [], notes };
  const standing = await standingIn(judge.folder);
  const listed = standing.map(describe).join("; ") || "none";
  const checks: Check[] = (expected.records ?? []).map((size) => {
    const sources = typeof size.source === "string" ? [size.source] : size.source;
    const found = standing.some(
      (record) =>
        hasWords(record.property, { words: size.property }) &&
        (size.amount === undefined || sameAmount(record, size.amount)) &&
        sources.includes(record.source.kind),
    );
    const amount = size.amount === undefined ? "" : ` ${size.amount.value} ${size.amount.unit}`;
    return {
      miss: found
        ? null
        : `expected a size${amount}, ${sources.join(" or ")}; the sizes standing: ${listed}`,
    };
  });
  if (expected.count !== undefined) {
    checks.push({
      miss:
        standing.length === expected.count
          ? null
          : `expected ${expected.count} sizes standing, not ${standing.length}: ${listed}`,
    });
  }
  const wrong = standing.filter((record) => expected.never?.includes(record.source.kind));
  checks.push({
    miss:
      wrong.length === 0
        ? null
        : `sizes with a source they can't have: ${wrong.map(describe).join("; ")}`,
  });
  return { checks, notes };
};

/** A made-up subject ID for the sizes already recorded in a scenario's files. */
const GARAGE_SUBJECT = "6f1c2a40-0d7e-4b8a-9c11-3a5e2f7d9b01";

/** A made-up garage with no sizes yet, a space Thing of its own. */
const GARAGE: Pick<Scenario, "workspace" | "context" | "files"> = {
  workspace: "Garage",
  context: { facts: ["A single garage, being turned into a workshop"] },
  files: { "things/garage.md": "---\nname: Garage\nstatus: have\nkind: space\n---\n" },
};

/** The garage with its floor length measured already, a made-up record. */
const MEASURED_GARAGE: Pick<Scenario, "workspace" | "context" | "files"> = {
  ...GARAGE,
  files: {
    "things/garage.md": `---\nname: Garage\nstatus: have\nkind: space\nsubject: ${GARAGE_SUBJECT}\n---\n`,
    "sizes/0b9d4c62-5a1e-4f3b-8d27-c4e6a1f0b3d5.json": `${JSON.stringify(
      {
        id: "0b9d4c62-5a1e-4f3b-8d27-c4e6a1f0b3d5",
        subject: GARAGE_SUBJECT,
        property: "floor length",
        value: { kind: "quantity", value: 4260, unit: "mm" },
        source: { kind: "reported" },
        observed: "2026-10-20",
        recorded: "2026-10-20T18:00:00.000Z",
        revision: 1,
      },
      null,
      2,
    )}\n`,
  },
};

export const SIZES: readonly Scenario[] = [
  {
    name: "size-measured-keeps-source",
    rule: "an exact measurement the owner gives is recorded as measured, with its value as given, never as a context line (#708)",
    ...GARAGE,
    turns: [
      {
        say: "I've just measured the garage floor with a tape: 4260 mm long and 2614 mm wide.",
        expect: [],
        sizes: {
          records: [
            {
              property: [["length", "long"]],
              amount: { value: 4260, unit: "mm" },
              source: "measured",
            },
            {
              property: [["width", "wide"]],
              amount: { value: 2614, unit: "mm" },
              source: "measured",
            },
          ],
          count: 2,
        },
      },
    ],
  },
  {
    name: "size-approximate-reported",
    rule: "a size the owner gives roughly is recorded as reported, never measured (#708)",
    ...GARAGE,
    turns: [
      {
        say: "The garage door opening is about 2100 mm wide, I reckon. Haven't measured it yet.",
        expect: [],
        sizes: {
          records: [
            {
              property: [["door", "opening"]],
              amount: { value: 2100, unit: "mm" },
              source: "reported",
            },
          ],
          never: ["measured"],
        },
      },
    ],
  },
  {
    name: "size-photo-no-scale",
    rule: "a photo with nothing of a known size in it gives no size, measured or otherwise (#708)",
    workspace: "House",
    context: { facts: ["A 1930s semi"] },
    files: {
      "things/alcove.md": "---\nname: Alcove by the chimney\nstatus: have\nkind: space\n---\n",
    },
    turns: [
      {
        say: "Here's a photo of the alcove by the chimney. How wide is it? Note it down for the shelves.",
        attach: [ALCOVE],
        expect: [],
        sizes: { count: 0 },
      },
    ],
  },
  {
    name: "size-conflict-kept",
    rule: "a different value for a recorded size is recorded beside it, both kept, and the answer says they differ (#708)",
    ...MEASURED_GARAGE,
    turns: [
      {
        say: "I've measured the garage floor properly now, wall to wall: 5182 mm long.",
        expect: [],
        sizes: {
          records: [
            {
              property: [["length", "long"]],
              amount: { value: 4260, unit: "mm" },
              source: "reported",
            },
            {
              property: [["length", "long"]],
              amount: { value: 5182, unit: "mm" },
              source: "measured",
            },
          ],
          count: 2,
        },
        says: [["4260", "4,260", "4.26"]],
      },
    ],
  },
  {
    name: "size-reused-new-session",
    rule: "a size recorded in one session is used in the next without asking for it again (#708)",
    ...GARAGE,
    turns: [
      {
        say: "I measured the garage's back wall: 2614 mm wide, wall to wall.",
        expect: [],
        sizes: {
          records: [
            {
              property: [["back", "wall", "width", "wide"]],
              amount: { value: 2614, unit: "mm" },
              source: "measured",
            },
          ],
          count: 1,
        },
      },
      {
        newSession: true,
        say: "Will a 1500 mm workbench and a 1000 mm cupboard fit side by side along the garage's back wall?",
        expect: [],
        avoids: [["how", "wide"], ["measure"], ["width"]],
        says: [["2614", "2,614", "2.614", "2.61"]],
        sizes: { count: 1 },
      },
    ],
  },
  {
    name: "size-spec-wrong-model",
    rule: "a spec sheet for another model isn't recorded as the owner's own size, and the answer says it's for another model (#708)",
    workspace: "Car",
    context: { facts: ["The car is a Kestrel K5 hatchback, 2019"] },
    files: {
      "things/kestrel-k5.md":
        "---\nname: Kestrel K5\nstatus: have\nbrand: Kestrel K5 hatchback, 2019\n---\n",
    },
    turns: [
      {
        say: "Here's the spec sheet I found. Put the boot width on my car's sizes, so I know if the dog crate fits.",
        attach: [ESTATE_SPEC],
        expect: [],
        says: [["k7", "estate"]],
        sizes: { never: ["specified", "measured"] },
      },
    ],
  },
  {
    name: "size-code-no-tool",
    rule: "a code session gets no size tool, so a size said there is never recorded (#708)",
    workspace: "Website",
    mode: "code",
    context: { facts: ["A static site built with Astro"] },
    turns: [
      {
        say: "My desk is 1400 mm wide, I measured it this morning. Anyway, which file sets the site's maximum width?",
        expect: [],
        sizes: { count: 0 },
      },
    ],
  },
  {
    name: "fact-in-passing",
    rule: "a fact stated in passing is saved; a size, as a reported size record, not a context line (#708)",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    turns: [
      {
        say: "What squat rack would fit in here? The ceiling's only 2.3 m, by the way.",
        expect: [],
        // Said, not said to be measured: reported (ADR 0037).
        sizes: {
          records: [
            { property: [["ceiling"]], amount: { value: 2.3, unit: "m" }, source: "reported" },
          ],
          never: ["measured"],
        },
      },
    ],
  },
];
