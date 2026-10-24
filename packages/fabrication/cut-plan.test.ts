import { describe, expect, it } from "vitest";
import { planLengths, planSheets } from "./cut-plan.ts";

// The packing on its own, with invented pieces: what a cut plan promises whatever the Build is.
// The bench's own plan is checked against the hand-worked numbers in bench/bench.test.ts.

const KERF = 3;

const pieces = (label: string, length: number, count: number) =>
  Array.from({ length: count }, () => ({ label, length }));

describe("timber lengths", () => {
  it("packs the longest pieces first, with a saw cut between each", () => {
    const plan = planLengths({
      stockLength: 2400,
      kerf: KERF,
      pieces: [...pieces("A", 750, 2), ...pieces("B", 1450, 2), ...pieces("C", 460, 3)],
    });

    expect(
      plan.lengths.map((length) => [length.cuts.map((cut) => cut.label), length.used]),
    ).toEqual([
      [["B", "A"], 2203],
      [["B", "A"], 2203],
      [["C", "C", "C"], 1386],
    ]);
    expect(plan.lengths[2]?.offcut).toBe(1014);
    expect(plan.uncut).toEqual([]);
  });

  it("counts a piece that fills a length exactly with no cut after it", () => {
    const plan = planLengths({ stockLength: 1000, kerf: KERF, pieces: pieces("A", 497, 2) });

    expect(plan.lengths).toHaveLength(1);
    expect(plan.lengths[0]?.used).toBe(997);
  });

  it("leaves out a piece longer than the stock, and says so", () => {
    const plan = planLengths({ stockLength: 2400, kerf: KERF, pieces: pieces("B", 2500, 1) });

    expect(plan.lengths).toEqual([]);
    expect(plan.uncut).toEqual([{ label: "B", length: 2500 }]);
  });

  it("never overruns a length, kerf counted, however the pieces fall", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    for (let run = 0; run < 200; run += 1) {
      const count = 1 + (next() % 12);
      const asked = Array.from({ length: count }, (_, at) => ({
        label: String.fromCharCode(65 + (at % 26)),
        length: 50 + (next() % 2350),
      }));
      const plan = planLengths({ stockLength: 2400, kerf: KERF, pieces: asked });
      for (const length of plan.lengths) {
        const total = length.cuts.reduce((sum, cut) => sum + cut.length, 0);
        expect(total + KERF * (length.cuts.length - 1)).toBe(length.used);
        expect(length.used).toBeLessThanOrEqual(2400);
      }
      expect(plan.lengths.flatMap((length) => length.cuts)).toHaveLength(asked.length);
    }
  });
});

describe("sheets", () => {
  it("cuts every piece inside the sheet, a saw cut apart", () => {
    const plan = planSheets({
      sheetWidth: 1220,
      sheetLength: 2440,
      kerf: KERF,
      pieces: [
        { label: "G", length: 1500, width: 600 },
        { label: "H", length: 1166, width: 550 },
        { label: "J", length: 460, width: 500 },
        { label: "J", length: 460, width: 500 },
        { label: "J", length: 460, width: 500 },
      ],
    });

    expect(plan.sheets).toHaveLength(1);
    expect(plan.uncut).toEqual([]);
  });

  it("starts another sheet when one is full", () => {
    const plan = planSheets({
      sheetWidth: 1220,
      sheetLength: 2440,
      kerf: KERF,
      pieces: [
        { label: "G", length: 2000, width: 1000 },
        { label: "G", length: 2000, width: 1000 },
      ],
    });

    expect(plan.sheets).toHaveLength(2);
  });

  it("never overlaps two pieces or runs off the sheet, however the pieces fall", () => {
    let seed = 11;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    for (let run = 0; run < 200; run += 1) {
      const count = 1 + (next() % 10);
      const asked = Array.from({ length: count }, () => ({
        label: "P",
        length: 100 + (next() % 1500),
        width: 100 + (next() % 900),
      }));
      const plan = planSheets({ sheetWidth: 1220, sheetLength: 2440, kerf: KERF, pieces: asked });
      for (const sheet of plan.sheets) {
        for (const [at, piece] of sheet.pieces.entries()) {
          expect(piece.x).toBeGreaterThanOrEqual(0);
          expect(piece.y).toBeGreaterThanOrEqual(0);
          expect(piece.x + piece.along).toBeLessThanOrEqual(2440);
          expect(piece.y + piece.across).toBeLessThanOrEqual(1220);
          for (const other of sheet.pieces.slice(at + 1)) {
            const apart =
              piece.x + piece.along + KERF <= other.x ||
              other.x + other.along + KERF <= piece.x ||
              piece.y + piece.across + KERF <= other.y ||
              other.y + other.across + KERF <= piece.y;
            expect(apart).toBe(true);
          }
        }
      }
      expect(plan.sheets.flatMap((sheet) => sheet.pieces)).toHaveLength(asked.length);
    }
  });
});
