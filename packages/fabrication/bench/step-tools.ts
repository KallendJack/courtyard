import type { StepTool } from "../build.ts";
import { bitInSets, TOOL_NAMES, type Tool } from "../tools.ts";
import { PILOT } from "./close-ups.ts";
import type { Draft } from "./preparing.ts";

// A step's tools as the steps say them (#763): each against what's to hand, what will do for one
// the owner hasn't (a step stool), and drill bits by the size the step drills with.

/** A step's tool, set against the owner's: to hand, by a stand-in, and its bits. */
export const stepToolsOf =
  (owner: {
    toHand: ReadonlySet<Tool>;
    /** The tools to hand only as something else the owner has, by its name. */
    standIns: ReadonlyMap<Tool, string>;
    /** The sizes the owner's drill bit sets are kept with. */
    bitSets: readonly string[];
  }) =>
  (draft: Draft) =>
  (tool: Tool): StepTool => {
    const standIn = owner.standIns.get(tool);
    // Every step that drills makes 3 mm pilot holes, unless it says it drills another size.
    const bits =
      tool === "drill-bits"
        ? (draft.bits ?? [{ mm: PILOT, for: "pilot holes" }]).map((bit) => {
            const have = bitInSets(owner.bitSets, bit.mm);
            return have === undefined ? bit : { ...bit, have };
          })
        : undefined;
    return {
      tool,
      name: TOOL_NAMES[tool],
      toHand: owner.toHand.has(tool),
      ...(standIn === undefined ? {} : { standIn }),
      ...(bits === undefined ? {} : { bits }),
    };
  };
