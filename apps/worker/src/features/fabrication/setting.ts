import { BuildProgress, type BuildStep, type ThingSummary, tickedIn } from "@courtyard/contract";
import type { Build, BuildSetting } from "@courtyard/fabrication";
import { err, ok, type Result } from "../../lib/result.ts";
import { readThingsIn } from "../things/index.ts";
import type { ToolsRefusal } from "./tools.ts";

// What a Build is worked out with besides its parameters (#777): the owner's tools, which its
// steps follow, and its progress as read from its file (#699), with the ways its steps started
// were done, which `index.ts` works the Build out with and `progress.ts` keeps.

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

/** The owner's tools as a Build is worked out with them, without the ways its steps were done. */
export type ToolsSetting = Pick<BuildSetting, "tools" | "sizes">;

/**
 * The owner's tools as a Build's steps follow them: each by its name and its tile's, with the
 * sizes they gave (a mitre saw's cutting capacity, #780); or none when they've saved none (or they
 * can't be read just now), so a Build follows its own.
 */
export const toolsToHand = async (contextDir: string): Promise<ToolsSetting> => {
  const read = await readTools(contextDir);
  if (!read.ok || read.value.tools.length === 0) return {};
  const namesOf = ({ summary }: { summary: ThingSummary }) => [
    summary.name,
    ...(summary.tile === undefined ? [] : [summary.tile]),
  ];
  return {
    tools: read.value.tools.flatMap(namesOf),
    sizes: read.value.tools.flatMap((tool) => {
      const { size } = tool.summary;
      return size === undefined ? [] : namesOf(tool).map((name) => ({ name, size }));
    }),
  };
};

/**
 * What a Build is worked out with: the owner's tools, the ways its steps started were done and
 * the steps started, which keep their lines (#783).
 */
export const settingFor = (tools: ToolsSetting, progress: BuildProgress): BuildSetting => ({
  ...tools,
  kept: progress.ways,
  started: startedIn(progress),
});

/** Where a Build's steps start. */
export const NOT_STARTED: BuildProgress = { step: null, ticked: [], ways: [] };

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
