import type { Scenario, Words } from "./scenarios.ts";

/** A made-up Thing's file: its name, status and brand, as the owner would have saved it. */
const thingFile = (name: string, status: string, brand?: string) =>
  [
    "---",
    `name: ${name}`,
    `status: ${status}`,
    ...(brand ? [`brand: ${brand}`] : []),
    "---",
    "",
  ].join("\n");

/**
 * A made-up garage workshop, as the planning conduct scenarios from the garage build start with it
 * (#700): its tools saved as Things, and a workbench project whose size is decided.
 */
const WORKSHOP: Pick<Scenario, "workspace" | "context" | "files"> = {
  workspace: "Workshop",
  context: {
    facts: [
      "A single garage, used as a workshop",
      "The back wall is 160 cm wide, breeze block",
      "The side door is at the back of the right wall",
    ],
  },
  files: {
    "things/cordless-drill.md": thingFile("Cordless drill", "have", "Makita DHP482"),
    "things/mitre-saw.md": thingFile("Mitre saw", "have", "Evolution R210SMS"),
    "things/f-clamps.md": thingFile("F-clamps", "have", "Four, 300 mm"),
    "things/tape-measure.md": thingFile("Tape measure", "have", "Stanley 5 m"),
    "things/speed-square.md": thingFile("Speed square", "have"),
    "projects/build-the-workbench.md": [
      "---",
      "name: Build the workbench",
      "goal: A sturdy bench along the back wall. Budget £150.",
      "status: active",
      "---",
      "",
      "## Steps",
      "",
      "- [decided] Size: 150 × 60 cm, 18 mm OSB top, 90 cm high",
      "- [you can do this] Cut the legs · mitre saw",
      "- [you can do this] Fix the frame together · drill, 70 mm screws",
      "- [you can do this] Fit the shelf underneath",
      "",
      "## Decisions",
      "",
      "### Size",
      "",
      "- Pick: 150 × 60 cm, 18 mm OSB top, 90 cm high",
      "- Why: Fits the back wall with room to get past",
      "- Options: 120 × 60 cm; 150 × 60 cm; 180 × 60 cm",
      "",
      "## History",
      "",
      "- 2026-10-20: Started",
      "",
    ].join("\n"),
  },
};

/** The tools and steps of another AI's plan for the workshop's bench (#700). */
const PASTED_TOOLS_AND_STEPS = [
  "Tools you'll use: circular saw, router, pocket-hole jig, orbital sander.",
  "Steps: cut the legs, build two frames, join them with rails, fix the top.",
];

/** Another AI's whole plan for the bench, pasted in by the owner, its size not the one decided. */
const PASTED_PLAN = [
  ...PASTED_TOOLS_AND_STEPS,
  "Materials: four 2.4 m lengths of 3×2 CLS, one sheet of 18 mm OSB, 70 mm screws.",
  "Size: 180 × 60 cm top, 90 cm high.",
].join("\n");

/** Refusing to check a plan, rather than saying what to change (#700). */
const REFUSES_TO_CHECK: readonly Words[] = [
  ["can't verify"],
  ["can’t verify"],
  ["cannot verify"],
  ["unable to verify"],
  ["can't check"],
  ["can’t check"],
  ["cannot check"],
];

/** Asking for tools the workshop has saved as Things (#700). */
const TOOLS_ASKED: readonly Words[] = [
  [["photo", "picture"], "tool"],
  ["what tools"],
  ["which tools"],
  ["tools do you"],
  ["tools you have"],
  ["tools you've got"],
  ["tools you’ve got"],
];

/** From the garage build (#700): what real planning use got wrong that the conduct should prevent. */
export const GARAGE_BUILD: readonly Scenario[] = [
  {
    name: "planning-tools-in-things",
    rule: "tools saved as Things are used, never asked for or asked to be photographed (#700)",
    ...WORKSHOP,
    turns: [
      {
        // As the garage build's owner asked, the tools there already: "you should see it in my things".
        say: "I want to hang my tools on a pegboard above the bench. What goes where?",
        expect: [],
        says: [["drill", "makita"], ["mitre"], ["clamp"]],
        avoids: TOOLS_ASKED,
      },
    ],
  },
  {
    name: "planning-sizes-in-project",
    rule: "a design's sizes saved on its project are read and used, never said to be missing (#700)",
    ...WORKSHOP,
    turns: [
      {
        say: "Can you give me the cut list for the bench?",
        expect: [],
        says: [["88", "90"], ["150"]],
        // The bench's own sizes; its timber's section isn't saved, so asking that is fair.
        avoids: [
          ["how tall"],
          ["how high"],
          ["how wide"],
          ["what height"],
          ["dimensions"],
          ["how long", "bench"],
          ["what size", "bench"],
          ["what size", "top"],
        ],
      },
    ],
  },
  {
    name: "planning-go-ahead",
    rule: "when the owner wants to get on, the answer goes ahead with the next step, without circling back or making a requirement of what they don't need (#700)",
    ...WORKSHOP,
    // Saved already, so the owner saying it again is only them getting on.
    context: {
      facts: [
        ...(WORKSHOP.context.facts ?? []),
        "The bench sits close to the side door, leaving no room for the bin, and that's fine",
      ],
    },
    turns: [
      {
        say: "I know the side door's close to the bench and there's no room left for the bin. That's fine, fit what we can. Can we just build the bench please?",
        expect: [],
        steps: { atMost: 1 },
        questions: { atLeast: 0, atMost: 1 },
        avoids: [["door"], ["bin"], ["layout"], ["access"]],
      },
    ],
  },
  {
    name: "planning-caveat-once",
    rule: "a caveat is given once, never again in the answers after it (#700)",
    ...WORKSHOP,
    turns: [
      {
        // Just under a light switch, so the first answer gives its caveat: cables run down from it.
        say: "I'm fixing the bench's back rail to the breeze block wall, just under the light switch, with plugs and screws. Anything I should know before I drill?",
        expect: [],
        says: [["cable", "wire", "detector"]],
      },
      {
        // The owner has dealt with it, and asks what it doesn't bear on, so saying it again is only a repeat.
        say: "Ran a detector over the wall, nothing there. Got a 7 mm masonry bit and brown plugs. How deep do I drill each hole?",
        expect: [],
        omits: [["cable"], ["wire"], ["detector"]],
      },
      {
        say: "First hole's done. Next?",
        expect: [],
        omits: [["cable"], ["wire"], ["detector"]],
      },
    ],
  },
  {
    // From the review of #719 (#697): giving a caveat once mustn't swallow a safety step as it applies.
    name: "planning-safety-step-not-a-repeat",
    rule: "a safety step for what the owner is about to do is given at that step, even after an earlier caveat about it (#697)",
    ...WORKSHOP,
    turns: [
      {
        say: "I'll be fixing a shelf to the breeze block wall by the light switch at some point. Anything to bear in mind?",
        expect: [],
        says: [["cable", "wire", "detector"]],
      },
      {
        // Nothing says they've checked yet, so the scan belongs to this step.
        say: "Right, drill's in my hand, I'm drilling the first hole by the switch now. What do I do?",
        expect: [],
        says: [["detector", "scan", "cable", "wire"]],
      },
    ],
  },
  {
    name: "planning-pasted-plan-is-ideas",
    rule: "a plan pasted from another AI is ideas: none of its tools saved as the owner's, nothing in it saved as decided (#700)",
    ...WORKSHOP,
    turns: [
      {
        // The owner takes its steps, so they go on the project; its tools stay theirs to say.
        say: `Another AI gave me this plan for the bench. Let's go with its steps, put them on the project.\n\n${PASTED_TOOLS_AND_STEPS.join("\n")}`,
        expect: [],
        things: [],
        projects: [{ action: "change", name: ["workbench"], words: [["frames", "rails"]] }],
      },
    ],
  },
  {
    name: "planning-pasted-plan-checked",
    rule: "asked to check another AI's plan, the answer says briefly what to change, from what's saved, never refusing to check it (#700)",
    ...WORKSHOP,
    turns: [
      {
        say: `Can you check this bench plan another AI wrote me?\n\n${PASTED_PLAN}`,
        expect: [],
        says: [["150", "160"]],
        omits: REFUSES_TO_CHECK,
        // Five things to change, a short line each.
        words: { atMost: 150 },
        things: [],
      },
    ],
  },
  {
    // The garage build saved wanted materials by name only, the rest left in the answer (#700).
    name: "thing-wanted-keeps-details",
    rule: "a wanted Thing keeps the details given for it: its price, its shop and the page it's sold on (#700)",
    ...WORKSHOP,
    turns: [
      {
        say: "Add the OSB for the top to what I want: 2 sheets of 18 mm, £24.50 a sheet at Wickes, https://www.wickes.co.uk/example-osb-18mm",
        expect: [],
        things: [
          {
            action: "add",
            name: ["osb"],
            fields: { status: ["want"], price: ["24.50"], shop: ["wickes"] },
            history: [["wickes.co.uk"]],
          },
        ],
      },
    ],
  },
  {
    // The garage build saved items ordered for collection as have (#700).
    name: "thing-ordered-stays-want",
    rule: "something ordered and not yet in hand stays want, the order in its history (#700)",
    ...WORKSHOP,
    files: {
      ...WORKSHOP.files,
      "things/osb-18-mm.md":
        "---\nname: OSB 18 mm, 2 sheets\nstatus: want\nprice: £24.50\nshop: Wickes\n---\n",
    },
    turns: [
      {
        say: "Ordered both OSB sheets from Wickes for collection on Saturday, £49 all in.",
        expect: [],
        things: [
          { action: "change", name: ["osb"], fields: { status: ["want"] }, history: [["order"]] },
        ],
      },
    ],
  },
  {
    // Two garage build sessions opened on a next step the real work had overtaken (#700).
    name: "project-steps-current",
    rule: "the project keeps up with the work: steps the owner has done marked done, and the step they're really on added (#700)",
    ...WORKSHOP,
    turns: [
      {
        say: "Legs are cut and the frame's screwed together. I'm gluing up the worktop boards now. How long should the clamps stay on?",
        expect: [],
        projects: [
          {
            action: "change",
            name: ["workbench"],
            // The step they're on is a step, not only a line in its history.
            words: [
              "done: cut the legs",
              "done: fix the frame",
              ["can do this] glu", "can do this] worktop", "can do this] clamp"],
            ],
          },
        ],
      },
    ],
  },
];
