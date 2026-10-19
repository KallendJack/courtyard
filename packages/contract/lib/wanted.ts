import { z } from "zod";
import { ThingSlug } from "./things.ts";

// The wanted list (#245): a planning workspace's Things wanted or to replace, each with up to three
// picks chosen for value, their prices checked on the web by a short background turn, and the
// shops the owner blocked. Only the pages that show them load these.

/**
 * Why a pick is there: the one to buy (★ Best value), the cheapest that does the job, and one worth
 * stretching for, only when the extra money buys something real.
 */
export const PickKind = z.enum(["best-value", "cheapest", "stretch"]);
export type PickKind = z.infer<typeof PickKind>;

/** The order picks show in, the ★ one first. */
export const PICK_KINDS = PickKind.options;

/** The most picks a wanted Thing has: one of each kind. */
export const PICKS_MAX = PICK_KINDS.length;

/** A price in pence, as shops list it in pounds: £55 is 5500. */
const Pence = z.number().int().positive().max(10_000_000);

/** One line of free text, as each of a pick's words are. */
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !/[\r\n]/.test(text));

/** A shop by the name it trades under, such as Tredz. */
export const ShopName = oneLine(60);

/**
 * One pick for a wanted Thing: what it is, why in one line, its price where it's sold new, the
 * shop and its page, its size when the listing gives one, and when its price was last checked.
 */
export const WantedPick = z.object({
  kind: PickKind,
  product: oneLine(100),
  why: oneLine(120),
  pence: Pence,
  /** Its usual price, when it's in a sale: more than `pence`. */
  usualPence: Pence.optional(),
  shop: ShopName,
  /** The shop's page for it. */
  url: z.url({ protocol: /^https$/ }),
  size: oneLine(60).optional(),
  checkedAt: z.iso.datetime(),
});
export type WantedPick = z.infer<typeof WantedPick>;

/** A Thing on the wanted list: its name, whether it's to get or to replace, and its picks, ★ first. */
export const WantedRow = z.object({
  thing: ThingSlug,
  name: z.string(),
  status: z.enum(["want", "replace"]),
  picks: z.array(WantedPick).max(PICKS_MAX),
  /** Whether its picks are being found now (Find picks, or after a shop was blocked). */
  finding: z.boolean(),
});
export type WantedRow = z.infer<typeof WantedRow>;

/** The wanted list, as `GET /api/workspaces/:id/wanted` gives it. */
export const WantedList = z.object({
  rows: z.array(WantedRow),
  /** Whether its prices are being checked again now, which they show faintly as "checking…". */
  checking: z.boolean(),
});
export type WantedList = z.infer<typeof WantedList>;

/** A shop the owner said not to use: when, and what they said, as they said it. */
export const BlockedShop = z.object({
  shop: ShopName,
  since: z.iso.datetime(),
  said: z.string().trim().max(200).optional(),
});
export type BlockedShop = z.infer<typeof BlockedShop>;

/** A workspace's blocked shops, as `GET /api/workspaces/:id/blocked-shops` gives them. */
export const BlockedShops = z.object({ shops: z.array(BlockedShop) });
export type BlockedShops = z.infer<typeof BlockedShops>;

/** Unblock, by the shop's name. */
export const ShopUnblock = z.object({ shop: ShopName });
export type ShopUnblock = z.infer<typeof ShopUnblock>;

/**
 * A `product` block's JSON (#245): one product named in an answer, which the web app draws with
 * Add to wanted. Its name as the owner would call it, and one line about it.
 */
export const ProductBlock = z.object({
  name: z.string().trim().min(1).max(100),
  about: z.string().trim().max(120).optional(),
});
export type ProductBlock = z.infer<typeof ProductBlock>;

/** A price as the owner reads it: £55, or £5.49 when it has pence. */
export const poundsOf = (pence: number) =>
  pence % 100 === 0 ? `£${(pence / 100).toLocaleString("en-GB")}` : `£${(pence / 100).toFixed(2)}`;
