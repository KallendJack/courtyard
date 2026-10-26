import type { CutPlan, Fitted, KeptWay, Part, Step } from "../build.ts";
import type { Capacities } from "../capacity.ts";
import { bracketArm, bracketCloseUp } from "../close-ups/bracket.ts";
import { overlapCloseUp } from "../close-ups/overlap.ts";
import { techniquesOf } from "../close-ups/techniques.ts";
import { type SpannerKit, type SquareKind, TOOL_NAMES, type Tool } from "../tools.ts";
import { castorsDraft } from "./castor-steps.ts";
import { braceCloseUp, SHEET_SCREWS_PER_BRACE, sheetCloseUp } from "./close-ups.ts";
import { type Shape, whole } from "./frame.ts";
import { bracketed, bracketScrewsOf, frameDrafts } from "./frame-steps.ts";
import type { BenchParameters } from "./parameters.ts";
import { act, CUT_STEP, type Draft, handedOn, preparingSteps, sawInUse } from "./preparing.ts";
import { nameOf, type SceneSetting, sectionOf } from "./scene-pieces.ts";
import { stepScene } from "./scenes.ts";
import {
  benchPilots,
  bracketing,
  drilling,
  SPLIT_RISK,
  SPLIT_TIP,
  screwing,
  wordsWith,
} from "./screws.ts";
import { stepToolsOf } from "./step-tools.ts";

// The framed bench's steps, in the order it's built, each said twice: "show me how" for a
// beginner and "just the numbers" for someone who knows how. Both come from here, with the
// Build's own numbers, each size to the whole mm; a model writes neither. The parts and cut plan
// don't depend on the tools; how a step is done does (a hand saw on a folding workbench, or a
// circular saw). Each step is the simplest way that holds and looks right (#789): at most four
// lines, measured only where it decides how it turns out, by eye elsewhere, extras as tips.

/** The bench's steps, numbered, with each tool set against the tools to hand. */
export const benchSteps = (options: {
  parameters: BenchParameters;
  shape: Shape;
  cutPlan: CutPlan;
  /** The castor bolts' length to use: the parameters', or the length to use when theirs are short. */
  boltLength: number;
  /** What each step's picture draws (#754). */
  parts: readonly Part[];
  fitted: readonly Fitted[];
  /** The tools to hand: the owner's, from Your tools, or else the parameters' own (#777). */
  toHand: ReadonlySet<Tool>;
  /** The tools to hand only as something else the owner has, by its name (#763). */
  standIns: ReadonlyMap<Tool, string>;
  /** The sizes the owner's drill bit sets are kept with. */
  bitSets: readonly string[];
  /** The ways the steps already started were done, which they keep. */
  kept: readonly KeptWay[];
  /** The steps with a line ticked, by ID: a step started keeps its lines (#783). */
  started: readonly string[];
  /** What the owner has that holds a bolt's head and turns its nut (#783). */
  kit: SpannerKit;
  /** What the owner's powered saws can cut (#780). */
  capacities: Capacities;
  /** The kind of square the owner has, which the close-ups draw (#813); none when not known. */
  square: SquareKind | undefined;
}): Step[] => {
  const { parameters: p, shape: s, cutPlan, toHand, kept } = options;
  const castors = p.castors;
  const saw = sawInUse(toHand, kept);
  // The saw the Build's own tools would cut with: a change from it is said, until cutting starts.
  const planned = sawInUse(new Set(p.tools));
  const sawChanged =
    saw === planned || kept.some((way) => way.step === CUT_STEP)
      ? null
      : { was: TOOL_NAMES[planned], now: TOOL_NAMES[saw] };
  const handed = handedOn({ ...options, saw, sectionOf: (stock) => sectionOf(options, stock) });
  const setting: SceneSetting = { ...options, saw, handed };
  const sheetScrews = p.fixings.sheetScrews.name;
  // Where a pilot hole goes first (#789).
  const pilots = benchPilots(p, s);
  /** Screws through a sheet into what it rests on, spaced by eye. */
  const sheetScrewing = (pilot: boolean, into: string, count: number) =>
    screwing(
      pilot,
      `Screw it down into ${into}: ${count} screws, spaced evenly by eye, two fingers in from the ends.`,
      `${count} screws.`,
    );
  const braces = (p.braces.ends ? 2 : 0) + (p.braces.rear ? 1 : 0);
  const shelfCloseUp = sheetCloseUp({
    title: "The shelf, from above",
    label: "H",
    length: s.shelfLength,
    width: s.frameDepth,
    along: [s.thick / 2, s.frameDepth - s.thick / 2],
    across: [s.shelfLength / 2],
    note: `${whole(s.shelfLength)} long: 2 mm to spare at each end frame.`,
  });
  const topCloseUp = sheetCloseUp({
    title: "The top, from above",
    label: "G",
    length: s.length,
    width: s.depth,
    along: [s.front + s.thick / 2, s.back - s.thick / 2],
    across: [s.left + s.wide + s.thick / 2, s.length / 2, s.right - s.wide - s.thick / 2],
    note: `${whole(s.overhang)} over the frame on every side.`,
  });
  /** Sheet screws: a sheet on what it rests on, a screwed overlap (#813). */
  const fixing = (name: string, count: number) => ({
    name,
    count,
    joint: "screwed-overlap" as const,
  });
  /** A sheet `thick` screwed down onto a rail's or leg's narrow face. */
  const sheetOn = (name: string, thick: number, under: string) =>
    overlapCloseUp({
      over: { across: 4 * s.thick, thick, name },
      under: { across: s.thick, thick: s.wide, name: under },
    });
  /** Screws driven into a rail or leg, as a piece of the frame timber. */
  const driving = (screw: string) => ({
    type: "driving-screw" as const,
    piece: { wide: s.wide, thick: s.thick, name: "rail" },
    screw,
  });
  const middle = whole(s.frameLength / 2);
  const rearInset = whole((s.frameLength - s.endRail) / 2);
  // Where the top's screws hit: the middle of the rails under it, from the top's edges.
  const railsIn = whole(s.overhang + s.thick / 2);

  const drafts: Draft[] = [
    ...preparingSteps({
      cutPlan,
      toHand,
      saw,
      handed,
      sectionOf: (stock) => sectionOf(setting, stock),
      nameOf: (label) => nameOf(setting, label),
    }),
    // The castors after the frames, so a spanner still to get doesn't hold up the day (#783).
    ...frameDrafts({
      parameters: p,
      shape: s,
      pilots,
      castors: castors ? castorsDraft({ ...options, castors, shape: s }) : null,
    }),
    {
      id: "fit-supports",
      on: true,
      title: "Fit the supports",
      minutes: 20,
      parts: p.shelf.on ? ["F", "D"] : ["F"],
      tools: ["tape-measure", "pencil", ...drilling(pilots.brackets)],
      safety: ["safety-glasses"],
      fixings: bracketed(p, p.shelf.on ? 4 : 2),
      batch: "One support at a time.",
      actions: [
        act(
          `Measure the middle of each upper long rail, ${middle} from its end, and mark it.`,
          `Middle: ${middle}.`,
        ),
        act(
          "Fit the top support (F) between them there, its top flush with the rails, with an angle bracket in the corner at each end.",
          "F flush, a bracket each end.",
        ),
        ...(p.shelf.on
          ? [act("Same for the shelf support (D) between the lower rails.", "D the same, below.")]
          : []),
        bracketing(pilots.brackets),
      ],
      // The support's side, and the rail it meets (#813).
      closeUps: [
        bracketCloseUp({
          upright: { across: s.wideWidth, deep: s.wideThick, name: "support" },
          flat: { across: s.wide, thick: s.thick, name: "rail" },
          arm: bracketArm(p.fixings.brackets.name),
        }),
      ],
      techniques: [
        { type: "measure-mark", piece: { wide: s.wide, thick: s.thick, name: "B" }, at: middle },
        driving(bracketScrewsOf(p)),
      ],
      check: {
        says: "Each support's top flush with its rails: run a hand across.",
        photo: "The supports in.",
      },
      words: wordsWith(pilots.brackets, "flush"),
    },
    {
      id: "fit-shelf",
      on: p.shelf.on,
      title: "Fit the shelf",
      minutes: 15,
      parts: ["H"],
      tools: drilling(pilots.shelf),
      safety: ["safety-glasses"],
      fixings: [fixing(sheetScrews, shelfCloseUp.fixings.length)],
      batch: "One rail at a time, then the support.",
      actions: [
        act(
          "Drop the shelf (H) in between the end frames, onto the lower rails. It has 2 mm to spare at each end.",
          "H onto the lower rails.",
        ),
        sheetScrewing(pilots.shelf, "the rails and the shelf support", shelfCloseUp.fixings.length),
      ],
      tips: [
        "Want it neater? Countersink the shelf's screws too, so nothing catches on their heads.",
        ...(pilots.shelf ? [] : [SPLIT_TIP]),
      ],
      closeUps: [shelfCloseUp, sheetOn("shelf", s.shelfSheet, "rail")],
      techniques: [driving(sheetScrews)],
      check: { says: "The shelf lies flat and doesn't rock.", photo: "The shelf in." },
      words: wordsWith(pilots.shelf),
    },
    {
      id: "fit-braces",
      on: braces > 0,
      title: "Fit the braces",
      minutes: 20,
      parts: ["J"],
      tools: [
        ...(p.braces.rear ? (["tape-measure"] as const) : []),
        "clamps",
        ...drilling(pilots.braces),
      ],
      safety: ["safety-glasses"],
      fixings: [fixing(sheetScrews, braces * SHEET_SCREWS_PER_BRACE)],
      batch: "One brace at a time.",
      actions: [
        ...(p.braces.ends
          ? [
              act(
                "Clamp an end brace (J) on the outside of each end frame, its top edge flush with the leg tops.",
                "J on each end, flush with the tops.",
              ),
            ]
          : []),
        ...(p.braces.rear
          ? [
              act(
                `Clamp the rear brace (J) on the back rails, ${rearInset} from each end: measure it at both ends.`,
                `Rear J ${rearInset} from each end.`,
              ),
            ]
          : []),
        screwing(
          pilots.braces,
          "Mark 2 crosses over the middle of each leg or rail, two fingers from the brace's top and bottom, by eye.",
          `${SHEET_SCREWS_PER_BRACE} screws a brace.`,
        ),
      ],
      tips: pilots.braces ? [] : [SPLIT_TIP],
      closeUps: [braceCloseUp(s), sheetOn("brace", s.braceSheet, "leg")],
      techniques: [driving(sheetScrews)],
      check: {
        says: "Push a top corner sideways: the frame doesn't sway.",
        photo: "The bench from a back corner.",
      },
      words: wordsWith(pilots.braces, "flush"),
    },
    {
      id: "fit-top",
      on: true,
      title: "Fit the top",
      minutes: 30,
      parts: ["G"],
      tools: ["tape-measure", "clamps", ...drilling(pilots.top), "countersink-bit", "sandpaper"],
      safety: ["safety-glasses"],
      fixings: [fixing(sheetScrews, topCloseUp.fixings.length)],
      batch: "One rail at a time: crosses, countersink, screws, then the next.",
      actions: [
        act(
          `Lay the top (G) on with ${whole(s.overhang)} over the frame on every side: measure it at each corner. Clamp it so it can't move.`,
          `G, ${whole(s.overhang)} over all round.`,
        ),
        act(
          `Mark ${topCloseUp.fixings.length} crosses over the rails and the top support (below), spaced evenly by eye, two fingers in from the ends. The rails' middles are ${railsIn} in from the top's edges.`,
          `${topCloseUp.fixings.length} crosses, ${railsIn} in.`,
        ),
        act(
          `${pilots.top ? "Drill a small 3 mm pilot hole at each cross, then countersink it" : "Countersink each cross"} a little with the countersink bit, and drive its screw until the head sits flush in the dip, so nothing catches on it.`,
          pilots.top ? "3 mm pilots, countersink, screws flush." : "Countersink, screws flush.",
        ),
        act(
          "Sand the top's edges and corners, the ones your hands touch, until they're smooth.",
          "Sand the edges.",
        ),
      ],
      tips: pilots.top ? [] : [SPLIT_TIP],
      closeUps: [topCloseUp, sheetOn("top", s.top, "rail")],
      techniques: [driving(sheetScrews)],
      check: {
        says: "The overhang the same all round, within 2 mm, and every screw head flush.",
        photo: "The top, from above.",
      },
      words: wordsWith(pilots.top, "countersink", "flush"),
    },
    {
      id: "check-bench",
      on: true,
      title: "Check the bench",
      minutes: 10,
      parts: [],
      tools: ["spirit-level", "tape-measure"],
      batch: "All at once.",
      actions: [
        act("Put the level on the top, along it and across it.", "Level both ways."),
        act(
          `Measure the height to the top: it should be ${whole(s.height)}.`,
          `${whole(s.height)} high.`,
        ),
      ],
      check: {
        says: castors
          ? "Level both ways, and it rolls without rocking."
          : "Level both ways, and it doesn't rock.",
        photo: "The finished bench.",
      },
    },
  ];

  const stepTool = stepToolsOf(options);
  const on = drafts.filter((draft) => draft.on);
  const techniques = techniquesOf(on, {
    square: options.square,
    marking: (["tape-measure", "pencil", "square"] as const).every((tool) => toHand.has(tool)),
    drill: toHand.has("drill-driver"),
    zone: SPLIT_RISK,
  });
  return on.map((draft, at) => ({
    id: draft.id,
    number: at + 1,
    title: draft.title,
    minutes: draft.minutes,
    helper: draft.helper ?? false,
    parts: draft.parts,
    adds: draft.adds ?? draft.parts,
    ways: draft.ways ?? [],
    ...(draft.lines === undefined ? {} : { lines: draft.lines }),
    wayChanged: draft.id === CUT_STEP ? sawChanged : null,
    tools: draft.tools.map(stepTool(draft)),
    safety: (draft.safety ?? []).map(stepTool(draft)),
    fixings: draft.fixings ?? [],
    batch: draft.batch,
    actions: draft.actions,
    tips: draft.tips ?? [],
    closeUps: draft.closeUps ?? (draft.closeUp === undefined ? [] : [draft.closeUp]),
    techniques: techniques[at] ?? [],
    walkThrough: draft.walkThrough ?? [],
    scene: stepScene(setting, {
      id: draft.id,
      shown: on.slice(0, at + 1).flatMap((each) => each.adds ?? each.parts),
      lit: draft.parts,
    }),
    check: draft.check,
    words: draft.words ?? [],
  }));
};
