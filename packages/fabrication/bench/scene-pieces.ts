import type { At, Box, CutPlan, Fitted, Part, Scene, SceneMark, ScenePiece } from "../build.ts";
import { TOOL_NAMES, type Tool } from "../tools.ts";
import type { Shape } from "./frame.ts";
import type { BenchParameters } from "./parameters.ts";

// What the steps' pictures (scenes.ts) are drawn with: the Build's parts as far as they're put
// on, the tools as simple boxes, and where things sit. The tools are only pictures, not the
// Build's numbers (a Workmate is about 600 long and 780 high), drawn only when they're to hand.
/** A folding workbench's jaws: how long, how wide and thick each is, and the height of their tops. */
export const JAWS = { length: 600, width: 90, thick: 25, top: 780 } as const;
/** How far short of the line the jaws hold the length, so the saw runs clear of them. */
export const CLEAR = 20;
/** How far in from its end the long end's support stands. */
export const SUPPORT_IN = 150;
/** Where a dimension line runs, out from the edge it measures. */
export const OUT = 50;

export const box = (x: number, y: number, z: number, w: number, d: number, h: number): Box => ({
  x,
  y,
  z,
  w,
  d,
  h,
});
export const at = (x: number, y: number, z: number): At => ({ x, y, z });
export const tenth = (mm: number) => Math.round(mm * 10) / 10;

export const part = (label: string, name: string, tone: ScenePiece["tone"], boxes: Box[]) =>
  ({ kind: "part", name, label, tone, boxes }) satisfies ScenePiece;

/** A tool, drawn only when it's to hand. */
export const toolIf = (toHand: ReadonlySet<Tool>, tool: Tool, boxes: Box[]): ScenePiece[] =>
  toHand.has(tool)
    ? [{ kind: "tool", name: TOOL_NAMES[tool], label: null, tone: "plain", boxes }]
    : [];

/** A folding workbench whose jaws run from `from` and grip something `gap` wide from y = 0. */
export const workmate = (from: number, gap: number): Box[] => {
  const { length, width, thick, top } = JAWS;
  const legs = (x: number) => box(x, -width, 0, 30, 2 * width + gap, top - thick);
  return [
    box(from, -width, top - thick, length, width, thick),
    box(from, gap, top - thick, length, width, thick),
    legs(from + 40),
    legs(from + length - 70),
  ];
};

export type SceneSetting = {
  parameters: BenchParameters;
  shape: Shape;
  parts: readonly Part[];
  fitted: readonly Fitted[];
  cutPlan: CutPlan;
  toHand: ReadonlySet<Tool>;
  /** The castor bolts' length as the steps fit them: the length to use when those given are short. */
  boltLength: number;
};

/** A timber's section, by its stock's name: how wide and thick it lies flat. */
export const sectionOf = (setting: SceneSetting, stock: string) =>
  stock === setting.parameters.frame.wide.name
    ? { wide: setting.shape.wideWidth, thick: setting.shape.wideThick }
    : { wide: setting.shape.wide, thick: setting.shape.thick };

export const nameOf = (setting: SceneSetting, label: string) =>
  setting.parts.find((each) => each.label === label)?.name ?? label;

/** The bench as far as it's built: the parts put on so far, this step's lit, the rest faint. */
export const soFar = (
  setting: SceneSetting,
  options: { shown?: ReadonlySet<string>; lit: ReadonlySet<string> },
): ScenePiece[] => {
  const shown = (label: string) => options.shown === undefined || options.shown.has(label);
  const tone = (label: string) =>
    options.shown === undefined ? "plain" : options.lit.has(label) ? "lit" : "built";
  return [
    ...setting.parts
      .filter((each) => shown(each.label))
      .map((each) => part(each.label, each.name, tone(each.label), [...each.boxes])),
    ...setting.fitted
      .filter((each) => shown(each.on))
      .map(
        (each): ScenePiece => ({
          kind: "fitted",
          name: each.name,
          label: null,
          tone: options.shown === undefined ? "plain" : "built",
          boxes: each.boxes,
        }),
      ),
  ];
};

/** The whole bench, nothing lit: what the pieces become, and the bench at the end. */
export const whole = (setting: SceneSetting, marks: SceneMark[]): Scene => ({
  title: "The finished bench",
  view: { turn: -35, tilt: 25 },
  pieces: soFar(setting, { lit: new Set() }),
  marks,
});
