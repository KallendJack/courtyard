import { join } from "node:path";
import { BuildProgress, type BuildStep, type ThingSummary, tickedIn } from "@courtyard/contract";
import { type Build, type BuildSetting, Tool } from "@courtyard/fabrication";
import { err, ok, type Result } from "../../lib/result.ts";
import { readThingsIn } from "../things/index.ts";
import { listWorkspaces } from "../workspaces/index.ts";
import { heldIn } from "./stock/index.ts";
import type { ToolsRefusal } from "./tools.ts";

// What a Build is worked out with besides its parameters (#777, #763): the owner's tools and
// things, which its steps and buy list follow, and its progress as read from its file (#699), with
// the ways its steps started were done and the tools chosen to buy, which `index.ts` works the
// Build out with and `progress.ts` keeps.

/**
 * The owner's tools, in order of name, and the files there that can't be read as a Thing. Here
 * rather than in `tools.ts`, which reaches the prompts, so reading a Build never does.
 */
export const readTools = async (contextDir: string) => {
  // `readThingsIn` reads a folder's `things`, which for the context folder is the owner's.
  const read = await readThingsIn(contextDir);
  if (!read.ok) return err<ToolsRefusal>({ kind: "storage" });
  return ok({
    tools: read.value.things.filter(({ summary }) => summary.kind === "tool"),
    problems: read.value.problems,
  });
};

/** What every Build is worked out with from the owner's things, before its own progress. */
export type OwnerSetting = Pick<BuildSetting, "tools" | "sizes" | "have" | "stock">;

/**
 * What a Build's steps and buy list follow from the owner's things (#777, #780, #763): Your tools,
 * each by its name and its tile's, with the sizes they gave (a mitre saw's cutting capacity, a bit
 * set's sizes), or none when they've saved none (or they can't be read just now), so a Build
 * follows its own; Your stock (#760), which comes off its buy list; and what they have in their
 * planning workspaces and stock, by name, which can stand in for a tool (a step stool) or be bolts
 * too short.
 */
export const ownerSetting = async (contextDir: string): Promise<OwnerSetting> => {
  const read = await readThingsIn(contextDir);
  const owned = read.ok ? read.value.things : [];
  const stock = heldIn(owned);
  const have = [...(await thingsHad(contextDir)), ...stock.map(({ name }) => name)];
  const tools = owned.filter(({ summary }) => summary.kind === "tool");
  if (tools.length === 0) return { have, stock };
  const namesOf = ({ summary }: { summary: ThingSummary }) => [
    summary.name,
    ...(summary.tile === undefined ? [] : [summary.tile]),
  ];
  return {
    tools: tools.flatMap(namesOf),
    sizes: tools.flatMap((tool) => {
      const { size } = tool.summary;
      return size === undefined ? [] : namesOf(tool).map((name) => ({ name, size }));
    }),
    have,
    stock,
  };
};

/** The names of the Things the owner has in their planning workspaces; none when unreadable. */
const thingsHad = async (contextDir: string): Promise<string[]> => {
  const workspaces = await listWorkspaces(contextDir);
  if (!workspaces.ok) return [];
  const names: string[] = [];
  for (const workspace of workspaces.value) {
    if (workspace.mode !== "planning") continue;
    const read = await readThingsIn(join(contextDir, workspace.id));
    if (!read.ok) continue;
    for (const { summary } of read.value.things) {
      if (summary.status === "have") names.push(summary.name);
    }
  }
  return names;
};

/** Where a Build's steps start. */
export const NOT_STARTED: BuildProgress = {
  step: null,
  ticked: [],
  ways: [],
  buying: [],
  parked: [],
};

/**
 * What a Build is worked out with: the owner's things, the ways its steps were done, the steps
 * started, which keep their lines (#783), and the tools its progress keeps to buy, as its steps name
 * them (any other is dropped).
 */
export const settingOf = (owner: OwnerSetting, progress: BuildProgress): BuildSetting => ({
  ...owner,
  kept: progress.ways,
  started: startedIn(progress),
  buying: progress.buying.flatMap((tool) => {
    const named = Tool.safeParse(tool);
    return named.success ? [named.data] : [];
  }),
});

/**
 * A Build's progress as kept: where it starts when there's none, or its file can't be read as
 * progress (a hand edit, say, or one kept by step number before steps had IDs), since the steps
 * are still there to follow and re-ticking a few lines is no loss. `waysKept` is false for a file
 * kept before the ways its steps were done were (#777).
 */
const progressOf = (text: string | undefined): { progress: BuildProgress; waysKept: boolean } => {
  const none = { progress: NOT_STARTED, waysKept: true };
  if (text === undefined) return none;
  try {
    const kept: unknown = JSON.parse(text);
    const progress = BuildProgress.safeParse(kept).data;
    if (progress === undefined) return none;
    return { progress, waysKept: typeof kept === "object" && kept !== null && "ways" in kept };
  } catch {
    return none;
  }
};

/**
 * A Build's progress as kept, with the ways its steps started were done. A file kept before those
 * were (#777) gets the ways the Build's own tools gave its steps then (`own`, the Build worked out
 * without Your tools), so a step started with the hand saw stays so when a mitre saw comes.
 */
export const progressIn = (
  text: string | undefined,
  own: (started: readonly string[]) => Result<{ derived: Pick<Build, "steps"> }, string>,
): BuildProgress => {
  const { progress, waysKept } = progressOf(text);
  if (waysKept || progress.ticked.length === 0) return progress;
  const built = own(startedIn(progress));
  if (!built.ok) return progress;
  return {
    ...progress,
    ways: keptWays({ steps: built.value.derived.steps, progress, before: [] }),
  };
};

/** The steps with a line ticked, by ID: each keeps the lines it was started on (#783). */
export const startedIn = (progress: BuildProgress): string[] =>
  progress.ticked.filter(({ lines }) => lines.length > 0).map(({ step }) => step);

/**
 * The ways the steps started were done, as `progress` ticks them: each step with a line ticked
 * keeps the way the Build now does it (which, once kept, is the way it was started), or the lines
 * it has now when they're ones it keeps (#783), so its ticks stay on the lines they were ticked
 * on; a step with none ticked follows the tools again. A step the Build doesn't have now keeps
 * its way, for when it comes back.
 */
export const keptWays = (options: {
  steps: readonly (Pick<BuildStep, "id" | "ways"> & { readonly lines?: string | undefined })[];
  progress: BuildProgress;
  before: BuildProgress["ways"];
}): BuildProgress["ways"] => [
  ...options.before.filter(({ step }) => !options.steps.some(({ id }) => id === step)),
  ...options.steps.flatMap((step) => {
    const kept = step.ways.find((way) => way.using)?.tool ?? step.lines;
    return kept !== undefined && tickedIn(options.progress, step.id).length > 0
      ? [{ step: step.id, tool: kept }]
      : [];
  }),
];
