import type { Box } from "../build.ts";
import type { Scene, SceneMark, ScenePiece } from "../scene.ts";
import { markedLengths, ticksOf } from "./preparing.ts";
import {
  at,
  box,
  CLEAR,
  JAWS,
  nameOf,
  OUT,
  part,
  type SceneSetting,
  SUPPORT_IN,
  sectionOf,
  toolIf,
  whole,
  workmate,
} from "./scene-pieces.ts";

// The pictures of the steps before anything is joined (#754, #777): the length marked on the
// Workmate, and its first cut with the saw in use, by hand in the Workmate's jaws, with a circular
// saw clamped down, or on a mitre saw's bed. Only the tools to hand are drawn; where one isn't, its
// place is still marked.

/** A mitre saw's base, as a picture: how long, deep and high its bed is. */
const MITRE = { length: 500, depth: 450, bed: 100 } as const;

/** The first length marked, flat on the Workmate: the tape hooked on its end, a tick at each piece. */
export const markScene = (setting: SceneSetting): Scene => {
  const length = markedLengths(setting.cutPlan)[0];
  const first = length?.cuts[0];
  if (length === undefined || first === undefined) return whole(setting, []);
  const { wide, thick } = sectionOf(setting, length.stock);
  const top = JAWS.top;
  const ticks = ticksOf(length);
  const last = ticks.at(-1)?.at ?? 0;
  const square = ticks[0]?.at ?? 0;
  const benched = setting.toHand.has("folding-workbench");
  return {
    title: benched ? "On the Workmate" : "On something flat",
    // Along the length from its checked end, as the board has it, so it fills the picture.
    view: { turn: -50, tilt: 45 },
    pieces: [
      part(first.label, nameOf(setting, first.label), "lit", [
        box(0, 0, top - thick, length.stockLength, wide, thick),
      ]),
      ...toolIf(
        setting.toHand,
        "folding-workbench",
        workmate((length.stockLength - JAWS.length) / 2, wide),
      ),
      ...toolIf(setting.toHand, "tape-measure", [
        box(-3, 0, top - thick, 3, 25, thick + 3),
        box(last + 40, 10, top, 70, 70, 35),
      ]),
      ...toolIf(setting.toHand, "square", [
        box(square, -20, top - 30, 150, 20, 35),
        box(square, 0, top, 25, 200, 2),
      ]),
    ],
    marks: [
      ...ticks.map(
        (tick): SceneMark => ({
          kind: "line",
          from: at(tick.at, 0, top),
          to: at(tick.at, wide, top),
          says: `${tick.label} ${tick.length}`,
        }),
      ),
      ...ticks.map(
        (tick, index): SceneMark => ({
          kind: "size",
          from: at(0, -OUT * (index + 1), top),
          to: at(tick.at, -OUT * (index + 1), top),
          mm: tick.at,
        }),
      ),
      { kind: "note", at: at(0, wide / 2, top), says: "check this end is square", tone: "check" },
    ],
  };
};

/** How the saw in use holds and cuts the length: where it rests, the tools drawn, what's said. */
const sawing = (setting: SceneSetting, line: number, wide: number, thick: number) => {
  const benched = setting.toHand.has("folding-workbench");
  const held = line - CLEAR - JAWS.length;
  const kerf = setting.cutPlan.kerf;
  const saw = line + kerf / 2;
  const tools: ScenePiece[] = [];
  const add = (tool: Parameters<typeof toolIf>[1], boxes: Box[]) =>
    tools.push(...toolIf(setting.toHand, tool, boxes));
  switch (setting.saw) {
    case "mitre-saw": {
      // On the Workmate when it's to hand, else on the floor; the length on the saw's bed.
      const under = benched ? JAWS.top : 0;
      const top = under + MITRE.bed + thick;
      const from = line - MITRE.length / 2;
      add("folding-workbench", workmate(line - JAWS.length / 2, wide));
      add("mitre-saw", [
        box(from, -MITRE.depth / 3, under, MITRE.length, MITRE.depth, MITRE.bed),
        box(from, wide, under + MITRE.bed, MITRE.length, 20, 80),
        box(saw - 1, -40, top, 2, wide + 80, 160),
        box(saw - 60, -40, top + 160, 120, wide + 80, 90),
      ]);
      return {
        title: "On the mitre saw",
        top,
        tools,
        saw: "blade on the waste side of the line",
        held: { at: at(line - 200, wide + 20, top), says: "tight against the fence" },
      };
    }
    case "circular-saw": {
      const top = JAWS.top;
      add("folding-workbench", workmate(held, wide));
      add("circular-saw", [box(line - 230, -30, top, 240, wide + 60, 90)]);
      return {
        title: benched ? "Clamped on the Workmate" : "Clamped down",
        top,
        tools,
        saw: "saw here, just past the line",
        held: { at: at(line - 400, wide / 2, top), says: "clamp here" },
      };
    }
    case "hand-saw": {
      const top = JAWS.top;
      add("folding-workbench", workmate(held, wide));
      add("hand-saw", [box(saw - 1, -60, top, 2, wide + 120, 110)]);
      return {
        title: benched ? "In the Workmate" : "Cutting the length",
        top,
        tools,
        saw: "saw here, just past the line",
        held: { at: at(held + JAWS.length / 2, -JAWS.width, top / 2), says: "clamped in the jaws" },
      };
    }
  }
};

/**
 * The first cut of the first length, with the saw in use: the piece held with the line just past
 * where it's held, the long end on a support, the offcut beyond.
 */
export const cutScene = (setting: SceneSetting): Scene => {
  const plan = setting.cutPlan.timber[0];
  const cut = plan?.lengths[0]?.cuts[0];
  if (plan === undefined || cut === undefined) return whole(setting, []);
  const { wide, thick } = sectionOf(setting, plan.stock);
  const line = cut.length;
  const total = plan.stockLength;
  const saw = line + setting.cutPlan.kerf / 2;
  const sawn = sawing(setting, line, wide, thick);
  const { top } = sawn;
  // The longer side sags as the cut goes through, so the support goes under it.
  const support = line >= total - line ? SUPPORT_IN - 50 : total - SUPPORT_IN - 50;
  return {
    title: sawn.title,
    // From the side and above, along the length, as the board has it.
    view: { turn: -50, tilt: 30 },
    pieces: [
      part(cut.label, nameOf(setting, cut.label), "lit", [
        box(0, 0, top - thick, line, wide, thick),
      ]),
      {
        kind: "offcut",
        name: "Offcut",
        label: null,
        tone: "plain",
        boxes: [box(line, 0, top - thick, total - line, wide, thick)],
      },
      ...sawn.tools,
      ...toolIf(setting.toHand, "long-end-support", [
        box(support, -200, 0, 100, wide + 400, top - thick),
      ]),
    ],
    // Each mark's words apart from the others': the size above the piece, the saw's arrow higher
    // still, where it's held by the saw and the waste side's at the offcut's far end.
    marks: [
      { kind: "size", from: at(0, 0, top + 200), to: at(line, 0, top + 200), mm: cut.length },
      { kind: "line", from: at(line, 0, top), to: at(line, wide, top), says: `cut at ${line}` },
      {
        kind: "arrow",
        from: at(saw, wide / 2, top + 450),
        to: at(saw, wide / 2, top),
        says: sawn.saw,
      },
      {
        kind: "note",
        at: at(support + 50, wide / 2, (top - thick) / 2),
        says: "support the long end here",
        tone: "plain",
      },
      { kind: "note", ...sawn.held, tone: "plain" },
      {
        kind: "note",
        at: at(total - SUPPORT_IN, wide / 2, top),
        says: "offcut · waste side",
        tone: "waste",
      },
    ],
  };
};
