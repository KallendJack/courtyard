import {
  COMMON_TOOLS,
  THING_COUNT_MAX,
  type ThingSummary,
  type ToolPick,
  type YourTools,
} from "@courtyard/contract";

/** The tools ticked on Your tools, in the order they were ticked, each once by its name. */
export type Picks = readonly ToolPick[];

/** A tool's name as compared: "clamps" is the Clamps tile. */
const keyOf = (name: string) => name.trim().toLowerCase();

const TILES: readonly string[] = COMMON_TOOLS.flatMap(({ tools }) => tools);

/** The pick for a tool by its name, when it's ticked. */
export const pickOf = (picks: Picks, name: string) =>
  picks.find((pick) => keyOf(pick.name) === keyOf(name));

/** The ticked tools that aren't a tile: the owner's own, in the order they were added. */
export const ownPicks = (picks: Picks) =>
  picks.filter((pick) => !TILES.some((tile) => keyOf(tile) === keyOf(pick.name)));

/** The tile a saved tool is ticked as: its own name, unless it's kept a tile beside it (F-clamps). */
const tileOf = (tool: ThingSummary) => tool.tile ?? tool.name;

/**
 * What Your tools opens with: the owner's tools as saved, then the workspaces' tools not among
 * them, ticked to move with the Save (the garage's hand saw).
 */
export const startingPicks = (tools: YourTools): Picks => {
  const saved = tools.tools.map(
    (tool): ToolPick => ({
      name: tileOf(tool),
      ...(tool.count === undefined ? {} : { count: tool.count }),
      ...(tool.brand === undefined ? {} : { brand: tool.brand }),
      ...(tool.size === undefined ? {} : { size: tool.size }),
    }),
  );
  for (const found of tools.found) {
    if (!pickOf(saved, found.tool.name)) saved.push(found.tool);
  }
  return saved;
};

/**
 * The line under a ticked tile, so the owner sees what Save keeps or moves: the workspace's Thing
 * it moves from ("F-clamps · from Garage"), or the owner's own name for a saved one ("F-clamps").
 */
export const tileNote = (tools: YourTools, pick: ToolPick) => {
  const { from } = pick;
  if (from !== undefined) {
    const found = tools.found.find(
      ({ tool }) => tool.from.workspace === from.workspace && tool.from.thing === from.thing,
    );
    return found && `${found.thingName} · from ${found.workspaceName}`;
  }
  const saved = tools.tools.find((tool) => keyOf(tileOf(tool)) === keyOf(pick.name));
  return saved !== undefined && saved.name !== tileOf(saved) ? saved.name : undefined;
};

/** Ticks a tool by its name, or unticks it when it's ticked. */
export const toggle = (picks: Picks, name: string): Picks =>
  pickOf(picks, name)
    ? picks.filter((pick) => keyOf(pick.name) !== keyOf(name))
    : [...picks, { name }];

/** One more, or one fewer, of a ticked tool: never below one, never above the most. */
export const recount = (picks: Picks, name: string, by: 1 | -1): Picks =>
  picks.map((pick) => {
    if (keyOf(pick.name) !== keyOf(name)) return pick;
    const count = Math.min(THING_COUNT_MAX, Math.max(1, (pick.count ?? 1) + by));
    const { count: _count, ...rest } = pick;
    return count === 1 ? rest : { ...rest, count };
  });

/**
 * A ticked tool's make and size, as the owner is typing them (the worker trims them): the 3D
 * printer's plate, a saw's cutting capacity (#780).
 */
export const describe = (
  picks: Picks,
  name: string,
  { brand, size }: { brand: string; size: string },
): Picks =>
  picks.map((pick) => {
    if (keyOf(pick.name) !== keyOf(name)) return pick;
    const { brand: _brand, size: _size, ...rest } = pick;
    return {
      ...rest,
      ...(brand.trim() === "" ? {} : { brand }),
      ...(size.trim() === "" ? {} : { size }),
    };
  });

/**
 * The tools a model heard, ticked: each by its tile when it's one, with the count it heard. What
 * was ticked already stays ticked.
 */
export const tickHeard = (picks: Picks, heard: readonly ToolPick[]): Picks => {
  const ticked = [...picks];
  for (const tool of heard) {
    const tile = TILES.find((one) => keyOf(one) === keyOf(tool.name));
    const name = tile ?? tool.name.trim();
    const count = tool.count !== undefined && tool.count > 1 ? { count: tool.count } : {};
    const at = ticked.findIndex((pick) => keyOf(pick.name) === keyOf(name));
    const there = ticked[at];
    if (there === undefined) ticked.push({ name, ...count });
    else ticked[at] = { ...there, ...count };
  }
  return ticked;
};

/** A tool's name as its tile shows it: "Clamps × 2". */
export const tileName = (pick: ToolPick) =>
  pick.count === undefined || pick.count === 1 ? pick.name : `${pick.name} × ${pick.count}`;

/** Whether the picks are the tools as saved, so Save has nothing to save. */
export const unchanged = (picks: Picks, tools: YourTools) =>
  picks.every((pick) => pick.from === undefined) &&
  picks.length === tools.tools.length &&
  picks.every((pick) => {
    const tool = tools.tools.find((one) => keyOf(tileOf(one)) === keyOf(pick.name));
    return (
      tool !== undefined &&
      (tool.count ?? 1) === (pick.count ?? 1) &&
      tool.brand === pick.brand &&
      tool.size === pick.size
    );
  });
