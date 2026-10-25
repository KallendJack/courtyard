import type { Said } from "./build.ts";
import type { StockOptionId } from "./stock.ts";

// The stock options (#704): each timber's and sheet's sizes, what it's like, and the jobs it suits,
// for any template, and what each is like for the slots it would fill. Prices are never here:
// they come from shops' pages, through the Build's parameters.

/** The job a slot's stock does: the frame's legs and rails, wide pieces that take bolts, sheets. */
export type Role = "frame" | "wide" | "sheet";

/** A timber or sheet a slot can be offered: its sizes, what it is like, and the jobs it suits. */
export type StockOption = {
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
    why: "Smooth, with rounded edges, but 7 mm slimmer than C16, so each screw has less to grip.",
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

/** Why an option is wrong for its slot, if it is: the job's, then the damp's. */
export const wrongs = (option: StockOption, role: Role, damp: boolean) => [
  ...(option.wrongFor?.[role] === undefined ? [] : [option.wrongFor[role]]),
  ...(damp && option.damp === "swells"
    ? [{ chip: "Swells in a damp garage", why: "It swells in a damp garage." }]
    : []),
];

/** A slot's job as a chip names it. */
const JOBS: Readonly<Record<Role, string>> = {
  frame: "the frame",
  wide: "the wide pieces",
  sheet: "sheets",
};

/**
 * What an option is like for these slots, as chips: what to know, or that it's fine. It's judged
 * for every slot it would fill, so the strictest says: a stock that's both the frame and the wide
 * pieces is offered nothing as fine that's made for only one.
 */
export const saysOf = (option: StockOption, roles: readonly Role[], damp: boolean): Said[] => {
  const warns = [
    ...new Set([
      ...roles.flatMap((role) => wrongs(option, role, damp).map(({ chip }) => chip)),
      ...roles
        .filter((role) => !option.suits.includes(role) && option.wrongFor?.[role] === undefined)
        .map((role) => `Not made for ${JOBS[role]}`),
      ...(option.caveat === undefined ? [] : [option.caveat]),
      ...(option.damp === "treated" ? ["Not needed indoors"] : []),
      ...(option.damp === "swells" && !damp ? ["Keep it dry"] : []),
    ]),
  ];
  return warns.length > 0
    ? warns.map((text) => ({ text, tone: "warn" }))
    : [{ text: "Fine in a garage", tone: "fine" }];
};
