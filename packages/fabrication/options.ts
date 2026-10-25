import {
  type Build,
  err,
  type Finding,
  ok,
  type Result,
  type Said,
  type StockChoice,
  type StockOptions,
} from "./build.ts";
import { type Role, STOCK_OPTIONS, type StockOption, saysOf, wrongs } from "./catalog.ts";
import {
  type OptionPrice,
  type OptionPrices,
  type Price,
  type Sheet,
  StockOptionId,
  type Timber,
} from "./stock.ts";

// A Build's timber and sheets offered their options (#704, the options in `catalog.ts`), for any
// template. A template names its slots (the bench's frame timber, its top), each with the job it
// does; an option is offered for a slot whose job it suits, costed by working the Build out again
// with it, and flagged when it's wrong for its slot. The stock in use is costed as it is.

const IDS = StockOptionId.options;

/** A slot of a template's: the stock one job is cut from, and how to read and change it. */
export type Slot<P> = {
  readonly role: Role;
  readonly name: string;
  /** The labels of the parts cut from it. */
  readonly parts: readonly string[];
  readonly recommended: StockOptionId;
  readonly inUse: (parameters: P) => boolean;
  readonly stock: (parameters: P) => Timber | Sheet;
  readonly set: (parameters: P, stock: Timber | Sheet) => P;
};

/** The option a stock is: its own, or else the one of its kind, section and name. */
const optionOf = (stock: Timber | Sheet, kind: StockOption["kind"]) =>
  stock.option ??
  IDS.find((id) => {
    const option = STOCK_OPTIONS[id];
    return (
      option.kind === kind &&
      option.thickness === stock.thickness.value &&
      option.width === stock.width.value &&
      option.known.test(stock.name)
    );
  });

const kindOf = (role: Role) => (role === "sheet" ? "sheet" : "timber");

/** An option's price as a stock's: what it costs, without the size it's sold in. */
const paidOf = (price: OptionPrice): Price => ({
  pence: price.pence,
  packOf: price.packOf,
  ...(price.shop === undefined ? {} : { shop: price.shop }),
  ...(price.link === undefined ? {} : { link: price.link }),
});

/**
 * An option as a slot's stock: its section from its reference, and its length (and a sheet's
 * width) the size its price is for, where that isn't the option's own.
 */
const stockOf = (id: StockOptionId, price: OptionPrice | undefined): Timber | Sheet => {
  const option = STOCK_OPTIONS[id];
  const size = (value: number) =>
    ({ value, unit: "mm", source: { kind: "specified", reference: option.reference } }) as const;
  return {
    name: option.stock,
    option: id,
    thickness: size(option.thickness),
    width: (option.kind === "sheet" ? price?.width : undefined) ?? size(option.width),
    length: price?.length ?? size(option.length),
    ...(price === undefined ? {} : { price: paidOf(price) }),
  };
};

/** A stock's price as an option's, with the size it's sold in where that isn't the option's own. */
const optionPriceOf = (stock: Timber | Sheet, id: StockOptionId): OptionPrice | undefined => {
  if (stock.price === undefined) return undefined;
  const option = STOCK_OPTIONS[id];
  return {
    ...stock.price,
    ...(stock.length.value === option.length ? {} : { length: stock.length }),
    ...(option.kind === "sheet" && stock.width.value !== option.width
      ? { width: stock.width }
      : {}),
  };
};

/** "Legs, long rails and end rails": the first capital, the rest as they're said. */
const sayParts = (names: readonly string[]) => {
  const lower = names.map((name, index) => (index === 0 ? name : name.toLowerCase()));
  return lower.length <= 1
    ? (lower[0] ?? "")
    : `${lower.slice(0, -1).join(", ")} and ${lower.at(-1)}`;
};

const partNames = (build: Pick<Build, "parts">, labels: readonly string[]) =>
  build.parts.filter((part) => labels.includes(part.label)).map((part) => part.name);

/** The making rule for stock: each one wrong for what it's used for, with its parts. */
export const wrongStock = <P>(options: {
  parameters: P;
  slots: readonly Slot<P>[];
  damp: boolean;
  build: Pick<Build, "parts">;
}): Finding[] => {
  const found = new Map<string, { stock: string; parts: string[]; why: string }>();
  for (const slot of options.slots) {
    if (!slot.inUse(options.parameters)) continue;
    const stock = slot.stock(options.parameters);
    const id = optionOf(stock, kindOf(slot.role));
    if (id === undefined) continue;
    for (const { why } of wrongs(STOCK_OPTIONS[id], slot.role, options.damp)) {
      const key = `${stock.name}\n${why}`;
      const known = found.get(key) ?? { stock: stock.name, parts: [], why };
      found.set(key, {
        ...known,
        parts: [...known.parts, ...partNames(options.build, slot.parts)],
      });
    }
  }
  return [...found.values()].map((one) => ({ kind: "wrong-stock", ...one }));
};

/** What a Build buys of a stock: "5 lengths of 2.4 m", "1 sheet of 2440 × 1220". */
const buysOf = (build: Pick<Build, "cutPlan">, stock: string) => {
  const timber = build.cutPlan.timber.find((plan) => plan.stock === stock);
  if (timber !== undefined) {
    const count = timber.lengths.length;
    return `${count} ${count === 1 ? "length" : "lengths"} of ${timber.stockLength / 1000} m`;
  }
  const sheet = build.cutPlan.sheets.find((plan) => plan.stock === stock);
  if (sheet === undefined) return "";
  const count = sheet.sheets.length;
  return `${count} ${count === 1 ? "sheet" : "sheets"} of ${sheet.sheetLength} × ${sheet.sheetWidth}`;
};

/** A Build without its options, worked out from its parameters. */
type Derive<P> = (parameters: P) => Result<Omit<Build, "options">, string[]>;

/** The slots in use, by the stock each is cut from now, in the template's order. */
const byStock = <P>(parameters: P, slots: readonly Slot<P>[]) => {
  const groups = new Map<string, Slot<P>[]>();
  for (const slot of slots) {
    if (!slot.inUse(parameters)) continue;
    const name = slot.stock(parameters).name;
    groups.set(name, [...(groups.get(name) ?? []), slot]);
  }
  return [...groups];
};

/** The slots with every one cut from this option now. */
const withOption = <P>(parameters: P, slots: readonly Slot<P>[], stock: Timber | Sheet) =>
  slots.reduce((now, slot) => slot.set(now, stock), parameters);

/**
 * Each stock a Build uses with its options, the recommended first, each costed by working the
 * Build out again with it: one with only one option is left out.
 */
export const stockOptions = <P>(options: {
  parameters: P;
  slots: readonly Slot<P>[];
  prices: OptionPrices;
  damp: boolean;
  build: Omit<Build, "options">;
  derive: Derive<P>;
}): StockOptions[] =>
  byStock(options.parameters, options.slots).flatMap(([name, group]) => {
    const [first] = group;
    if (first === undefined) return [];
    const kind = kindOf(first.role);
    const roles = [...new Set(group.map((slot) => slot.role))];
    const current = first.stock(options.parameters);
    const picked = optionOf(current, kind);
    const offered = IDS.filter(
      (id) =>
        id === picked ||
        (STOCK_OPTIONS[id].kind === kind &&
          STOCK_OPTIONS[id].suits.some((role) => roles.includes(role))),
    ).sort((a, b) => Number(b === first.recommended) - Number(a === first.recommended));
    // Stock that's no option is what the Build uses still, its own row first, so it shows Picked.
    if (offered.length + (picked === undefined ? 1 : 0) < 2) return [];
    /** A stock in every slot of this one's: what the Build would buy of it, and its cost. */
    const costed = (stock: Timber | Sheet, says: Said[]) => {
      const swapped = options.derive(withOption(options.parameters, group, stock));
      if (!swapped.ok) {
        return { says: [{ text: "Doesn't fit these sizes", tone: "warn" } as const], buys: "" };
      }
      const lines = swapped.value.buyList.lines.filter((line) => line.stock === stock.name);
      const total = lines.every((line) => line.total !== undefined)
        ? lines.reduce((sum, line) => sum + (line.total ?? 0), 0)
        : undefined;
      const { price } = stock;
      return {
        says,
        buys: buysOf(swapped.value, stock.name),
        ...(price === undefined
          ? {}
          : {
              price: {
                pence: price.pence,
                ...(price.shop === undefined ? {} : { shop: price.shop }),
                ...(price.link === undefined ? {} : { link: price.link }),
              },
            }),
        ...(total !== undefined && lines.length > 0 ? { total } : {}),
      };
    };
    const own: StockChoice[] =
      picked === undefined
        ? [
            {
              title: current.name,
              stock: current.name,
              why: "What the Build uses.",
              ...costed(current, []),
              picked: true,
              recommended: false,
            },
          ]
        : [];
    const choices = offered.map((id): StockChoice => {
      const option = STOCK_OPTIONS[id];
      return {
        option: id,
        title: option.title,
        stock: option.stock,
        why: option.why,
        finish: option.finish,
        // What the Build uses is costed as it is, at its own length and price.
        ...costed(
          id === picked ? current : stockOf(id, options.prices[id]),
          saysOf(option, roles, options.damp),
        ),
        picked: id === picked,
        recommended: id === first.recommended,
      };
    });
    return [
      {
        stock: name,
        name: group.length === 1 ? first.name : kind === "sheet" ? "Sheet" : "Timber",
        for: sayParts(
          partNames(
            options.build,
            group.flatMap((slot) => slot.parts),
          ),
        ),
        choices: [...own, ...choices],
      },
    ];
  });

/**
 * A stock swapped for one of its options in every slot cut from it, its price and size from the
 * options' prices; the price and size it had are kept there, so picking it again puts it back.
 */
export const pickStock = <P>(options: {
  parameters: P;
  slots: readonly Slot<P>[];
  prices: (parameters: P) => OptionPrices;
  setPrices: (parameters: P, prices: OptionPrices) => P;
  pick: { stock: string; option: string };
}): Result<P, string[]> => {
  const { parameters, pick } = options;
  const group = byStock(parameters, options.slots).find(([name]) => name === pick.stock)?.[1];
  const [first] = group ?? [];
  if (group === undefined || first === undefined) {
    return err([`This Build has no stock called ${pick.stock}.`]);
  }
  const id = StockOptionId.safeParse(pick.option);
  const option = id.success ? STOCK_OPTIONS[id.data] : undefined;
  if (!id.success || option === undefined || option.kind !== kindOf(first.role)) {
    return err([`${pick.option} isn't one of ${pick.stock}'s options.`]);
  }
  const prices: OptionPrices = { ...options.prices(parameters) };
  for (const slot of group) {
    const stock = slot.stock(parameters);
    const was = optionOf(stock, option.kind);
    const kept = was === undefined ? undefined : optionPriceOf(stock, was);
    if (was !== undefined && kept !== undefined) prices[was] = kept;
  }
  return ok(
    withOption(options.setPrices(parameters, prices), group, stockOf(id.data, prices[id.data])),
  );
};
