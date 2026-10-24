import {
  COMMON_TOOLS,
  PRINTER_TOOL,
  THING_COUNT_MAX,
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

/**
 * What Your tools opens with: the owner's tools as saved, then the workspaces' tools not among
 * them, ticked to move with the Save (the garage's hand saw).
 */
export const startingPicks = (tools: YourTools): Picks => {
  const saved = tools.tools.map(
    (tool): ToolPick => ({
      name: tool.name,
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

/** The 3D printer's make and plate, as the owner is typing them (the worker trims them). */
export const describePrinter = (
  picks: Picks,
  { brand, size }: { brand: string; size: string },
): Picks =>
  picks.map((pick) => {
    if (keyOf(pick.name) !== keyOf(PRINTER_TOOL)) return pick;
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
    const tool = tools.tools.find((one) => keyOf(one.name) === keyOf(pick.name));
    return (
      tool !== undefined &&
      (tool.count ?? 1) === (pick.count ?? 1) &&
      tool.brand === pick.brand &&
      tool.size === pick.size
    );
  });
