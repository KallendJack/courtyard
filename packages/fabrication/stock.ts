import {
  BuildFixing,
  BuildOptionPrice,
  BuildOptionPrices,
  BuildPrice,
  BuildSheet,
  BuildStockOptionId,
  BuildTimber,
} from "@courtyard/contract";
import { z } from "zod";
import type { FixingType } from "./close-up.ts";

// What parts are cut from and fixed with, for any template or recipe, as the contract defines them
// (#769). A template takes each of its slots' stock as a parameter (the frame's timber, the top's
// sheet), never a stock of its own, so a slot can be offered sawn C16, CLS or treated timber, or
// plywood, OSB or MDF, and the Build derived again (#704).

export const Words = z.string().trim().min(1).max(80);

/**
 * Something Your stock has (#760): its name, as a buy list line names it ("5 × 80 screws"), how
 * many, and where it's kept ("Diall case"), which the steps say it comes from.
 */
export type Held = { readonly name: string; readonly count: number; readonly where?: string };

/**
 * A fixing a step uses, the type of close-up that shows how it's made (#813), and where the owner
 * keeps theirs when Your stock has it: "Diall case".
 */
export type StepFixing = {
  readonly name: string;
  readonly count: number;
  readonly joint?: FixingType;
  readonly from?: string;
};

/** A pack's price, in pence, and where it's from. */
export const Price = BuildPrice;
export type Price = BuildPrice;

/** The stock options a slot can be offered (`options.ts`), by name. */
export const StockOptionId = BuildStockOptionId;
export type StockOptionId = BuildStockOptionId;

/** An option's price from its shop's page, and the size it's sold in at that price. */
export const OptionPrice = BuildOptionPrice;
export type OptionPrice = BuildOptionPrice;

/** The options' prices, each from its shop's page, so each option's cost can be shown. */
export const OptionPrices = BuildOptionPrices;
export type OptionPrices = BuildOptionPrices;

/** A timber sold in lengths: its section and its length. */
export const Timber = BuildTimber;
export type Timber = BuildTimber;

/** A sheet material: its thickness and the sheet's size. */
export const Sheet = BuildSheet;
export type Sheet = BuildSheet;

/** Screws or brackets, bought by the pack. */
export const Fixing = BuildFixing;
export type Fixing = BuildFixing;
