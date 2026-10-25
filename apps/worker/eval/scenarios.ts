import type { OwnerSection, PlacedLine, ThingDetailName } from "@courtyard/contract";
import type { TestFile } from "../test/testing.ts";
import { BROCHURE_PLAN, LANDSCAPE, RACK_MANUAL } from "./attachments.ts";
import { BUILDS, type ExpectedBuild } from "./builds.ts";
import { GARAGE_BUILD } from "./garage-build.ts";
import { PLANNING } from "./planning.ts";
import { type ExpectedProject, PROJECTS } from "./projects.ts";
import { REPLIES } from "./replies.ts";
import { type ExpectedSizes, SIZES } from "./sizes.ts";
import { TOOLS } from "./tools.ts";

/**
 * The context eval's scenarios (docs/ai-conduct.md, Saving context lines): short conversations
 * with a starting context file (and owner context), and the saves each owner message should end
 * with. Everything here is invented, since the repo is public: a made-up owner and workspaces.
 */

/** Words a line must have, each lowercase: a list in place of a word means any one of them. */
export type Words = readonly (string | readonly string[])[];

/**
 * Where a saved line belongs: a list means any of those sections is right. `answers` is How to
 * answer me, in the owner context.
 */
export type Sections = OwnerSection | readonly OwnerSection[];

/**
 * Where a saved line belongs: the workspace's context file unless it says the owner context, and a
 * list means either is right.
 */
export type Places = PlacedLine["place"] | readonly PlacedLine["place"][];

/** A save a turn should make. */
export type ExpectedSave =
  | {
      readonly action: "add";
      readonly place?: Places;
      readonly section: Sections;
      readonly words: Words;
      /** Words the line must not have, such as a date where time doesn't matter. */
      readonly without?: readonly string[];
    }
  | {
      readonly action: "change";
      /** The line it changes, as the starting context file has it. */
      readonly was: string;
      /** Where the changed line ends up. */
      readonly place?: Places;
      readonly section: Sections;
      readonly words: Words;
    }
  | { readonly action: "remove"; readonly was: string }
  /** A stale line goes, whether it's removed or changed to what's true now. */
  | { readonly action: "change-or-remove"; readonly was: string };

export type Turn = {
  /** What the owner says. */
  readonly say: string;
  /**
   * It starts a new session in the workspace, as the owner coming back another day (#601), so
   * the session before it leaves its note; otherwise it carries on the scenario's session.
   */
  readonly newSession?: true;
  /** The saves this message should end with; none means it saves nothing. */
  readonly expect: readonly ExpectedSave[];
  /** The answer should ask the owner something rather than guess: a question with these words. */
  readonly asks?: Words;
  /** How many questions the answer should ask, at least and at most. */
  readonly questions?: { readonly atLeast: number; readonly atMost: number };
  /** Words the answer should have, such as a recommendation or a wrap-up's decisions. */
  readonly says?: Words;
  /**
   * What the answer mustn't say, such as a caveat an earlier answer gave (#700): it has none of
   * any one's words.
   */
  readonly omits?: readonly Words[];
  /** After the answer, the owner undoes every save it made. */
  readonly undoSaves?: boolean;
  /** A skill the owner starts with this message, by name (ADR 0016). */
  readonly skill?: string;
  /**
   * The skills the model should load itself in this turn, by name, and no others; none means it
   * loads none. Left out, whatever it loads isn't checked (it's still printed).
   */
  readonly loads?: readonly string[];
  /**
   * Whether the answer should suggest replies (ADR 0017): two or three, after a question with a
   * few likely answers; or none, with an ordinary answer. Left out, it isn't checked (they're
   * still printed).
   */
  readonly suggests?: boolean;
  /**
   * Whether the answer should use the web (ADR 0019): search it or read a page, and list sources
   * under it; or neither. Left out, it isn't checked (what it searched, read and cited is printed).
   */
  readonly searches?: boolean;
  /** Whether the answer should hold a Markdown table after a sentence (ADR 0021); or none. */
  readonly tables?: boolean;
  /**
   * Whether the answer should hold a `chart` block the web app can draw (ADR 0021), with a
   * sentence of its own before it, as numbers that compare or change should; or none. Left out,
   * it isn't checked.
   */
  readonly charts?: boolean;
  /**
   * Whether the answer should hold a `mermaid` block (ADR 0021), with a sentence of its own before
   * it, as steps or how parts connect should; or none. Left out, it isn't checked.
   */
  readonly diagrams?: boolean;
  /**
   * The floor plan the answer should draw (#661), holding only sizes it was given. Left out, it
   * isn't checked.
   */
  readonly plans?: ExpectedPlan;
  /** The most words the answer has, as a brief planning answer should (#599). */
  readonly words?: { readonly atMost: number };
  /**
   * The most steps the answer gives, counted as numbered list items and "Step 1" lines, as a
   * hands-on answer's one step at a time should (#599).
   */
  readonly steps?: { readonly atMost: number };
  /**
   * The products the answer names are linked (#599): it links a page, and every list item or
   * table row with a price in it has a link. Left out, it isn't checked.
   */
  readonly links?: true;
  /** Whether the answer lists its topics (Get to know's first answer): a list of two or more. */
  readonly listsTopics?: boolean;
  /** What the answer mustn't ask, since it's known: no question has all of any one's words. */
  readonly avoids?: readonly Words[];
  /** Photos and PDFs the owner attaches to this message (#78). */
  readonly attach?: readonly TestFile[];
  /**
   * The documents this message should end with saved or updated (ADR 0020), each judged on its
   * text afterwards; none means it saves none. Left out, it isn't checked (they're still printed).
   */
  readonly documents?: readonly ExpectedDocument[];
  /**
   * An edit by hand to a file in the workspace, made the moment the model reads it in this turn,
   * so the document it read is out of date when it saves: its update should be refused, then
   * read again and retried, keeping the edit.
   */
  readonly editsAfterRead?: { readonly path: string; readonly text: string };
  /**
   * The Things this message should end with added, changed or removed (ADR 0020), each judged by
   * its file afterwards; none means it saves none. Left out, they aren't checked (they're still
   * printed).
   */
  readonly things?: readonly ExpectedThing[];
  /**
   * The projects this message should end with started or changed (#603), each judged by its file
   * afterwards; none means it saves none. Left out, they aren't checked (they're still printed).
   */
  readonly projects?: readonly ExpectedProject[];
  /** The Build it should start or change (#697), judged by the saved Build. */
  readonly builds?: ExpectedBuild;
  /** The sizes it should leave recorded (#708), judged by the saved records. */
  readonly sizes?: ExpectedSizes;
  /**
   * Said under Your tools' "Or just say it" (#707) rather than in a session: the tools it should
   * tick, each by name with its count when more than one, and none saved.
   */
  readonly heardTools?: readonly ExpectedTool[];
};

/** A tool "Or just say it" should tick: its name, and its count when it's more than one. */
export type ExpectedTool = { readonly name: string; readonly count?: number };

/**
 * A Thing a turn should add, change or remove: words its name has, and words each field it names
 * should have afterwards, the last line of its history, and the Thing it's part of, by file name.
 */
export type ExpectedThing = {
  readonly action: "add" | "change" | "remove";
  readonly name: Words;
  readonly fields?: Readonly<Partial<Record<"status" | ThingDetailName | "upcoming", Words>>>;
  readonly history?: Words;
  readonly partOf?: string;
};

/**
 * A floor plan a turn should draw (#661): a `plan` block the web app can draw, every size on it
 * one it was given, and nothing nobody gave a size drawn with one.
 */
export type ExpectedPlan = {
  /** The sizes it was given, in cm: every size on the plan is one of these, give or take 1 cm. */
  readonly sizes: readonly number[];
  /** Words for what nobody gave a size: nothing on the plan named with one has a size. */
  readonly unsized: readonly string[];
  /**
   * Whether it says its outline is a known size (`"measured": true`: the owner's measurement or a
   * room table's, #668). Left out, it isn't checked; either way a known outline's sizes must be
   * ones it was given.
   */
  readonly measured?: boolean;
};

/** A document a turn should save or update, and words its text must have afterwards. */
export type ExpectedDocument = {
  readonly action: "save" | "update";
  readonly words: Words;
};

/**
 * A skill a scenario adds: in the workspace's .agents/skills, the context folder's top-level one
 * (everywhere), or the house skills alongside Courtyard's own, where one can be owner-only.
 */
export type ScenarioSkill = {
  readonly name: string;
  readonly description: string;
  /** What it says to do, after its frontmatter. */
  readonly body: string;
  readonly where: "workspace" | "everywhere" | "house";
  /** Only the owner starts it (a house skill only). */
  readonly start?: "owner";
};

export type Scenario = {
  /** Short and unique, for `--only`. */
  readonly name: string;
  /** The saving rule it checks, in the eval's report. */
  readonly rule: string;
  readonly workspace: string;
  /** The context file's intro line, what the workspace is for (What's it for?), when it has one. */
  readonly intro?: string;
  readonly context: { facts?: string[]; ideas?: string[] };
  /** A starting owner context, when there is one. */
  readonly owner?: { facts?: string[]; ideas?: string[]; answers?: string[] };
  /** A code workspace, whose models save only to How to answer me; planning unless it says. */
  readonly mode?: "code";
  /** Other files in the workspace's folder, by path. */
  readonly files?: Readonly<Record<string, string>>;
  /** Files at the context folder's top, by path, such as the owner's tools (`things/…`, #707). */
  readonly ownerFiles?: Readonly<Record<string, string>>;
  /** Skills it adds to the workspace's, beyond Courtyard's house skills (ADR 0016). */
  readonly skills?: readonly ScenarioSkill[];
  /** The conversation. */
  readonly turns: readonly Turn[];
  /**
   * Printed for the owner to read, not scored: the topics each answer lists, such as Get to
   * know's for a workspace name (#127).
   */
  readonly printsTopics?: boolean;
};

/** A skill of the owner's for one workspace, used by the skills scenarios. */
const PACKING_LIST: ScenarioSkill = {
  name: "packing-list",
  description:
    "Makes a packing list for a trip, from what the context file says about it. Use it when the owner asks what to take, bring or pack.",
  body: "List what the trip needs, grouped by where it goes (sleeping, cooking, clothes), one thing per line, from what the context file says about the trip. Ask about anything that changes the list.",
  where: "workspace",
};

/** A grilling's answer recommends an answer to its question (docs/ai-conduct.md, Grilling). */
const RECOMMENDS: Words = [["recommend", "suggest", "i'd ", "i’d ", "i would", "my pick"]];

/**
 * The garage gym a grilling questions: a project whose steps are the plan to grill (#603), and
 * facts it shouldn't ask about.
 */
const GRILLED_GYM: Pick<Scenario, "workspace" | "context" | "files"> = {
  workspace: "Garage gym",
  context: { facts: ["The garage is 5 m by 3 m", "The ceiling is 2.4 m high"] },
  files: {
    "projects/set-up-the-garage-gym.md": [
      "---",
      "name: Set up the garage gym",
      "status: active",
      "---",
      "",
      "## Steps",
      "",
      "- [you can do this] Put the squat rack on the left wall",
      "- [you can do this] Buy a second-hand barbell by November",
      "",
      "## History",
      "",
      "- 2026-10-12: Started",
      "",
    ].join("\n"),
  },
};

/** A garage gym workspace for the web search scenarios. */
const SEARCHING_GYM: Pick<Scenario, "workspace" | "context"> = {
  workspace: "Garage gym",
  context: {
    facts: [
      "The garage is 5 m by 3 m",
      "Trains three mornings a week",
      "Is buying a 20 kg Olympic barbell this month",
    ],
  },
};

/** A code workspace for the web search scenarios (#517). */
const SEARCHING_SITE: Pick<Scenario, "workspace" | "mode" | "context"> = {
  workspace: "Website",
  mode: "code",
  context: { facts: ["A static site built with Astro"] },
};

/** This month as a Thing's bought field starts with it today: `2026-10`. */
const THIS_MONTH = new Date().toLocaleDateString("en-CA").slice(0, 7);

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "search-current-price",
    rule: "a question about current prices and stock searches the web and lists sources",
    ...SEARCHING_GYM,
    turns: [
      {
        say: "What does a Rogue Ohio Bar cost in the UK right now, and is it in stock anywhere?",
        expect: [],
        searches: true,
      },
    ],
  },
  {
    name: "attached-photo",
    rule: "A photo the owner attaches is described correctly, and still seen in a later turn (#78)",
    workspace: "Garden",
    context: { facts: ["The garden faces south"] },
    turns: [
      {
        say: "What's in this picture? One or two sentences.",
        attach: [LANDSCAPE],
        expect: [],
        says: [["sky"], ["grass", "field", "meadow", "lawn", "ground", "green"], ["sun"]],
      },
      {
        say: "Which corner was the sun in?",
        expect: [],
        says: [["top right", "top-right", "upper right", "upper-right"]],
      },
    ],
  },
  {
    name: "search-opening-times",
    rule: "a question about opening times searches the web and lists sources",
    workspace: "Days out",
    context: { facts: ["Lives about an hour from York"] },
    turns: [
      {
        say: "Is the National Railway Museum in York open on Mondays at the moment?",
        expect: [],
        searches: true,
      },
    ],
  },
  {
    name: "search-owner-link",
    rule: "a link the owner sends is read, and listed as a source",
    ...SEARCHING_GYM,
    turns: [
      {
        say: "Would this one do for me? https://www.roguefitness.com/rogue-ohio-bar-black-zinc",
        expect: [],
        searches: true,
      },
    ],
  },
  {
    name: "search-not-for-ordinary",
    rule: "an ordinary question is answered without searching the web",
    ...SEARCHING_GYM,
    turns: [
      {
        say: "Roughly how many sets of squats a week should a beginner do for strength?",
        expect: [],
        searches: false,
      },
    ],
  },
  {
    name: "search-code-library-release",
    rule: "in a code workspace, a question about a library's latest release searches the web and lists sources (#517)",
    ...SEARCHING_SITE,
    turns: [
      {
        say: "What's the latest stable version of Astro, and what changed in it?",
        expect: [],
        searches: true,
      },
    ],
  },
  {
    name: "search-code-not-for-code",
    rule: "in a code workspace, a question about writing code is answered without searching the web (#517)",
    ...SEARCHING_SITE,
    turns: [
      {
        say: "In TypeScript, how do I type a function that takes either a string or a list of strings?",
        expect: [],
        searches: false,
      },
    ],
  },
  {
    name: "table-comparison",
    rule: "options compared side by side are answered with a table after a sentence, and an ordinary question with none (ADR 0021)",
    workspace: "Padel",
    context: { facts: ["Plays padel twice a week", "Has a sore right elbow"] },
    turns: [
      {
        say: "How do the Head Evo Speed, the Babolat Contact and the Bullpadel Indiga CTR compare on weight, shape and how soft they feel?",
        expect: [],
        tables: true,
      },
      {
        say: "What's a bandeja, anyway?",
        expect: [],
        tables: false,
      },
    ],
  },
  {
    name: "chart-over-time",
    rule: "numbers that change over time are answered with a chart after a sentence, and a question without numbers with none (ADR 0021)",
    workspace: "Garage gym",
    context: {
      facts: [
        "Trains three mornings a week",
        "Best squat by month: June 60 kg, July 70 kg, August 77.5 kg, September 85 kg, October 90 kg",
      ],
    },
    turns: [
      {
        say: "How has my squat come on since June?",
        expect: [],
        charts: true,
      },
      {
        say: "Should I squat with a belt yet?",
        expect: [],
        charts: false,
      },
    ],
  },
  {
    // In planning, steps get no diagram unless the owner asks for one (#599: the owner found them
    // hard to read), so the first turn, which expected one, now expects none.
    name: "diagram-steps",
    rule: "in planning, steps that branch on what you find get no diagram, one the owner asks for is drawn after a sentence, and a plain question gets none (ADR 0021, #599)",
    workspace: "Mountain biking",
    context: { facts: ["Rides a Whyte T-140 trail bike", "Has a chain checker"] },
    turns: [
      {
        say: "Walk me through checking my chain: what I measure, and what each result means I should buy.",
        expect: [],
        diagrams: false,
      },
      {
        say: "Can you draw what each result means as a flowchart?",
        expect: [],
        diagrams: true,
      },
      {
        say: "How often should I lube the chain?",
        expect: [],
        diagrams: false,
      },
    ],
  },
  // A floor plan holds only sizes it was given (#661): a House session scaled doors, windows and
  // stairs off a developer's brochure, and a Garage session drew the boiler with a stand-in size.
  {
    name: "plan-brochure-sizes",
    rule: "a floor plan drawn from a brochure picture and its room table holds only the table's sizes, the owner's measurement over the developer's, and no door, window or stair sizes scaled off the picture (#661)",
    workspace: "House",
    context: {
      facts: [
        "Ground floor room sizes from the developer's table (width × depth): lounge 3.07 × 4.46 m, kitchen 2.69 × 2.52 m, dining 2.40 × 2.52 m, utility 1.79 × 1.53 m, WC 1.70 × 0.90 m, garage 2.80 × 5.30 m",
        "The owner measured the garage at 5.14 m deep × 2.74 m wide inside",
        "Facing the house from the street, the garage is on the left",
      ],
    },
    turns: [
      {
        say: "Here's the developer's ground floor plan from the brochure. Draw the ground floor as a floor plan.",
        attach: [BROCHURE_PLAN],
        expect: [],
        plans: {
          sizes: [307, 446, 269, 252, 240, 179, 153, 170, 90, 274, 514],
          unsized: ["door", "window", "stair", "lobby", "hall", "landing", "cupboard"],
        },
      },
    ],
  },
  {
    name: "plan-unmeasured-boiler",
    rule: "a floor plan gives a thing nobody measured no size, never a stand-in, and no garage door width nobody gave (#661)",
    workspace: "Garage",
    context: {
      facts: [
        "The garage measures 5.14 m long × 2.74 m wide inside",
        "The garage door is an up-and-over door across the front",
        "The house is on the right of the garage, looking in from the garage door",
        "The boiler is on the left wall, in the back corner",
        "The fridge freezer stands in the back right corner; it's 60 cm wide and 61 cm deep",
      ],
    },
    turns: [
      {
        say: "Draw the garage as a floor plan, to scale, from what's saved:\n- The garage measures 5.14 m long × 2.74 m wide inside\n- The fridge freezer stands in the back right corner; it's 60 cm wide and 61 cm deep",
        expect: [],
        plans: { sizes: [514, 274, 60, 61], unsized: ["boiler", "door"], measured: true },
      },
    ],
  },
  // A developer's room size is a known size (#668): the Office, bedroom 3 in the room table, had
  // its correct size hidden because nobody had measured it.
  {
    name: "plan-room-table-size",
    rule: "a single room drawn from a developer's room table says its outline is a known size, so its overall size is shown (#668)",
    workspace: "House",
    context: {
      facts: [
        "First floor room sizes from the developer's table (width × depth): bedroom 1 2.77 × 4.36 m, bedroom 2 3.07 × 3.83 m, bedroom 3 2.72 × 3.29 m, en suite 2.03 × 1.41 m, bathroom 1.95 × 1.91 m",
        "Bedroom 3 is now the Office",
        "The Office's window is in its front wall, the 2.72 m one, and its door in the back wall",
      ],
    },
    turns: [
      {
        say: "Draw the office as a floor plan.",
        expect: [],
        plans: { sizes: [272, 329], unsized: ["door", "window", "desk"], measured: true },
      },
    ],
  },
  ...PLANNING,
  ...GARAGE_BUILD,
  ...BUILDS,
  ...SIZES,
  ...PROJECTS,
  ...TOOLS,
  {
    name: "attached-pdf",
    rule: "A PDF the owner attaches is read and its contents used (#78)",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    turns: [
      {
        say: "A friend lent me the manual for his rack, to settle an argument. What's the most each J-hook can hold?",
        attach: [RACK_MANUAL],
        expect: [],
        says: [["340"]],
      },
      {
        say: "And what torque do the upright bolts need?",
        expect: [],
        says: [["45"]],
      },
    ],
  },
  {
    name: "grill-a-plan",
    rule: "Grilling a project's plan asks one question with a recommendation and suggested replies, records an agreed decision on the project (#603), and its wrap-up saves nothing",
    ...GRILLED_GYM,
    turns: [
      {
        say: "Put the squat rack on the left wall",
        skill: "grilling",
        expect: [],
        questions: { atLeast: 1, atMost: 1 },
        says: RECOMMENDS,
        suggests: true,
      },
      {
        say: "I've decided: the rack goes on the back wall instead. I haven't decided yet whether to bolt it to the floor.",
        expect: [],
        projects: [{ action: "change", name: ["gym"], words: ["back wall"] }],
      },
      {
        say: "That's enough for now, wrap it up.",
        expect: [],
        says: [
          ["decided", "decision", "agreed"],
          ["open", "undecided", "still to decide", "unresolved"],
        ],
        suggests: false,
      },
    ],
  },
  {
    name: "grill-on-request",
    rule: "a model loads Grilling itself when asked to grill a plan, and asks one question with a recommendation and suggested replies",
    ...GRILLED_GYM,
    turns: [
      {
        say: "Grill me on the barbell plan before I commit to it.",
        expect: [],
        loads: ["grilling"],
        questions: { atLeast: 1, atMost: 1 },
        says: RECOMMENDS,
        suggests: true,
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
  {
    name: "plan-is-no-line",
    rule: "what the owner means to do is never a context line, and no project is started unasked (#603)",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    turns: [
      {
        say: "I'm going to put rubber flooring down across the whole garage. How thick should it be for deadlifts?",
        expect: [],
        projects: [],
      },
    ],
  },
  {
    name: "maybe-one-day",
    rule: '"maybe one day" is an idea',
    workspace: "Allotment",
    context: { facts: ["The plot is a half plot with four raised beds"] },
    turns: [
      {
        say: "Maybe one day I'll put a little greenhouse at the back. Anyway, what can I still sow this month?",
        expect: [{ action: "add", section: "ideas", words: ["greenhouse"] }],
      },
    ],
  },
  {
    name: "decided-or-idea-asks",
    rule: "unclear between decided and an idea gets a question, then a save as a fact once the owner says it's decided (#603)",
    workspace: "House",
    context: { facts: ["The hallway is painted magnolia"] },
    turns: [
      {
        say: "The hallway's probably going dark green.",
        expect: [],
        asks: [["decided", "decide", "settled", "set on", "definite", "sure", "plan", "committed"]],
      },
      {
        say: "It's decided, I'm doing it.",
        expect: [{ action: "add", section: "facts", words: ["green"] }],
      },
    ],
  },
  {
    name: "idea-becomes-fact",
    rule: "an idea the owner decides on changes into a fact, by label (#603)",
    workspace: "Allotment",
    context: {
      facts: ["The plot is a half plot with four raised beds"],
      ideas: ["Put a small greenhouse at the back of the plot"],
    },
    turns: [
      {
        say: "Right, I've made my mind up: the greenhouse is happening. Glass or polycarbonate?",
        expect: [
          {
            action: "change",
            was: "Put a small greenhouse at the back of the plot",
            section: "facts",
            words: ["greenhouse"],
          },
        ],
      },
    ],
  },
  {
    name: "stale-line-goes",
    rule: "a line the owner says is no longer true is removed or changed",
    workspace: "Running",
    context: {
      facts: ["Runs about 25 km a week", "Runs with a club on Thursday evenings"],
    },
    turns: [
      {
        say: "I've left the running club, it wasn't for me. Can you suggest a solo Thursday evening session?",
        expect: [{ action: "change-or-remove", was: "Runs with a club on Thursday evenings" }],
      },
    ],
  },
  {
    name: "stale-line-changed",
    rule: "a line that's out of date is changed to what's true now",
    workspace: "Car",
    context: { facts: ["Drives a 2015 hatchback", "Parks on the street"] },
    turns: [
      {
        say: "Sold the hatchback and got a 2019 estate car instead. How often should I check the tyre pressures?",
        expect: [
          {
            action: "change",
            was: "Drives a 2015 hatchback",
            section: "facts",
            words: ["estate"],
          },
        ],
      },
    ],
  },
  {
    name: "small-talk",
    rule: "passing chat saves nothing",
    workspace: "Allotment",
    context: { facts: ["The plot is a half plot with four raised beds"] },
    turns: [
      {
        say: "Lovely sunny morning down at the plot today! How deep should garlic cloves go in?",
        expect: [],
      },
    ],
  },
  {
    name: "one-off-request",
    rule: 'a one-off request ("shorter this time") saves nothing',
    workspace: "Running",
    context: { facts: ["Runs about 25 km a week"] },
    turns: [
      { say: "What's a good warm-up before an easy run?", expect: [] },
      { say: "Shorter this time please, just a few bullet points.", expect: [] },
    ],
  },
  {
    name: "suggestion-not-agreed",
    rule: "Claude's own suggestions save nothing until the owner agrees",
    workspace: "House",
    context: { facts: ["The bathroom has no window", "The bathroom extractor fan is really loud"] },
    turns: [
      {
        say: "What could I do about the noisy extractor fan?",
        expect: [],
      },
    ],
  },
  {
    name: "suggestion-agreed",
    rule: "a suggestion the owner agrees to do isn't saved as a line: what they mean to do is a project's (#603)",
    workspace: "House",
    context: { facts: ["The bathroom has no window", "The bathroom extractor fan is really loud"] },
    turns: [
      { say: "What could I do about the noisy extractor fan?", expect: [] },
      {
        say: "Good shout on cleaning it first. I'll do that this weekend.",
        expect: [],
      },
    ],
  },
  {
    name: "remember-that",
    rule: '"remember that" saves',
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    turns: [
      {
        say: "Remember that my left shoulder clicks when I overhead press.",
        // A body fact matters to more than one workspace, so About me is right too.
        expect: [
          { action: "add", place: ["workspace", "owner"], section: "facts", words: ["shoulder"] },
        ],
      },
    ],
  },
  {
    name: "already-in-the-file",
    rule: "something already in the file isn't saved again",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m", "The ceiling is 2.3 m"] },
    turns: [
      {
        say: "With my 2.3 m ceiling, can I do standing overhead press with an Olympic bar?",
        expect: [],
      },
    ],
  },
  {
    name: "already-said-differently",
    rule: "something the file already says in other words isn't saved again",
    workspace: "Allotment",
    context: { facts: ["The soil is heavy clay"] },
    turns: [
      {
        say: "My soil's really claggy clay. What should I dig in to break it up?",
        expect: [],
      },
    ],
  },
  {
    name: "date-where-time-matters",
    rule: "a line that can go out of date keeps its date",
    workspace: "House",
    context: { facts: ["The boiler is 18 years old"] },
    turns: [
      {
        say: "Got a quote for a new boiler: £2,400 fitted, valid until the end of November. Is that a fair price?",
        expect: [{ action: "add", section: "facts", words: [["2,400", "2400"], "nov"] }],
      },
    ],
  },
  {
    name: "no-date-where-it-doesnt",
    rule: "a line that doesn't age has no date",
    workspace: "Running",
    context: { facts: ["Runs about 25 km a week"] },
    turns: [
      {
        say: "A physio told me I overpronate on my left foot. What should I look for in my next road shoes?",
        expect: [
          {
            action: "add",
            // A body fact matters to more than one workspace, so About me is right too.
            place: ["workspace", "owner"],
            section: "facts",
            words: ["pronat"],
            without: ["2026", "october", "today", "yesterday"],
          },
        ],
      },
    ],
  },
  {
    name: "undone-stays-undone",
    rule: "an undone save in the conversation isn't saved again",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    turns: [
      {
        say: "My partner uses the gym too, mostly the bike.",
        expect: [{ action: "add", section: "facts", words: ["partner"] }],
        undoSaves: true,
      },
      { say: "What 20-minute bike workout could my partner do?", expect: [] },
    ],
  },
  {
    name: "two-things-at-once",
    rule: "a decision and an idea in one message become a fact and an idea",
    workspace: "Running",
    context: { facts: ["Runs about 25 km a week"] },
    turns: [
      {
        say: "I've entered a half marathon in April, it's happening! And maybe one day I'd like to try an ultra.",
        expect: [
          { action: "add", section: "facts", words: ["half"] },
          { action: "add", section: "ideas", words: ["ultra"] },
        ],
      },
    ],
  },
  {
    name: "files-only-when-asked",
    rule: "what's in the workspace's files isn't saved unless the owner asks about that file",
    workspace: "Allotment",
    context: { facts: ["The plot is a half plot with four raised beds"] },
    files: {
      "notes/last-year.md": "# Last year\n\n- Bed 3: potatoes\n- Bed 1: onions and garlic\n",
    },
    turns: [{ say: "What should I grow in bed 3 next spring?", expect: [] }],
  },
  // Where a save goes: About me, How to answer me, or the workspace (docs/ai-conduct.md).
  {
    name: "owner-life-wide-fact",
    rule: "a fact true across the owner's life goes to About me",
    workspace: "Running",
    context: { facts: ["Runs about 25 km a week"] },
    owner: { answers: ["Metric units"] },
    turns: [
      {
        say: "I moved to Leeds last month. Where are some good flat routes for a long run?",
        expect: [{ action: "add", place: "owner", section: "facts", words: ["leeds"] }],
      },
    ],
  },
  {
    name: "owner-two-workspaces",
    rule: "a fact that matters to more than one workspace goes to About me",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    owner: { facts: ["Lives in Leeds"] },
    turns: [
      {
        say: "I've got a bad left knee, which messes with my running as well. Which leg exercises are safe for it?",
        expect: [{ action: "add", place: "owner", section: "facts", words: ["knee"] }],
      },
    ],
  },
  {
    name: "workspace-only-fact",
    rule: "a fact about one workspace stays in its context file",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    owner: { facts: ["Lives in Leeds"], answers: ["Metric units"] },
    turns: [
      {
        say: "There's a damp patch in the back corner of the garage. Is it safe to keep my dumbbells there?",
        expect: [{ action: "add", section: "facts", words: ["damp"] }],
      },
    ],
  },
  {
    name: "lasting-preference",
    rule: "a preference stated as lasting goes to How to answer me",
    workspace: "Allotment",
    context: { facts: ["The plot is a half plot with four raised beds"] },
    owner: { facts: ["Lives in Leeds"] },
    turns: [
      {
        say: "From now on, always give me sowing times as months, not seasons. When do I sow broad beans?",
        expect: [{ action: "add", place: "owner", section: "answers", words: ["month"] }],
      },
    ],
  },
  {
    name: "one-off-not-a-preference",
    rule: "a one-off request isn't a preference, so nothing goes to How to answer me",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    owner: { facts: ["Lives in Leeds"], answers: ["Metric units"] },
    turns: [
      {
        say: "Keep it really short today, I'm in a rush: what's a 15-minute workout with just dumbbells?",
        expect: [],
      },
    ],
  },
  // Get to know and Get to know me, the house skills only the owner starts (#127).
  {
    name: "get-to-know-workspace",
    rule: "Get to know asks one quick question at a time with replies to tap, lists no topics (#599), never asks what's known, saves each answer and wraps up when the owner has had enough",
    workspace: "Allotment",
    intro: "A half plot at the Rosebank allotments, growing veg for the family",
    context: {},
    owner: { facts: ["Lives in Leeds with partner Sam and two kids"] },
    turns: [
      {
        say: "Get to know this workspace.",
        skill: "get-to-know",
        expect: [],
        listsTopics: false,
        questions: { atLeast: 1, atMost: 1 },
        suggests: true,
        avoids: [
          ["where", "plot"],
          ["how big", "plot"],
          ["where", "you live"],
        ],
        loads: [],
      },
      {
        say: "Mostly potatoes, onions and runner beans.",
        expect: [{ action: "add", section: "facts", words: ["potato"] }],
        questions: { atLeast: 1, atMost: 1 },
        suggests: true,
        loads: [],
      },
      {
        say: "That's enough for now, thanks.",
        expect: [],
        questions: { atLeast: 0, atMost: 0 },
        says: ["potato"],
        loads: [],
      },
    ],
  },
  {
    name: "get-to-know-five",
    rule: "Get to know asks at most five questions, each with replies to tap, then wraps up without another (#599)",
    workspace: "Allotment",
    intro: "A half plot at the Rosebank allotments, growing veg for the family",
    context: {},
    turns: [
      {
        say: "Get to know this workspace.",
        skill: "get-to-know",
        expect: [],
        questions: { atLeast: 1, atMost: 1 },
        suggests: true,
      },
      ...(
        [
          ["Mostly potatoes, onions and runner beans.", ["potato"]],
          ["Twice a week, at weekends.", [["twice", "two"]]],
          ["Pretty new to it, this is my second year.", ["second"]],
          // Not kit, which is rightly saved as a Thing ("a small shed" was).
          ["My sister helps out now and then.", ["sister"]],
        ] as const
      ).map(
        // At most five, so it may wrap up before the fifth answer: none or one question.
        ([say, words]): Turn => ({
          say,
          expect: [{ action: "add", section: "facts", words }],
          questions: { atLeast: 0, atMost: 1 },
        }),
      ),
      // The fifth answer: what it saves, then a wrap-up with no new question.
      {
        // Whole on its own, whatever was asked: "About £100 a year" left Claude asking what for.
        say: "We spend about £100 a year on the plot, all in.",
        expect: [{ action: "add", section: "facts", words: ["100"] }],
        questions: { atLeast: 0, atMost: 0 },
        suggests: false,
      },
    ],
  },
  {
    name: "get-to-know-me",
    rule: "Get to know me lists its topics, asks one question at a time without asking what's known, saves each answer to the owner context and wraps up when the owner has had enough",
    workspace: "Home",
    context: {},
    owner: { facts: ["Lives in Leeds with partner Sam"], answers: ["Metric units"] },
    turns: [
      {
        say: "Get to know me.",
        skill: "get-to-know-me",
        expect: [],
        listsTopics: true,
        questions: { atLeast: 1, atMost: 2 },
        suggests: true,
        avoids: [["where", "you live"], ["who", "live"], ["metric"]],
        loads: [],
      },
      {
        say: "I'm a nurse, mostly on night shifts.",
        expect: [{ action: "add", place: "owner", section: "facts", words: ["nurse"] }],
        questions: { atLeast: 1, atMost: 1 },
        loads: [],
      },
      {
        say: "That's enough for now.",
        expect: [],
        questions: { atLeast: 0, atMost: 0 },
        says: [["nurse", "nursing"]],
        loads: [],
      },
    ],
  },
  // The topics Get to know plans from a workspace's name alone, printed for the owner (#127).
  ...["Garage gym", "House move", "Padel", "Boiler admin", "Mountain biking", "Trip to Japan"].map(
    (workspace): Scenario => ({
      name: `topics-${workspace.toLowerCase().replaceAll(" ", "-")}`,
      rule: "printed, not scored: what Get to know asks first, from the workspace's name",
      workspace,
      context: {},
      turns: [{ say: "Get to know this workspace.", skill: "get-to-know", expect: [] }],
      printsTopics: true,
    }),
  ),
  {
    name: "code-workspace-preference",
    rule: "a code workspace saves a lasting preference to How to answer me, and nothing about the owner",
    workspace: "Website",
    mode: "code",
    context: { facts: ["A static site built with Astro"] },
    owner: { answers: ["Metric units"] },
    turns: [
      {
        say: "Always show me TypeScript, never plain JavaScript. How do I add a sitemap?",
        expect: [{ action: "add", place: "owner", section: "answers", words: ["typescript"] }],
      },
      {
        say: "I moved to Leeds last month, so I'm a bit slow this week. Which file does the sitemap go in?",
        expect: [],
      },
    ],
  },
  {
    name: "skill-fits-a-request",
    rule: "a plain-words request that fits a skill's description loads it",
    workspace: "Camping",
    context: { facts: ["Is camping in the Lake District, 14-16 Nov 2026, two nights in the tent"] },
    skills: [PACKING_LIST],
    turns: [
      {
        say: "Can you put together what I need to take on the Lake District trip?",
        expect: [],
        loads: ["packing-list"],
      },
    ],
  },
  {
    name: "skill-house-grilling",
    rule: "a request to stress-test a plan loads the house Grilling",
    ...GRILLED_GYM,
    skills: [PACKING_LIST],
    turns: [
      {
        say: "Grill me on my plan for where the squat rack goes, before I bolt it down.",
        expect: [],
        loads: ["grilling"],
      },
    ],
  },
  {
    name: "skill-unrelated-question",
    rule: "an unrelated question loads no skill",
    workspace: "Camping",
    context: { facts: ["Is camping in the Lake District, 14-16 Nov 2026, two nights in the tent"] },
    skills: [PACKING_LIST],
    turns: [
      {
        say: "How long does it take to drive from Leeds to Keswick, roughly?",
        expect: [],
        loads: [],
      },
    ],
  },
  {
    name: "skill-owner-only",
    rule: "a skill only the owner starts never loads by itself, even when the request fits it",
    workspace: "Allotment",
    context: { facts: ["The plot is a half plot with four raised beds"] },
    skills: [
      {
        name: "plot-survey",
        description:
          "Surveys the allotment by asking the owner about each bed, one question at a time.",
        body: "Ask the owner about each bed in turn, one question per message, and save what they say.",
        where: "house",
        start: "owner",
      },
    ],
    turns: [
      {
        say: "Could you survey my allotment, bed by bed?",
        expect: [],
        loads: [],
      },
    ],
  },
  {
    name: "skill-started-by-owner",
    rule: "a skill the owner starts is followed, without the model loading it, and still in the next turn",
    workspace: "Allotment",
    context: { facts: ["The plot is a half plot with four raised beds"] },
    skills: [
      {
        name: "plot-survey",
        description:
          "Surveys the allotment by asking the owner about each bed, one question at a time.",
        body: "Ask the owner about the beds one question per message, starting with the first bed. Don't give advice until every bed is covered.",
        where: "house",
        start: "owner",
      },
    ],
    turns: [
      {
        say: "Let's go through the plot.",
        skill: "plot-survey",
        expect: [],
        asks: ["bed"],
        questions: { atLeast: 1, atMost: 2 },
        loads: [],
      },
      {
        say: "Bed one has garlic in it at the moment.",
        expect: [{ action: "add", section: "facts", words: ["garlic"] }],
        asks: ["bed"],
        questions: { atLeast: 1, atMost: 2 },
        loads: [],
      },
    ],
  },
  ...REPLIES,
  {
    name: "document-saved-when-asked",
    rule: "a model offers to save a longer answer as a document, but saves it only once the owner asks",
    workspace: "Padel",
    context: {
      facts: [
        "Plays padel on Tuesdays and Saturdays",
        "Has a weak left knee",
        "Is playing the club tournament on 14 November",
      ],
    },
    turns: [
      {
        say: "Can you make me a four-week training plan up to the tournament, two sessions a week? Keep my knee in mind.",
        expect: [],
        documents: [],
      },
      {
        say: "Save it as a document please.",
        expect: [],
        documents: [{ action: "save", words: ["week", "knee"] }],
      },
    ],
  },
  {
    name: "document-stale-update",
    rule: "an update to a document changed since the model read it is refused, read again and retried, keeping the change",
    workspace: "Padel",
    context: { facts: ["Going to Bilbao for a padel weekend in November"] },
    files: {
      "docs/packing-list-for-bilbao.md":
        "# Packing list for Bilbao\n\n- Two rackets\n- Trainers\n- Shorts\n",
    },
    turns: [
      {
        say: "Add grips to my packing list for Bilbao, please.",
        expect: [],
        documents: [{ action: "update", words: ["grips", "sun cream", "two rackets"] }],
        editsAfterRead: {
          path: "docs/packing-list-for-bilbao.md",
          text: "# Packing list for Bilbao\n\n- Two rackets\n- Trainers\n- Shorts\n- Sun cream\n",
        },
      },
    ],
  },
  {
    name: "thing-chain-swapped",
    rule: "something the owner did to a Thing changes that Thing, its fields and its history, and nothing else",
    workspace: "Mountain biking",
    context: { facts: ["Rides trails most Sundays"] },
    files: {
      "things/whyte-t-140.md":
        "---\nname: Whyte T-140\nstatus: have\nbought: 2025-04\nprice: £1,400\n---\n\n- 2025-04-12: Bought second-hand\n",
      "things/chain.md":
        "---\nname: Chain\nstatus: have\nbrand: KMC X11\nbought: 2025-04\npart of: whyte-t-140\n---\n",
      "things/cassette.md":
        "---\nname: Cassette\nstatus: have\nbrand: SRAM XG-1150\nbought: 2025-04\npart of: whyte-t-140\n---\n",
      "things/tyres.md":
        "---\nname: Tyres\nstatus: have\nbrand: Maxxis Minion DHF 2.5\nbought: 2026-05\npart of: whyte-t-140\n---\n",
    },
    turns: [
      {
        say: "Swapped the chain today, the old one was past 0.75%. Went with the KMC X11 again, £32.",
        expect: [],
        things: [
          {
            action: "change",
            name: ["chain"],
            fields: { price: ["32"], bought: [THIS_MONTH] },
            history: [["swap", "replace", "new", "fitted"]],
            partOf: "whyte-t-140",
          },
        ],
      },
    ],
  },
  {
    name: "thing-parts-offered",
    rule: "a model adds what the owner bought, offers its typical parts, and adds them only once the owner agrees",
    workspace: "Mountain biking",
    context: { facts: ["Rides trails most Sundays"] },
    turns: [
      {
        say: "Picked up a Whyte T-140 on Saturday, £1,400 second-hand.",
        expect: [],
        things: [
          {
            action: "add",
            name: ["t-140"],
            fields: { status: ["have"], price: [["1,400", "1400"]] },
          },
        ],
        asks: [["chain", "tyre", "fork", "part", "component"]],
      },
      {
        say: "Yes, add the chain and the tyres.",
        expect: [],
        things: [
          { action: "add", name: ["chain"], partOf: "whyte-t-140" },
          { action: "add", name: ["tyre"], partOf: "whyte-t-140" },
        ],
      },
    ],
  },
  {
    // The owner's real mistake (#602): wanting new pedals made a new Thing beside the pedals.
    name: "thing-new-pedals-upcoming",
    rule: "a new one of a part that's there is saved as upcoming on that part, never as a new Thing",
    workspace: "Mountain biking",
    context: { facts: ["Rides trails most Sundays"] },
    files: {
      "things/boardman-mht-8-6.md":
        "---\nname: Boardman MHT 8.6\nstatus: have\nbought: 2026-09\nprice: £650\n---\n",
      "things/pedals.md":
        "---\nname: Pedals\nstatus: have\nbrand: Wellgo alloy flats\ncondition: Feet slide off on rough ground\npart of: boardman-mht-8-6\n---\n\n- 2026-09-20: Came with the bike\n",
      "things/chain.md":
        "---\nname: Chain\nstatus: have\nbrand: KMC X9\npart of: boardman-mht-8-6\n---\n",
    },
    turns: [
      {
        say: "I want new pedals, my feet keep sliding off. I've decided on the DMR V8s, they're about £28.",
        expect: [],
        things: [
          {
            action: "change",
            name: ["pedals"],
            fields: { upcoming: [["v8", "dmr"]] },
            partOf: "boardman-mht-8-6",
          },
        ],
      },
    ],
  },
];

/** A section of a starting file, under a heading of this level. */
const section = (heading: string, lines: readonly string[] = []) => [
  heading,
  "",
  ...lines.map((line) => `- ${line}`),
  ...(lines.length === 0 ? [] : [""]),
];

/** A starting context file, as the owner would have written it. */
export const contextFileFor = (scenario: Scenario) => {
  const { facts, ideas } = scenario.context;
  return [
    `# ${scenario.workspace}`,
    "",
    ...(scenario.intro === undefined ? [] : [scenario.intro, ""]),
    ...section("## Facts", facts),
    ...section("## Ideas", ideas),
  ].join("\n");
};

/** A starting owner context, as the owner would have written it, or `undefined` for none. */
export const ownerContextFor = (scenario: Scenario) => {
  if (scenario.owner === undefined) return undefined;
  const { facts, ideas, answers } = scenario.owner;
  return [
    "# Owner context",
    "",
    "## About me",
    "",
    ...section("### Facts", facts),
    ...section("### Ideas", ideas),
    ...section("## How to answer me", answers),
  ].join("\n");
};
