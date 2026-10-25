import { z } from "zod";
import { ChangeId } from "../change-id.ts";
import {
  THING_FIELD_MAX_CHARACTERS,
  ThingCount,
  ThingProblem,
  ThingSlug,
  ThingSummary,
} from "../things.ts";
import { WorkspaceId } from "../workspace-summary.ts";

// The owner's tools (ADR 0037, #707): Fabrication owns them, Courtyard hosts them as Things of kind
// tool at the owner's level, so every workspace and every Build sees the same ones. Your tools, in
// Fabrication, ticks them once; Build steps and "not to hand" read them.

/**
 * The common tools Your tools offers as tiles to tick, in its four groups, each tile by the name
 * its tool is saved with. Any other is the owner's own, added by name.
 */
export const COMMON_TOOLS = [
  { group: "Cutting", tools: ["Hand saw", "Circular saw", "Jigsaw", "Mitre saw"] },
  {
    group: "Holding and measuring",
    tools: ["Workmate", "Clamps", "Square", "Tape, pencil", "Sawhorses", "Spirit level"],
  },
  {
    group: "Drilling and fixing",
    tools: ["Drill / driver", "Impact driver", "Screwdrivers", "Hammer"],
  },
  { group: "Finishing and printing", tools: ["Sandpaper", "Sander", "3D printer"] },
] as const;

/** The tile that asks which one, so the printer that makes printed parts is known (#702). */
export const PRINTER_TOOL = "3D printer";

/** One line of free text, as a tool's name, make and size are. */
const oneLine = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Give the ${what}.`)
    .max(
      THING_FIELD_MAX_CHARACTERS,
      `Keep the ${what} to ${THING_FIELD_MAX_CHARACTERS} characters.`,
    )
    .refine((text) => !/[\r\n]/.test(text), `Keep the ${what} to one line.`);

/** A Thing in a workspace, by the workspace and the Thing's file name. */
export const WorkspaceThing = z.object({ workspace: WorkspaceId, thing: ThingSlug });
export type WorkspaceThing = z.infer<typeof WorkspaceThing>;

/**
 * One tool the owner has, as Your tools saves it: its name (a tile's, or their own), how many when
 * it's more than one, and its make and size (the 3D printer's model, its plate and clearance).
 * `from` is a workspace's Thing it moves from, which goes with the save.
 */
export const ToolPick = z.object({
  name: oneLine("tool's name"),
  count: ThingCount.optional(),
  brand: oneLine("make and model").optional(),
  size: oneLine("size").optional(),
  from: WorkspaceThing.optional(),
});
export type ToolPick = z.infer<typeof ToolPick>;

/**
 * A workspace's Thing that looks like one of the owner's tools (the garage's hand saw), which Your
 * tools comes with ticked, so it moves to the owner's tools with their Save: the tool it'd be, and
 * where it is now.
 */
export const FoundTool = z.object({
  tool: ToolPick.required({ from: true }),
  /** The workspace's name, and the Thing's, as the owner knows them. */
  workspaceName: z.string(),
  thingName: z.string(),
});
export type FoundTool = z.infer<typeof FoundTool>;

/**
 * The owner's tools, Things of kind tool in order of name; the files that can't be read as one;
 * whether they've saved any yet; and the workspaces' Things that look like tools, to move.
 */
export const YourTools = z.object({
  tools: z.array(ThingSummary),
  problems: z.array(ThingProblem),
  saved: z.boolean(),
  found: z.array(FoundTool),
});
export type YourTools = z.infer<typeof YourTools>;

/** The most tools Your tools saves at once. */
export const TOOLS_MAX = 100;

/** Your tools' Save: every tool the owner has now, so one not given is one they don't. */
export const ToolsChange = z.object({ tools: z.array(ToolPick).max(TOOLS_MAX) });
export type ToolsChange = z.infer<typeof ToolsChange>;

/** The owner's tools saved, and the change that saved them, which Undo names. */
export const ToolsSaved = z.object({ change: z.nullable(ChangeId), tools: YourTools });
export type ToolsSaved = z.infer<typeof ToolsSaved>;

/** Undo of a save of the owner's tools, by its change. */
export const ToolsUndo = z.object({ change: ChangeId });
export type ToolsUndo = z.infer<typeof ToolsUndo>;

/** The longest "Or just say it" a model is asked to read. */
export const TOOLS_SAID_MAX_CHARACTERS = 2000;

/** What the owner said or typed under "Or just say it", for a model to tick. */
export const ToolsSaid = z.object({
  said: z
    .string()
    .trim()
    .min(1, "Say which tools you have.")
    .max(TOOLS_SAID_MAX_CHARACTERS, `Keep it to ${TOOLS_SAID_MAX_CHARACTERS} characters.`),
});
export type ToolsSaid = z.infer<typeof ToolsSaid>;

/** The tools a model heard, for the owner to check before Save; nothing is saved. */
export const ToolsHeard = z.object({ tools: z.array(ToolPick.omit({ from: true })) });
export type ToolsHeard = z.infer<typeof ToolsHeard>;
