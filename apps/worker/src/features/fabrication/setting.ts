import { BuildProgress, type BuildStep, stepDone } from "@courtyard/contract";
import { readThingsIn } from "../things/index.ts";

// What a Build is worked out with besides its parameters (#777): the owner's tools, which its
// steps follow, and its progress as read from its file (#699), with the ways its steps done were
// done, which `index.ts` works the Build out with and `progress.ts` keeps.

/**
 * The owner's tools as a Build's steps follow them: each by its name and its tile's, or none when
 * they've saved none (or they can't be read just now), so a Build follows its own.
 */
export const toolsToHand = async (contextDir: string): Promise<string[] | undefined> => {
  // `readThingsIn` reads a folder's `things`, which for the context folder is the owner's.
  const read = await readThingsIn(contextDir);
  if (!read.ok) return undefined;
  const tools = read.value.things.filter(({ summary }) => summary.kind === "tool");
  if (tools.length === 0) return undefined;
  return tools.flatMap(({ summary }) => [
    summary.name,
    ...(summary.tile === undefined ? [] : [summary.tile]),
  ]);
};

/** Where a Build's steps start. */
export const NOT_STARTED: BuildProgress = { step: null, ticked: [], ways: [] };

/**
 * A Build's progress as kept: where it starts when there's none, or its file can't be read as
 * progress (a hand edit, say, or one kept by step number before steps had IDs), since the steps
 * are still there to follow and re-ticking a few lines is no loss.
 */
export const progressOf = (text: string | undefined): BuildProgress => {
  if (text === undefined) return NOT_STARTED;
  try {
    return BuildProgress.safeParse(JSON.parse(text)).data ?? NOT_STARTED;
  } catch {
    return NOT_STARTED;
  }
};

/**
 * The ways the steps done were done, as `progress` ticks them: each step with every line ticked
 * keeps the way the Build now does it (which, once kept, is the way it was done); a step not done
 * follows the tools again. A step the Build doesn't have now keeps its way, for when it comes back.
 */
export const keptWays = (options: {
  steps: readonly Pick<BuildStep, "id" | "actions" | "ways">[];
  progress: BuildProgress;
  before: BuildProgress["ways"];
}): BuildProgress["ways"] => [
  ...options.before.filter(({ step }) => !options.steps.some(({ id }) => id === step)),
  ...options.steps.flatMap((step) => {
    const using = step.ways.find((way) => way.using);
    return using !== undefined && stepDone(options.progress, step)
      ? [{ step: step.id, tool: using.tool }]
      : [];
  }),
];
