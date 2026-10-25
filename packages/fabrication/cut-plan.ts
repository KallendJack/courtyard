import type { CutPlan, Finding, Part } from "./build.ts";
import type { Sheet, Timber } from "./stock.ts";

// Packing pieces into stock (ADR 0036): timber pieces into lengths, sheet pieces into sheets,
// with the saw's cut (the kerf) between every two pieces. Any template's cut plan is built from
// these two, so the rule that a plan never overruns its stock lives here once.

/** A piece cut from a length of timber. */
export type LengthPiece = { readonly label: string; readonly length: number };

/** One length of stock: the pieces cut from it in order, how much they take and what's left. */
export type PlannedLength<P extends LengthPiece> = {
  readonly cuts: readonly P[];
  /** The pieces and the saw cuts between them; the last piece needs no cut after it. */
  readonly used: number;
  readonly offcut: number;
};

const usedBy = (cuts: readonly LengthPiece[], kerf: number) =>
  cuts.reduce((sum, cut) => sum + cut.length, 0) + kerf * Math.max(0, cuts.length - 1);

/**
 * First fit, longest first: each piece goes in the first length it fits, kerf counted, or starts
 * another. A piece longer than the stock can't be cut from it and is returned in `uncut`.
 */
export const planLengths = <P extends LengthPiece>(options: {
  stockLength: number;
  kerf: number;
  pieces: readonly P[];
}): { lengths: PlannedLength<P>[]; uncut: P[] } => {
  const { stockLength, kerf } = options;
  // A stable sort keeps pieces of one length in the order they were asked for (C before D).
  const longestFirst = [...options.pieces].sort((a, b) => b.length - a.length);
  const lengths: P[][] = [];
  const uncut: P[] = [];
  for (const piece of longestFirst) {
    if (piece.length > stockLength) {
      uncut.push(piece);
      continue;
    }
    const room = lengths.find((cuts) => usedBy([...cuts, piece], kerf) <= stockLength);
    if (room) room.push(piece);
    else lengths.push([piece]);
  }
  return {
    lengths: lengths.map((cuts) => {
      const used = usedBy(cuts, kerf);
      return { cuts, used, offcut: stockLength - used };
    }),
    uncut,
  };
};

/** A piece cut from a sheet: its size along the sheet's length and across its width. */
export type SheetPiece = {
  readonly label: string;
  readonly length: number;
  readonly width: number;
};

/**
 * Where a piece sits on its sheet, from the sheet's corner: `x` along the sheet's length, `y`
 * across it, and its size each way (`turned` when its length runs across the sheet).
 */
export type PlacedPiece<P extends SheetPiece> = {
  readonly piece: P;
  readonly x: number;
  readonly y: number;
  readonly along: number;
  readonly across: number;
  readonly turned: boolean;
};

type Space = { x: number; y: number; along: number; across: number };

/**
 * Straight cuts right across what's left (a guillotine plan, as a panel saw or a shop cuts), the
 * biggest pieces first, each into the smallest space it fits, turned only if it fits no other
 * way. A piece placed splits its space into what's beside it and what's below it, each a saw cut
 * away: the first cut along the sheet (what's beside it the full width) or across it (what's below
 * it the full length), whichever needs fewer sheets, along first when they need the same (#704).
 */
export const planSheets = <P extends SheetPiece>(options: {
  sheetLength: number;
  sheetWidth: number;
  kerf: number;
  pieces: readonly P[];
}): { sheets: { pieces: PlacedPiece<P>[] }[]; uncut: P[] } => {
  const along = packSheets(options, "along");
  const across = packSheets(options, "across");
  return across.sheets.length < along.sheets.length ? across : along;
};

/** The pieces packed with every first cut one way: along the sheet, or across it. */
const packSheets = <P extends SheetPiece>(
  options: { sheetLength: number; sheetWidth: number; kerf: number; pieces: readonly P[] },
  firstCut: "along" | "across",
): { sheets: { pieces: PlacedPiece<P>[] }[]; uncut: P[] } => {
  const { sheetLength, sheetWidth, kerf } = options;
  const biggestFirst = [...options.pieces].sort((a, b) => b.length * b.width - a.length * a.width);
  const sheets: { pieces: PlacedPiece<P>[]; spaces: Space[] }[] = [];
  const uncut: P[] = [];

  const fits = (space: Space, along: number, across: number) =>
    along <= space.along && across <= space.across;

  /** The smallest space on any sheet the piece fits, as it is or turned. */
  const findSpace = (piece: P) => {
    for (const turned of [false, true]) {
      const along = turned ? piece.width : piece.length;
      const across = turned ? piece.length : piece.width;
      let best: { sheet: (typeof sheets)[number]; space: Space } | undefined;
      for (const sheet of sheets) {
        for (const space of sheet.spaces) {
          if (!fits(space, along, across)) continue;
          if (!best || space.along * space.across < best.space.along * best.space.across) {
            best = { sheet, space };
          }
        }
      }
      if (best) return { ...best, along, across, turned };
    }
    return undefined;
  };

  for (const piece of biggestFirst) {
    const whole: Space = { x: 0, y: 0, along: sheetLength, across: sheetWidth };
    const asIs = fits(whole, piece.length, piece.width);
    if (!asIs && !fits(whole, piece.width, piece.length)) {
      uncut.push(piece);
      continue;
    }
    let found = findSpace(piece);
    if (!found) {
      sheets.push({ pieces: [], spaces: [whole] });
      found = findSpace(piece);
    }
    if (!found) continue;
    const { sheet, space, along, across, turned } = found;
    sheet.pieces.push({ piece, x: space.x, y: space.y, along, across, turned });
    sheet.spaces = sheet.spaces.filter((other) => other !== space);
    const beside: Space = {
      x: space.x + along + kerf,
      y: space.y,
      along: space.along - along - kerf,
      across: firstCut === "along" ? space.across : across,
    };
    const below: Space = {
      x: space.x,
      y: space.y + across + kerf,
      along: firstCut === "along" ? along : space.along,
      across: space.across - across - kerf,
    };
    for (const left of [beside, below]) {
      if (left.along > 0 && left.across > 0) sheet.spaces.push(left);
    }
  }
  return { sheets: sheets.map(({ pieces }) => ({ pieces })), uncut };
};

/** Each stock's parts, by the stock's name, in the order the stocks are first used. */
const byStock = (parts: readonly Part[], kind: "timber" | "sheet") => {
  const groups = new Map<string, Part[]>();
  for (const part of parts) {
    if (part.material.kind !== kind) continue;
    groups.set(part.material.stock, [...(groups.get(part.material.stock) ?? []), part]);
  }
  return [...groups];
};

const piecesOf = (parts: readonly Part[]) =>
  parts.flatMap((part) =>
    Array.from({ length: part.count }, () => ({
      label: part.label,
      length: part.length,
      width: part.width,
    })),
  );

/**
 * A Build's cut plan: its timber parts packed into the lengths of the timber each is cut from, and
 * its sheet parts into sheets, the kerf between every cut. Printed parts are printed, not cut. A
 * part bigger than its stock is left out and found.
 */
export const cutPlanOf = (options: {
  parts: readonly Part[];
  timbers: readonly Timber[];
  sheets: readonly Sheet[];
  kerf: number;
}): { cutPlan: CutPlan; findings: Finding[] } => {
  const { kerf } = options;
  const findings: Finding[] = [];
  const tooBig = (stock: string) => (piece: { label: string }) => {
    if (!findings.some((found) => "label" in found && found.label === piece.label)) {
      findings.push({ kind: "too-big-for-stock", label: piece.label, stock });
    }
  };
  const timber = byStock(options.parts, "timber").flatMap(([name, parts]) => {
    const stock = options.timbers.find((timber) => timber.name === name);
    if (!stock) return [];
    const stockLength = stock.length.value;
    const plan = planLengths({ stockLength, kerf, pieces: piecesOf(parts) });
    plan.uncut.forEach(tooBig(name));
    return [
      {
        stock: name,
        stockLength,
        lengths: plan.lengths.map((length) => ({
          cuts: length.cuts.map(({ label, length: cut }) => ({ label, length: cut })),
          used: length.used,
          offcut: length.offcut,
        })),
      },
    ];
  });
  const sheets = byStock(options.parts, "sheet").flatMap(([name, parts]) => {
    const stock = options.sheets.find((sheet) => sheet.name === name);
    if (!stock) return [];
    const sheetLength = stock.length.value;
    const sheetWidth = stock.width.value;
    const plan = planSheets({ sheetLength, sheetWidth, kerf, pieces: piecesOf(parts) });
    plan.uncut.forEach(tooBig(name));
    return [
      {
        stock: name,
        sheetLength,
        sheetWidth,
        sheets: plan.sheets.map((sheet) => ({
          pieces: sheet.pieces.map(({ piece, ...placed }) => ({ label: piece.label, ...placed })),
        })),
      },
    ];
  });
  return { cutPlan: { kerf, timber, sheets }, findings };
};
