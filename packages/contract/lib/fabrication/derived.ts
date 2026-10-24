import { z } from "zod";

// What `packages/fabrication` derives for a Build, as Fabrication shows it (#698): the engine's
// `Build` (its `build.ts`), checked here so the app parses what crosses rather than trusting it,
// and the worker's compiler checks the engine still gives it. Only what a screen reads is named;
// the rest (each step's actions, close-ups, the glossary) crosses too, and is added here when a
// screen first needs it (#699).

/** A list as the engine gives it, never changed once worked out. */
const list = <T extends z.ZodType>(item: T) => z.array(item).readonly();

/** A piece's place in the 3D view, in mm: `x` along, `y` back from the front, `z` up. */
export const BuildBox = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
  d: z.number(),
  h: z.number(),
});
export type BuildBox = z.infer<typeof BuildBox>;

/** A part, once for all its pieces: its label, what it does, its cut size and its boxes. */
export const BuildPart = z.object({
  label: z.string(),
  name: z.string(),
  does: z.string(),
  count: z.number().int(),
  material: z.object({ kind: z.enum(["timber", "sheet", "printed"]), stock: z.string() }),
  length: z.number(),
  width: z.number(),
  thickness: z.number(),
  boxes: list(BuildBox),
});
export type BuildPart = z.infer<typeof BuildPart>;

/** The cut plan: each timber's lengths with their cuts, each sheet's pieces where they sit. */
export const BuildCutPlan = z.object({
  kerf: z.number(),
  timber: list(
    z.object({
      stock: z.string(),
      stockLength: z.number(),
      lengths: list(
        z.object({
          cuts: list(z.object({ label: z.string(), length: z.number() })),
          used: z.number(),
          offcut: z.number(),
        }),
      ),
    }),
  ),
  sheets: list(
    z.object({
      stock: z.string(),
      sheetLength: z.number(),
      sheetWidth: z.number(),
      sheets: list(
        z.object({
          pieces: list(
            z.object({
              label: z.string(),
              x: z.number(),
              y: z.number(),
              along: z.number(),
              across: z.number(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type BuildCutPlan = z.infer<typeof BuildCutPlan>;

export const BuildBuyLine = z.object({
  item: z.string(),
  kind: z.enum(["timber", "sheet", "fitted", "fixing"]),
  for: z.string(),
  needed: z.number(),
  packOf: z.number(),
  packs: z.number(),
  price: z
    .object({ pence: z.number(), shop: z.string().optional(), link: z.string().optional() })
    .optional(),
  total: z.number().optional(),
});
export type BuildBuyLine = z.infer<typeof BuildBuyLine>;

const StepTool = z.object({ tool: z.string(), name: z.string(), toHand: z.boolean() });

export const BuildStep = z.object({
  number: z.number().int(),
  title: z.string(),
  minutes: z.number(),
  helper: z.boolean(),
  parts: list(z.string()),
  tools: list(StepTool),
  safety: list(StepTool),
});
export type BuildStep = z.infer<typeof BuildStep>;

/** What the making rules found (ADR 0036). */
export const BuildFinding = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixing-too-short"),
    fixing: z.string(),
    length: z.number(),
    needed: z.number(),
    through: list(z.object({ what: z.string(), mm: z.number() })),
    use: z.number(),
  }),
  z.object({
    kind: z.literal("tools-missing"),
    tools: list(z.object({ tool: z.string(), name: z.string(), steps: list(z.number().int()) })),
  }),
  z.object({ kind: z.literal("too-big-for-stock"), label: z.string(), stock: z.string() }),
  z.object({ kind: z.literal("assumed"), sizes: list(z.string()) }),
]);
export type BuildFinding = z.infer<typeof BuildFinding>;

/** Everything a Build shows, worked out from its template and parameters. */
export const DerivedBuild = z.object({
  template: z.string(),
  size: z.object({ length: z.number(), depth: z.number(), height: z.number() }),
  parts: list(BuildPart),
  fitted: list(z.object({ name: z.string(), boxes: list(BuildBox) })),
  cutPlan: BuildCutPlan,
  buyList: z.object({ lines: list(BuildBuyLine), total: z.number(), unpriced: z.number() }),
  steps: list(BuildStep),
  findings: list(BuildFinding),
});
export type DerivedBuild = z.infer<typeof DerivedBuild>;
