import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import { END_FRAME } from "./attachments.ts";
import type { Scenario, Words } from "./scenarios.ts";

// At the bench (#784): the owner on a step of their Build, asking about it. The chat follows the
// step it is given in full, its way, numbers, screws and check, never one it makes up. Everything
// here is invented: the golden bench and made-up tools.

/** One of the owner's tools, as Your tools would have saved it (#707). */
const toolFile = (name: string, count?: number) =>
  `---\nname: ${name}\nstatus: have\nkind: tool\n${count === undefined ? "" : `count: ${count}\n`}---\n`;

/**
 * A made-up workshop's bench, the golden bench, with the owner at its end frames, the first two
 * lines ticked, and their own tools saved (#784): a speed square and two F-clamps, so a generic
 * square or four clamps is a miss.
 */
const AT_END_FRAMES: Pick<Scenario, "workspace" | "context" | "files" | "ownerFiles"> = {
  workspace: "Workshop",
  context: { facts: ["A single garage, used as a workshop"] },
  files: {
    "builds/workbench.json": `${JSON.stringify(
      { name: "Workbench", template: "framed-bench", parameters: goldenBench },
      null,
      2,
    )}\n`,
    "builds/progress/workbench.json": `${JSON.stringify({
      step: "end-frames",
      ticked: [{ step: "end-frames", lines: [0, 1] }],
    })}\n`,
  },
  ownerFiles: {
    "things/speed-square.md": toolFile("Speed square"),
    "things/f-clamps.md": toolFile("F-clamps", 2),
    "things/drill-driver.md": toolFile("Drill driver"),
    "things/drill-bits.md": toolFile("Drill bits"),
    "things/tape-measure.md": toolFile("Tape measure"),
    "things/pencil.md": toolFile("Pencil"),
    "things/safety-glasses.md": toolFile("Safety glasses"),
  },
};

/** Giving a screw a measured spot, as the first build's "47 in" and "94 × 94" did (#784). */
const MEASURED_SPOTS: readonly Words[] = [["47"], ["94"], ["15 mm"], ["30 mm"], ["mm in from"]];

/** A step the owner is on, followed rather than made up (#784): each at the end frames. */
export const AT_THE_BENCH: readonly Scenario[] = [
  {
    name: "bench-step-screw-spots",
    rule: "asked where the end frame's screws go, the answer gives the step's spots, two by eye in each overlap, never a measured spot (#784)",
    ...AT_END_FRAMES,
    turns: [
      {
        say: "Where exactly do the screws go on this end frame?",
        expect: [],
        says: [
          ["2", "two"],
          ["overlap", "where the rail", "over the leg", "crosses"],
        ],
        omits: MEASURED_SPOTS,
        words: { atMost: 150 },
        builds: { action: "none" },
      },
    ],
  },
  {
    name: "bench-step-legs-on-edge",
    rule: "shown the end frame laid out with its legs on edge, as the step has them, the answer confirms it rather than turning them flat (#784)",
    ...AT_END_FRAMES,
    turns: [
      {
        say: "Here's the first end frame laid out, the legs on their narrow edges. Is that right before I clamp it?",
        attach: [END_FRAME],
        expect: [],
        says: [["edge"]],
        omits: [["roll"], ["quarter turn"], ["quarter-turn"], ["turn them", "flat"]],
        words: { atMost: 150 },
        builds: { action: "none" },
      },
    ],
  },
  {
    name: "bench-step-clamp",
    rule: "asked how to clamp the end frame, the answer gives the step's one way with the owner's two F-clamps, never another way or a count of its own (#784)",
    ...AT_END_FRAMES,
    turns: [
      {
        say: "How should I clamp this?",
        expect: [],
        says: [["clamp"], ["square"]],
        omits: [
          ["four clamps"],
          ["4 clamps"],
          ["three clamps"],
          ["not needed"],
          ["don't need", "clamp"],
          ["optional"],
        ],
        words: { atMost: 150 },
        builds: { action: "none" },
      },
    ],
  },
  {
    name: "bench-step-check-square",
    rule: "asked how to check the end frame is square, the answer gives the step's one check, corner to corner within 2 mm, and no other (#784)",
    ...AT_END_FRAMES,
    turns: [
      {
        say: "How do I check it's square?",
        expect: [],
        says: [
          ["corner to corner", "diagonal"],
          ["2 mm", "2mm"],
        ],
        omits: [["3-4-5"], ["3, 4, 5"], ["pythag"], ["another way"], ["or use"]],
        words: { atMost: 150 },
        builds: { action: "none" },
      },
    ],
  },
];
