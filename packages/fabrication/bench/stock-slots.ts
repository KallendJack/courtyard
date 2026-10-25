import { err, ok, type Result } from "../build.ts";
import { pickStock, type Slot } from "../options.ts";
import { BenchParameters } from "./parameters.ts";

// The framed bench's slots (#704): the stock each job is cut from, which can be swapped for one of
// its options, and the parts cut from each.

export const BENCH_SLOTS: readonly Slot<BenchParameters>[] = [
  {
    role: "frame",
    name: "Frame timber",
    parts: ["A", "B", "C", "D"],
    recommended: "c16-45x95",
    inUse: () => true,
    stock: (parameters) => parameters.frame.timber,
    set: (parameters, timber) => ({ ...parameters, frame: { ...parameters.frame, timber } }),
  },
  {
    role: "wide",
    name: "Wide timber",
    parts: ["E", "F"],
    recommended: "c16-45x145",
    inUse: () => true,
    stock: (parameters) => parameters.frame.wide,
    set: (parameters, wide) => ({ ...parameters, frame: { ...parameters.frame, wide } }),
  },
  {
    role: "sheet",
    name: "Top",
    parts: ["G"],
    recommended: "plywood-18",
    inUse: () => true,
    stock: (parameters) => parameters.top.sheet,
    set: (parameters, sheet) => ({ ...parameters, top: { ...parameters.top, sheet } }),
  },
  {
    role: "sheet",
    name: "Shelf",
    parts: ["H"],
    recommended: "plywood-18",
    inUse: (parameters) => parameters.shelf.on,
    stock: (parameters) => parameters.shelf.sheet,
    set: (parameters, sheet) => ({ ...parameters, shelf: { ...parameters.shelf, sheet } }),
  },
  {
    role: "sheet",
    name: "Braces",
    parts: ["J"],
    recommended: "plywood-18",
    inUse: (parameters) => parameters.braces.ends || parameters.braces.rear,
    stock: (parameters) => parameters.braces.sheet,
    set: (parameters, sheet) => ({ ...parameters, braces: { ...parameters.braces, sheet } }),
  },
];

/**
 * A bench's parameters with one of its stocks (by name, as its buy list gives it) swapped for an
 * option, in every slot cut from it; or why not. Only what the swap changed is replaced, so a
 * parameter left to its default stays left out.
 */
export const pickBenchStock = (
  input: unknown,
  pick: { stock: string; option: string },
): Result<Record<string, unknown>, string[]> => {
  const parsed = BenchParameters.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues.map((issue) => issue.message));
  const picked = pickStock({
    parameters: parsed.data,
    slots: BENCH_SLOTS,
    prices: (parameters) => parameters.prices,
    setPrices: (parameters, prices) => ({ ...parameters, prices }),
    pick,
  });
  if (!picked.ok) return picked;
  const changed = Object.entries(picked.value).filter(
    ([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(parsed.data[key as keyof BenchParameters]),
  );
  return ok({ ...(input as Record<string, unknown>), ...Object.fromEntries(changed) });
};
