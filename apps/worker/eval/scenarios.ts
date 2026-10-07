import type { OwnerSection, PlacedLine } from "@courtyard/contract";

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
  /** The saves this message should end with; none means it saves nothing. */
  readonly expect: readonly ExpectedSave[];
  /** The answer should ask the owner something rather than guess: a question with these words. */
  readonly asks?: Words;
  /** After the answer, the owner undoes every save it made. */
  readonly undoSaves?: boolean;
};

export type Scenario = {
  /** Short and unique, for `--only`. */
  readonly name: string;
  /** The saving rule it checks, in the eval's report. */
  readonly rule: string;
  readonly workspace: string;
  readonly context: { facts?: string[]; plans?: string[]; ideas?: string[] };
  /** A starting owner context, when there is one. */
  readonly owner?: { facts?: string[]; plans?: string[]; ideas?: string[]; answers?: string[] };
  /** A code workspace, whose models save only to How to answer me; planning unless it says. */
  readonly mode?: "code";
  /** Other files in the workspace's folder, by path. */
  readonly files?: Readonly<Record<string, string>>;
  readonly turns: readonly Turn[];
};

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "fact-in-passing",
    rule: "a fact stated in passing is saved",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    turns: [
      {
        say: "What squat rack would fit in here? The ceiling's only 2.3 m, by the way.",
        expect: [{ action: "add", section: "facts", words: ["2.3"] }],
      },
    ],
  },
  {
    name: "plan-is-a-plan",
    rule: "a plan is saved as a plan, not a fact",
    workspace: "Garage gym",
    context: { facts: ["The garage is 5 m by 3 m"] },
    turns: [
      {
        say: "I'm going to put rubber flooring down across the whole garage. How thick should it be for deadlifts?",
        expect: [{ action: "add", section: "plans", words: [["rubber", "floor"]] }],
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
    name: "plan-or-idea-asks",
    rule: "unclear between plan and idea gets a question, then a save once the owner says",
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
        expect: [{ action: "add", section: "plans", words: ["green"] }],
      },
    ],
  },
  {
    name: "done-plan-becomes-fact",
    rule: '"I\'ve done it" changes the plan into a fact, by label',
    workspace: "Garage gym",
    context: {
      facts: ["The garage is 5 m by 3 m"],
      plans: ["Fit a pull-up bar on the back wall"],
    },
    turns: [
      {
        say: "Finished fitting the pull-up bar on the back wall yesterday! What should a first pull-up programme look like?",
        expect: [
          {
            action: "change",
            was: "Fit a pull-up bar on the back wall",
            section: "facts",
            words: ["pull-up"],
          },
        ],
      },
    ],
  },
  {
    name: "idea-becomes-plan",
    rule: "an idea the owner decides on changes into a plan, by label",
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
            section: "plans",
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
    rule: "a suggestion the owner agrees to is saved",
    workspace: "House",
    context: { facts: ["The bathroom has no window", "The bathroom extractor fan is really loud"] },
    turns: [
      { say: "What could I do about the noisy extractor fan?", expect: [] },
      {
        say: "Good shout on cleaning it first. I'll do that this weekend.",
        expect: [{ action: "add", section: "plans", words: ["clean"] }],
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
        expect: [{ action: "add", section: ["facts", "plans"], words: [["2,400", "2400"], "nov"] }],
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
    rule: "a decision and an idea in one message become a plan and an idea",
    workspace: "Running",
    context: { facts: ["Runs about 25 km a week"] },
    turns: [
      {
        say: "I've entered a half marathon in April, it's happening! And maybe one day I'd like to try an ultra.",
        expect: [
          { action: "add", section: ["plans", "facts"], words: ["half"] },
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
  const { facts, plans, ideas } = scenario.context;
  return [
    `# ${scenario.workspace}`,
    "",
    ...section("## Facts", facts),
    ...section("## Plans", plans),
    ...section("## Ideas", ideas),
  ].join("\n");
};

/** A starting owner context, as the owner would have written it, or `undefined` for none. */
export const ownerContextFor = (scenario: Scenario) => {
  if (scenario.owner === undefined) return undefined;
  const { facts, plans, ideas, answers } = scenario.owner;
  return [
    "# Owner context",
    "",
    "## About me",
    "",
    ...section("### Facts", facts),
    ...section("### Plans", plans),
    ...section("### Ideas", ideas),
    ...section("## How to answer me", answers),
  ].join("\n");
};
