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

/** Another AI's plan for the workshop's bench, pasted in by the owner (#700). */
const PASTED_PLAN = [
  "Tools you'll use: circular saw, router, pocket-hole jig, orbital sander.",
  "Materials: four 2.4 m lengths of 3×2 CLS, one sheet of 18 mm OSB, 70 mm screws.",
  "Size: 180 × 60 cm top, 90 cm high.",
  "Steps: cut the legs, build two frames, join them with rails, fix the top.",
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
  ["photo"],
  ["picture"],
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
        say: "Right, what do I need to get to build the bench this weekend?",
        expect: [],
        avoids: TOOLS_ASKED,
        things: [],
      },
    ],
  },
  {
    name: "planning-sizes-in-project",
    rule: "a design's sizes saved on its project are read and used, never said to be missing (#700)",
    ...WORKSHOP,
    turns: [
      {
        say: "How long do I cut the bench legs?",
        expect: [],
        says: [["88", "90"]],
        avoids: [["how tall"], ["how high"], ["what height"], ["what size"], ["dimensions"]],
      },
    ],
  },
  {
    name: "planning-go-ahead",
    rule: "when the owner wants to get on, the answer goes ahead with the next step, without circling back or making a requirement of what they don't need (#700)",
    ...WORKSHOP,
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
        // A question the caveat doesn't bear on, so saying it again is only a repeat.
        say: "Got a 7 mm masonry bit and brown plugs. How deep do I drill each hole?",
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
    name: "planning-pasted-plan-is-ideas",
    rule: "a plan pasted from another AI is ideas: none of its tools saved as the owner's, nothing in it saved as decided (#700)",
    ...WORKSHOP,
    turns: [
      {
        say: `Another AI gave me this plan for the bench:\n\n${PASTED_PLAN}`,
        expect: [],
        things: [],
        projects: [],
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
        words: { atMost: 120 },
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
            words: ["done: cut the legs", "done: fix the frame", ["glu", "worktop"]],
          },
        ],
      },
    ],
  },
];
