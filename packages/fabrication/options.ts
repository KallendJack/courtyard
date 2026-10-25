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
import { type OptionPrices, type Price, type Sheet, StockOptionId, type Timber } from "./stock.ts";

// The stock a Build's timber and sheets can be (#704): each option's sizes, what it's like, and
// the jobs it suits, for any template. A template names its slots (the bench's frame timber, its
// top), each with the job it does; an option is offered for a slot whose job it suits, costed by
// working the Build out again with it, and flagged when it's wrong for its slot. Prices are never
// here: they come from shops' pages, through the Build's parameters.

/** The job a slot's stock does: the frame's legs and rails, wide pieces that take bolts, sheets. */
export type Role = "frame" | "wide" | "sheet";

type StockOption = {
  readonly kind: "timber" | "sheet";
  readonly title: string;
  readonly stock: string;
  /** A word in its name as written without its id ("45 × 95 C16"), to know it by. */
  readonly known: RegExp;
  readonly thickness: number;
  readonly width: number;
  readonly length: number;
  /** Where its sizes come from. */
  readonly reference: string;
  readonly why: string;
  readonly finish: "rough" | "smooth";
  /** In a damp place: fine, swells, or treated for outdoors, which a garage doesn't need. */
  readonly damp: "fine" | "swells" | "treated";
  readonly suits: readonly Role[];
  /** Something to know whatever it's for. */
  readonly caveat?: string;
  /** The jobs it's wrong for: a chip's words, and the finding's. */
  readonly wrongFor?: Partial<Record<Role, { readonly chip: string; readonly why: string }>>;
};

const TIMBER = { kind: "timber", length: 2400, finish: "rough", damp: "fine" } as const;
const SHEET = {
  kind: "sheet",
  thickness: 18,
  width: 1220,
  length: 2440,
  finish: "smooth",
  damp: "fine",
  suits: ["sheet"],
} as const;

export const STOCK_OPTIONS: Readonly<Record<StockOptionId, StockOption>> = {
  "c16-45x95": {
    ...TIMBER,
    title: "Sawn C16, 45 × 95",
    stock: "45 × 95 C16",
    known: /c16/i,
    thickness: 45,
    width: 95,
    reference: "C16 sawn timber, 45 × 95",
    why: "Strong, kiln-dried, rough faces. Right for a bench.",
    suits: ["frame"],
  },
  "cls-38x89": {
    ...TIMBER,
    title: "CLS, 38 × 89",
    stock: "38 × 89 CLS",
    known: /cls/i,
    thickness: 38,
    width: 89,
    reference: "CLS timber, 38 × 89",
    why: "Smooth and rounded, but slimmer: less wood for screws.",
    finish: "smooth",
    suits: ["frame"],
    caveat: "Less wood for screws",
    wrongFor: {
      wide: {
        chip: "Too slim for the castor bases",
        why: "It's too slim for the castor bases' bolts and the top's support.",
      },
    },
  },
  "treated-47x100": {
    ...TIMBER,
    title: "Treated, 47 × 100",
    stock: "47 × 100 treated",
    known: /treated/i,
    thickness: 47,
    width: 100,
    reference: "Treated sawn timber, 47 × 100",
    why: "Made for outdoors. Wetter, so it can twist as it dries inside.",
    damp: "treated",
    suits: ["frame"],
  },
  "c16-45x145": {
    ...TIMBER,
    title: "Sawn C16, 45 × 145",
    stock: "45 × 145 C16",
    known: /c16/i,
    thickness: 45,
    width: 145,
    reference: "C16 sawn timber, 45 × 145",
    why: "Wide and thick enough to take the castors' bolts.",
    suits: ["wide"],
  },
  "plywood-18": {
    ...SHEET,
    title: "Plywood, 18 mm",
    stock: "18 mm plywood",
    known: /ply/i,
    reference: "18 mm plywood, a full sheet",
    why: "Strong and smooth on top, and holds screws near its edges.",
  },
  "osb-18": {
    ...SHEET,
    title: "OSB, 18 mm",
    stock: "18 mm OSB",
    known: /osb/i,
    reference: "18 mm OSB3, a full sheet",
    why: "Cheaper and strong enough, but rough on top.",
    finish: "rough",
  },
  "mdf-18": {
    ...SHEET,
    title: "MDF, 18 mm",
    stock: "18 mm MDF",
    known: /mdf/i,
    reference: "18 mm MDF, a full sheet",
    why: "Smooth and cheap, but heavy, and splits at screws near its edges.",
    damp: "swells",
  },
};

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

/** An option as a slot's stock, its sizes from its reference. */
const stockOf = (id: StockOptionId, price: Price | undefined): Timber | Sheet => {
  const option = STOCK_OPTIONS[id];
  const size = (value: number) =>
    ({ value, unit: "mm", source: { kind: "specified", reference: option.reference } }) as const;
  return {
    name: option.stock,
    option: id,
    thickness: size(option.thickness),
    width: size(option.width),
    length: size(option.length),
    ...(price === undefined ? {} : { price }),
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

/** Why an option is wrong for its slot, if it is: the job's, then the damp's. */
const wrongs = (option: StockOption, role: Role, damp: boolean) => [
  ...(option.wrongFor?.[role] === undefined ? [] : [option.wrongFor[role]]),
  ...(damp && option.damp === "swells"
    ? [{ chip: "Swells in a damp garage", why: "It swells in a damp garage." }]
    : []),
];

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

/** What an option is like for these slots, as chips: what to know, or that it's fine. */
const saysOf = (option: StockOption, roles: readonly Role[], damp: boolean): Said[] => {
  const warns = [
    ...new Set([
      ...roles.flatMap((role) => wrongs(option, role, damp).map(({ chip }) => chip)),
      ...(option.caveat === undefined ? [] : [option.caveat]),
      ...(option.damp === "treated" ? ["Not needed indoors"] : []),
      ...(option.damp === "swells" && !damp ? ["Keep it dry"] : []),
    ]),
  ];
  return warns.length > 0
    ? warns.map((text) => ({ text, tone: "warn" }))
    : [{ text: "Fine in a garage", tone: "fine" }];
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
    if (offered.length < 2) return [];
    const choices = offered.map((id): StockChoice => {
      const option = STOCK_OPTIONS[id];
      const price = options.prices[id] ?? (id === picked ? current.price : undefined);
      const swapped = options.derive(withOption(options.parameters, group, stockOf(id, price)));
      const lines = swapped.ok
        ? swapped.value.buyList.lines.filter((line) => line.stock === option.stock)
        : [];
      const total = lines.every((line) => line.total !== undefined)
        ? lines.reduce((sum, line) => sum + (line.total ?? 0), 0)
        : undefined;
      return {
        option: id,
        title: option.title,
        stock: option.stock,
        why: option.why,
        finish: option.finish,
        says: swapped.ok
          ? saysOf(option, roles, options.damp)
          : [{ text: "Doesn't fit these sizes", tone: "warn" }],
        buys: swapped.ok ? buysOf(swapped.value, option.stock) : "",
        ...(price === undefined
          ? {}
          : {
              price: {
                pence: price.pence,
                ...(price.shop === undefined ? {} : { shop: price.shop }),
                ...(price.link === undefined ? {} : { link: price.link }),
              },
            }),
        ...(swapped.ok && total !== undefined && lines.length > 0 ? { total } : {}),
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
        choices,
      },
    ];
  });

/**
 * A stock swapped for one of its options in every slot cut from it, its price from the options'
 * prices; the price it had is kept there, so picking it again finds it.
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
    if (was !== undefined && stock.price !== undefined && prices[was] === undefined) {
      prices[was] = stock.price;
    }
  }
  return ok(
    withOption(options.setPrices(parameters, prices), group, stockOf(id.data, prices[id.data])),
  );
};
