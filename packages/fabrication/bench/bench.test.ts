import { describe, expect, it } from "vitest";
import type { Build, BuildSetting } from "../build.ts";
import { goldenBench } from "./fixtures/golden.ts";
import { deriveBench } from "./index.ts";
import { pickBenchStock } from "./stock-slots.ts";

// The framed bench, through the one function a caller has: parameters in, a Build out. The
// expected numbers are the ones worked out by hand for the real bench (#696), not recomputed.

const built = (parameters: unknown, setting?: BuildSetting): Build => {
  const derived = deriveBench(parameters, setting);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const partSizes = (build: Build) =>
  Object.fromEntries(
    build.parts.map((part) => [
      part.label,
      [part.count, part.length, part.width, part.thickness, part.material.stock],
    ]),
  );

describe("the golden bench's parts", () => {
  it("are the hand-worked parts, each cut to its size from its stock", () => {
    expect(partSizes(built(goldenBench))).toEqual({
      A: [4, 750, 95, 45, "45 × 95 C16"],
      B: [4, 1450, 95, 45, "45 × 95 C16"],
      C: [4, 460, 95, 45, "45 × 95 C16"],
      D: [1, 460, 95, 45, "45 × 95 C16"],
      E: [2, 550, 145, 45, "45 × 145 C16"],
      F: [1, 460, 145, 45, "45 × 145 C16"],
      G: [1, 1500, 600, 18, "18 mm plywood"],
      H: [1, 1166, 550, 18, "18 mm plywood"],
      J: [3, 460, 500, 18, "18 mm plywood"],
    });
  });

  it("each say what it does, in a line, for the part's card (#698)", () => {
    const does = Object.fromEntries(
      built(goldenBench).parts.map((part) => [part.label, part.does]),
    );

    expect(does.B).toBe(
      "Front and back, top and bottom. The top pair holds the top, the bottom pair the shelf.",
    );
    expect(does.A).toBe("One at each corner, standing on the castor bases.");
    for (const line of Object.values(does)) expect(line).toMatch(/^[A-Z].*\.$/);
  });

  it("say what they do as the bench is: on its legs, with no shelf, braced only at the back", () => {
    const bench = built({
      ...goldenBench,
      castors: null,
      shelf: { ...goldenBench.shelf, on: false },
      braces: { ...goldenBench.braces, ends: false },
    });
    const does = Object.fromEntries(bench.parts.map((part) => [part.label, part.does]));

    expect(does.A).toBe("One at each corner, standing on the floor.");
    expect(does.B).toBe(
      "Front and back, top and bottom. The top pair holds the top, the bottom pair stiffens the frame.",
    );
    expect(does.J).toBe("On the back, so the frame can't rack.");
  });

  it("leave 1170 between the end frames, so the 1166 shelf has 4 mm to spare", () => {
    const build = built(goldenBench);
    const ends = build.parts.find((part) => part.label === "C")?.boxes ?? [];
    const inner = ends.map((box) => box.x).sort((a, b) => a - b);
    const shelf = build.parts.find((part) => part.label === "H")?.boxes[0];

    // The upper and lower rails at each end share an x: the inner faces are the second pair's
    // start and the first pair's end.
    const left = (inner[0] ?? 0) + 45;
    const right = inner[2] ?? 0;
    expect(right - left).toBe(1170);
    expect(shelf?.x).toBe(left + 2);
    expect(shelf?.w).toBe(1166);
  });

  it("give a box for every piece, inside the bench's outline", () => {
    const build = built(goldenBench);
    for (const part of build.parts) {
      expect(part.boxes).toHaveLength(part.count);
      for (const box of part.boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(1500);
        expect(box.y + box.d).toBeLessThanOrEqual(600);
        expect(box.z + box.h).toBeLessThanOrEqual(900);
      }
    }
    expect(build.size).toEqual({ length: 1500, depth: 600, height: 899.6 });
  });
});

describe("the golden bench's cut plan", () => {
  it("is the hand-checked plan, a 3 mm cut between pieces", () => {
    const plan = built(goldenBench).cutPlan;

    expect(
      plan.timber.map((timber) => [
        timber.stock,
        timber.lengths.map((length) => [
          length.cuts.map((cut) => `${cut.label} ${cut.length}`).join(" + "),
          length.used,
        ]),
      ]),
    ).toEqual([
      [
        "45 × 95 C16",
        [
          ["B 1450 + A 750", 2203],
          ["B 1450 + A 750", 2203],
          ["B 1450 + A 750", 2203],
          ["B 1450 + A 750", 2203],
          ["C 460 + C 460 + C 460 + C 460 + D 460", 2312],
        ],
      ],
      ["45 × 145 C16", [["E 550 + E 550 + F 460", 1566]]],
    ]);
    expect(plan.sheets).toHaveLength(1);
    expect(plan.sheets[0]?.sheets).toHaveLength(1);
    expect(plan.sheets[0]?.sheets[0]?.pieces.map((piece) => piece.label).sort()).toEqual([
      "G",
      "H",
      "J",
      "J",
      "J",
    ]);
  });
});

describe("the golden bench's buy list", () => {
  it("buys whole lengths, sheets and packs, and totals the priced lines", () => {
    const list = built(goldenBench).buyList;

    expect(list.lines.map((line) => [line.item, line.needed, line.packs, line.total])).toEqual([
      ["45 × 95 C16, 2.4 m", 5, 5, 3400],
      ["45 × 145 C16, 2.4 m", 1, 1, 1200],
      ["18 mm plywood, 2440 × 1220", 1, 1, 5000],
      ["Wheelwright TD60 castors", 4, 1, 4999],
      // The M6 × 50s given are too short: the 60s to use have no price yet.
      ["M6 × 60 bolts", 16, 16, undefined],
      ["M6 washers", 32, 1, 365],
      ["M6 lock nuts", 16, 1, 350],
      ["5 × 80 screws", 32, 1, 520],
      ["40 mm angle brackets", 12, 12, 1068],
      ["4 × 30 screws", 48, 1, 380],
      ["4 × 40 screws", 43, 1, 420],
    ]);
    expect(list.total).toBe(17702);
    expect(list.unpriced).toBe(1);
  });

  it("lists a line with no price and leaves it out of the total", () => {
    const { price: _price, ...unpriced } = goldenBench.fixings.brackets;
    const list = built({
      ...goldenBench,
      fixings: { ...goldenBench.fixings, brackets: unpriced },
    }).buyList;

    expect(list.lines.find((line) => line.item === "40 mm angle brackets")).toMatchObject({
      needed: 12,
    });
    expect(list.total).toBe(17702 - 1068);
    expect(list.unpriced).toBe(2);
  });
});

/** The golden bench with its castor bolts this long, and its washers this thick. */
const withBolts = (length: number, washer = goldenBench.castors.washer.thickness.value) => ({
  ...goldenBench,
  castors: {
    ...goldenBench.castors,
    bolt: {
      ...goldenBench.castors.bolt,
      length: { ...goldenBench.castors.bolt.length, value: length },
    },
    washer: {
      ...goldenBench.castors.washer,
      thickness: { ...goldenBench.castors.washer.thickness, value: washer },
    },
  },
});

describe("the castor bolts", () => {
  it("are fitted and bought at the length to use, never the one given too short (#699)", () => {
    const build = built(goldenBench);
    const fitting = build.steps.find((step) => step.id === "fit-castors");

    expect(fitting?.fixings[0]).toEqual({ name: "M6 × 60 bolts", count: 16 });
    expect(build.buyList.lines.map((line) => line.item)).not.toContain("M6 × 50 bolts");
    // The price given was for the 50s.
    expect(
      build.buyList.lines.find((line) => line.item === "M6 × 60 bolts")?.price,
    ).toBeUndefined();
  });

  it("show only as the size to buy, with what they pass through a tap away (#763)", () => {
    const build = built(withBolts(60, 2.1));
    const bolts = build.buyList.lines.find(
      (line) => line.kind === "fixing" && /bolts/.test(line.item),
    );

    // 4 plate + 45 base + 2 × 2.1 washers + 5 nut + 2 threads at 1 mm: 60.2, so 65s.
    expect(bolts?.item).toBe("M6 × 65 bolts");
    expect(bolts?.length).toEqual({
      needed: 60.2,
      through: [
        { what: "castor plate", mm: 4 },
        { what: "castor base", mm: 45 },
        { what: "M6 washer", mm: 2.1 },
        { what: "M6 washer", mm: 2.1 },
        { what: "M6 lock nut", mm: 5 },
        { what: "two threads", mm: 2 },
      ],
    });
    // The old plan's 60 means nothing to the owner: nothing says it.
    expect(JSON.stringify(build)).not.toMatch(/M6 × 60/);
    expect(build.findings.map((finding) => finding.kind)).not.toContain("fixing-too-short");
  });

  it("say the owner's own are short, and by how much, when they have the wrong ones", () => {
    const short = (have: readonly string[]) =>
      built(withBolts(60, 2.1), { have }).buyList.lines.find(
        (line) => line.item === "M6 × 65 bolts",
      )?.length?.yoursShort;

    expect(short(["Castor bolts M6 × 60", "Step stool"])).toEqual({ name: "M6 × 60", by: 0.2 });
    expect(short(["M6x60 bolts"])).toEqual({ name: "M6 × 60", by: 0.2 });
    // Every one they have short: the longest, the nearest to doing.
    expect(short(["M6 × 40 bolts", "M6 × 60 set screws"])).toEqual({ name: "M6 × 60", by: 0.2 });
    // Long enough, one of them long enough, another thread, not bolts, or none: nothing to say.
    expect(short(["M6 × 65 bolts"])).toBeUndefined();
    expect(short(["M6 × 50 bolts", "M6 × 65 bolts"])).toBeUndefined();
    expect(short(["M8 × 60 bolts"])).toBeUndefined();
    expect(short(["M6 × 16 screws"])).toBeUndefined();
    expect(short([])).toBeUndefined();
  });

  it("pass a bolt long enough, saying what it passes through all the same", () => {
    const build = built(withBolts(60));

    expect(build.buyList.lines.find((line) => line.item === "M6 × 60 bolts")?.length?.needed).toBe(
      59.2,
    );
  });
});

describe("the making rules", () => {
  it("list the tools the steps need that aren't to hand, with their steps", () => {
    const found = built(goldenBench).findings.find((finding) => finding.kind === "tools-missing");

    expect(found).toEqual({
      kind: "tools-missing",
      tools: [
        { tool: "long-end-support", name: "Support for the long end", steps: [3] },
        { tool: "spanner", name: "Spanner", steps: [4] },
        { tool: "countersink-bit", name: "Countersink bit", steps: [11] },
        { tool: "spirit-level", name: "Spirit level", steps: [12] },
      ],
    });
  });

  it("list the assumed sizes, to check before cutting", () => {
    expect(built(goldenBench).findings.find((finding) => finding.kind === "assumed")).toEqual({
      kind: "assumed",
      sizes: ["kerf", "top.overhang"],
    });
  });

  it("refuse a size with no source", () => {
    const derived = deriveBench({ ...goldenBench, height: { value: 900, unit: "mm" } });

    expect(derived).toEqual({ ok: false, error: [expect.stringContaining("height.source")] });
  });

  it("refuse a size given as words", () => {
    const derived = deriveBench({ ...goldenBench, length: "1500 mm" });

    expect(derived.ok).toBe(false);
  });

  it("refuse a bench too low for its castors", () => {
    const derived = deriveBench({ ...goldenBench, height: { ...goldenBench.height, value: 120 } });

    expect(derived).toEqual({ ok: false, error: [expect.stringContaining("too low")] });
  });

  it("find a part too big for its stock, and leave it out of the plan", () => {
    const build = built({ ...goldenBench, length: { ...goldenBench.length, value: 2600 } });

    expect(build.findings).toContainEqual({
      kind: "too-big-for-stock",
      label: "B",
      stock: "45 × 95 C16",
    });
    expect(build.cutPlan.timber[0]?.lengths.flatMap((length) => length.cuts)).not.toContainEqual(
      expect.objectContaining({ label: "B" }),
    );
  });
});

describe("changing one parameter", () => {
  const changed = (before: Build, after: Build) =>
    Object.keys(partSizes(before)).filter(
      (label) =>
        JSON.stringify(partSizes(before)[label]) !== JSON.stringify(partSizes(after)[label]),
    );

  it("300 mm longer changes the long rails, the top and the shelf, and nothing else", () => {
    const before = built(goldenBench);
    const after = built({ ...goldenBench, length: { ...goldenBench.length, value: 1800 } });

    expect(changed(before, after)).toEqual(["B", "G", "H"]);
    expect(partSizes(after).B?.[1]).toBe(1750);
    expect(partSizes(after).G?.[1]).toBe(1800);
    expect(partSizes(after).H?.[1]).toBe(1466);
    expect(after.size.height).toBe(before.size.height);
  });

  it("castors 87 mm taller shorten the legs and the end braces by 87, and nothing else", () => {
    const before = built(goldenBench);
    const taller = {
      ...goldenBench,
      castors: {
        ...goldenBench.castors,
        height: { ...goldenBench.castors.height, value: 86.6 + 87 },
      },
    };
    const after = built(taller);

    expect(changed(before, after)).toEqual(["A", "J"]);
    expect(partSizes(after).A?.[1]).toBe(663);
    expect(partSizes(after).J?.[2]).toBe(413);
    expect(after.buyList.total).toBe(before.buyList.total);
  });

  it("taking the castors off drops the bases, the castors and their bolts, and lengthens the legs", () => {
    const after = built({ ...goldenBench, castors: null });

    expect(partSizes(after).A?.[1]).toBe(882);
    expect(partSizes(after).E).toBeUndefined();
    expect(after.buyList.lines.map((line) => line.item)).not.toContain("M6 × 50 bolts");
    expect(after.steps.map((step) => step.title)).not.toContain("Fit the castors to the bases");
    expect(after.size.height).toBe(900);
  });

  it("leaving the castors out is the same as taking them off, as a merge patch's null does (#697)", () => {
    const { castors: _castors, ...withoutCastors } = goldenBench;

    expect(built(withoutCastors)).toEqual(built({ ...goldenBench, castors: null }));
  });
});

describe("choosing the stock (#704)", () => {
  const picked = (parameters: unknown, pick: { stock: string; option: string }) => {
    const done = pickBenchStock(parameters, pick);
    if (!done.ok) throw new Error(done.error.join("\n"));
    return done.value;
  };
  const cls = () => picked(goldenBench, { stock: "45 × 95 C16", option: "cls-38x89" });

  it("offers the frame timber's options, the recommended first, each costed for this bench", () => {
    const frame = built(goldenBench).options.find((options) => options.stock === "45 × 95 C16");

    expect(frame?.name).toBe("Frame timber");
    expect(frame?.for).toBe("Legs, long rails, end rails and shelf support");
    expect(
      frame?.choices.map((choice) => [
        choice.title,
        choice.total,
        choice.buys,
        choice.picked,
        choice.recommended,
      ]),
    ).toEqual([
      ["Sawn C16, 45 × 95", 3400, "5 lengths of 2.4 m", true, true],
      ["CLS, 38 × 89", 3150, "5 lengths of 2.4 m", false, false],
      ["Treated, 47 × 100", 4100, "5 lengths of 2.4 m", false, false],
    ]);
    expect(frame?.choices[0]?.says).toEqual([{ text: "Fine in a garage", tone: "fine" }]);
    expect(frame?.choices[2]?.says).toEqual([{ text: "Not needed indoors", tone: "warn" }]);
  });

  it("offers one sheet's options for every piece cut from it", () => {
    const sheet = built(goldenBench).options.find((options) => options.stock === "18 mm plywood");

    expect(sheet?.for).toBe("Top, shelf and braces");
    expect(sheet?.choices.map((choice) => [choice.title, choice.total, choice.picked])).toEqual([
      ["Plywood, 18 mm", 5000, true],
      ["OSB, 18 mm", 3200, false],
      ["MDF, 18 mm", 2800, false],
    ]);
  });

  it("swapping the frame from 45 × 95 to 38 × 89 changes the parts, cut plan and buy list, and nothing else", () => {
    const before = built(goldenBench);
    const after = built(cls());

    // 38 thick: the end rails and supports 550 − 2 × 38 = 474; the end frames 89 + 38 a side,
    // so 1450 − 254 = 1196 between them and a 1192 shelf.
    expect(partSizes(after)).toEqual({
      A: [4, 750, 89, 38, "38 × 89 CLS"],
      B: [4, 1450, 89, 38, "38 × 89 CLS"],
      C: [4, 474, 89, 38, "38 × 89 CLS"],
      D: [1, 474, 89, 38, "38 × 89 CLS"],
      E: [2, 550, 145, 45, "45 × 145 C16"],
      F: [1, 474, 145, 45, "45 × 145 C16"],
      G: [1, 1500, 600, 18, "18 mm plywood"],
      H: [1, 1192, 550, 18, "18 mm plywood"],
      J: [3, 474, 500, 18, "18 mm plywood"],
    });
    expect(
      after.cutPlan.timber.map((timber) => [
        timber.stock,
        timber.lengths.map((length) => length.cuts.map((cut) => `${cut.label} ${cut.length}`)),
      ]),
    ).toEqual([
      [
        "38 × 89 CLS",
        [
          ["B 1450", "A 750"],
          ["B 1450", "A 750"],
          ["B 1450", "A 750"],
          ["B 1450", "A 750"],
          ["C 474", "C 474", "C 474", "C 474", "D 474"],
        ],
      ],
      ["45 × 145 C16", [["E 550", "E 550", "F 474"]]],
    ]);
    expect(after.buyList.lines[0]).toMatchObject({
      item: "38 × 89 CLS, 2.4 m",
      packs: 5,
      total: 3150,
    });
    expect(after.buyList.total).toBe(17702 - 3400 + 3150);

    expect(after.size).toEqual(before.size);
    expect(after.fitted).toEqual(before.fitted);
    expect(after.steps.map((step) => step.title)).toEqual(before.steps.map((step) => step.title));
    expect(after.findings).toEqual(before.findings);
    expect(after.buyList.lines.slice(1)).toEqual(before.buyList.lines.slice(1));
  });

  it("picking the first timber again puts the bench back as it was, its price kept", () => {
    const back = picked(cls(), { stock: "38 × 89 CLS", option: "c16-45x95" });

    expect(partSizes(built(back))).toEqual(partSizes(built(goldenBench)));
    expect(built(back).buyList).toEqual(built(goldenBench).buyList);
  });

  it("flags MDF in a damp garage, and offers it saying so", () => {
    const damp = { ...goldenBench, damp: true };
    const mdf = built(picked(damp, { stock: "18 mm plywood", option: "mdf-18" }));

    expect(mdf.findings).toContainEqual({
      kind: "wrong-stock",
      stock: "18 mm MDF",
      parts: ["Top", "Shelf", "Braces"],
      why: "It swells in a damp garage.",
    });
    const offered = built(damp)
      .options.find((options) => options.stock === "18 mm plywood")
      ?.choices.find((choice) => choice.option === "mdf-18");
    expect(offered?.says).toEqual([{ text: "Swells in a damp garage", tone: "warn" }]);
    expect(
      built(picked(goldenBench, { stock: "18 mm plywood", option: "mdf-18" })).findings,
    ).not.toContainEqual(expect.objectContaining({ kind: "wrong-stock" }));
  });

  it("flags CLS used for the castor bases as too slim", () => {
    const { frame } = goldenBench;
    const slim = built({
      ...goldenBench,
      frame: { ...frame, wide: { ...frame.timber, name: "38 × 89 CLS", option: "cls-38x89" } },
    });

    expect(slim.findings).toContainEqual({
      kind: "wrong-stock",
      stock: "38 × 89 CLS",
      parts: ["Castor bases", "Top support"],
      why: "It's too slim for the castor bases' bolts and the top's support.",
    });
  });

  /** The golden bench with its frame timber changed: its name, length or price. */
  const withFrame = (timber: Record<string, unknown>) => ({
    ...goldenBench,
    frame: { ...goldenBench.frame, timber: { ...goldenBench.frame.timber, ...timber } },
  });
  const frameOf = (parameters: unknown) =>
    built(parameters).options.find((options) => options.name === "Frame timber");
  // In 3 m lengths, B and B fit one, and A, A, A and C another: 4 lengths at £9.00.
  const inThreeMetres = withFrame({
    length: {
      value: 3000,
      unit: "mm",
      source: { kind: "specified", reference: "Woodstore's page" },
    },
    price: { pence: 900, shop: "Woodstore", link: "https://shop.example/c16-45x95-3m" },
  });

  it("costs the timber the bench uses as it is, at its own length and price", () => {
    const [c16] = frameOf(inThreeMetres)?.choices ?? [];

    expect(built(inThreeMetres).buyList.lines[0]).toMatchObject({ packs: 4, total: 3600 });
    expect(c16).toMatchObject({
      option: "c16-45x95",
      picked: true,
      buys: "4 lengths of 3 m",
      total: 3600,
      price: { pence: 900, shop: "Woodstore", link: "https://shop.example/c16-45x95-3m" },
    });
  });

  it("picking another and then the first again puts back its own length and price", () => {
    const away = picked(inThreeMetres, { stock: "45 × 95 C16", option: "cls-38x89" });
    // Offered while it's swapped out, it's still the 3 m lengths at £9.00.
    expect(frameOf(away)?.choices.find((choice) => choice.option === "c16-45x95")).toMatchObject({
      buys: "4 lengths of 3 m",
      total: 3600,
    });

    const back = built(picked(away, { stock: "38 × 89 CLS", option: "c16-45x95" }));
    expect(back.buyList.lines[0]).toMatchObject({
      item: "45 × 95 C16, 3 m",
      packs: 4,
      total: 3600,
    });
    expect(back.buyList.total).toBe(built(inThreeMetres).buyList.total);
  });

  it("offers a price with no shop as one, so it shows as unsourced", () => {
    const noShop = { ...goldenBench, prices: { ...goldenBench.prices, "osb-18": { pence: 3200 } } };
    const osb = built(noShop)
      .options.find((options) => options.stock === "18 mm plywood")
      ?.choices.find((choice) => choice.option === "osb-18");

    expect(osb?.price).toEqual({ pence: 3200 });
    expect(osb?.total).toBe(3200);
  });

  it("shows stock that's no option as its own first choice, picked", () => {
    const frame = frameOf(withFrame({ name: "45 × 95 C24" }));

    expect(frame?.choices.map((choice) => [choice.title, choice.option, choice.picked])).toEqual([
      ["45 × 95 C24", undefined, true],
      ["Sawn C16, 45 × 95", "c16-45x95", false],
      ["CLS, 38 × 89", "cls-38x89", false],
      ["Treated, 47 × 100", "treated-47x100", false],
    ]);
    expect(frame?.choices[0]).toMatchObject({ why: "What the Build uses.", total: 3400 });
  });

  it("judges an option for every slot its stock fills: the frame and wide timber the same", () => {
    const { timber } = goldenBench.frame;
    const shared = built({ ...goldenBench, frame: { ...goldenBench.frame, wide: timber } });
    const says = Object.fromEntries(
      (shared.options.find((options) => options.stock === "45 × 95 C16")?.choices ?? []).map(
        (choice) => [choice.option, choice.says.map(({ text }) => text)],
      ),
    );

    expect(says["c16-45x145"]).toEqual(["Not made for the frame"]);
    expect(says["c16-45x95"]).toEqual(["Not made for the wide pieces"]);
    expect(says["cls-38x89"]).toEqual(["Too slim for the castor bases", "Less wood for screws"]);
  });

  it("refuses a pick of stock the bench doesn't use, or of an option it doesn't know", () => {
    expect(pickBenchStock(goldenBench, { stock: "Oak", option: "cls-38x89" }).ok).toBe(false);
    expect(pickBenchStock(goldenBench, { stock: "45 × 95 C16", option: "oak" }).ok).toBe(false);
    expect(pickBenchStock(goldenBench, { stock: "45 × 95 C16", option: "mdf-18" }).ok).toBe(false);
  });
});

describe("the golden bench's steps", () => {
  it("are the twelve steps in the order it's built, each with its parts", () => {
    expect(built(goldenBench).steps.map((step) => [step.number, step.title, step.parts])).toEqual([
      [1, "Check what's arrived", []],
      [2, "Mark the lengths", ["A", "B", "C", "D", "E", "F"]],
      [3, "Cut and label the timber", ["A", "B", "C", "D", "E", "F"]],
      [4, "Fit the castors to the bases", ["E"]],
      [5, "Make the two end frames", ["A", "C"]],
      [6, "Join the end frames with the long rails", ["B"]],
      [7, "Stand the frame on its bases", ["E"]],
      [8, "Fit the supports", ["F", "D"]],
      [9, "Fit the shelf", ["H"]],
      [10, "Fit the braces", ["J"]],
      [11, "Fit the top", ["G"]],
      [12, "Check the bench", []],
    ]);
  });

  it("say which parts each puts on the bench, so the 3D view can build it up step by step (#699)", () => {
    expect(built(goldenBench).steps.map((step) => [step.number, step.adds])).toEqual([
      [1, []],
      [2, []],
      [3, []],
      [4, ["E"]],
      [5, ["A", "C"]],
      [6, ["B"]],
      [7, []],
      [8, ["F", "D"]],
      [9, ["H"]],
      [10, ["J"]],
      [11, ["G"]],
      [12, []],
    ]);
  });

  it("fit the castors to the bases, so they come with them in the 3D view (#699)", () => {
    expect(built(goldenBench).fitted.map((each) => [each.name, each.on])).toEqual([
      ["Wheelwright TD60 castors", "E"],
    ]);
  });

  it("say how a step can be done, the way in use and the others not yet to hand (#699)", () => {
    const ways = (build: Build) => build.steps.find((step) => step.title.startsWith("Cut"))?.ways;

    expect(ways(built(goldenBench))).toEqual([
      { tool: "hand-saw", name: "Hand saw", using: true, toHand: true },
      { tool: "circular-saw", name: "Circular saw", using: false, toHand: false },
      { tool: "mitre-saw", name: "Mitre saw", using: false, toHand: false },
    ]);
    expect(ways(built({ ...goldenBench, tools: [...goldenBench.tools, "circular-saw"] }))).toEqual([
      { tool: "hand-saw", name: "Hand saw", using: false, toHand: true },
      { tool: "circular-saw", name: "Circular saw", using: true, toHand: true },
      { tool: "mitre-saw", name: "Mitre saw", using: false, toHand: false },
    ]);
    expect(built(goldenBench).steps.find((step) => step.number === 5)?.ways).toEqual([]);
  });

  it("cut with the hand saw on the folding workbench, until a circular saw is to hand", () => {
    const cutStep = (build: Build) => build.steps.find((step) => step.title.startsWith("Cut"));
    const handSaw = cutStep(built(goldenBench));
    const circular = cutStep(
      built({ ...goldenBench, tools: [...goldenBench.tools, "circular-saw", "ear-defenders"] }),
    );

    const said = (step: typeof handSaw) => step?.actions.map((action) => action.howTo).join(" ");
    expect(handSaw?.tools.map((tool) => tool.tool)).toContain("folding-workbench");
    expect(said(handSaw)).toContain("waste side");
    expect(said(handSaw)).toContain("hold the offcut");
    expect(circular?.tools.map((tool) => tool.tool)).toContain("circular-saw");
    expect(circular?.safety.map((tool) => tool.tool)).toEqual(["safety-glasses", "ear-defenders"]);
    expect(said(circular)).not.toEqual(said(handSaw));
  });

  it("support the long end as it's cut, so it doesn't sag and pinch the saw, with either saw (#699)", () => {
    for (const circular of [false, true]) {
      const tools = circular ? [...goldenBench.tools, "circular-saw"] : goldenBench.tools;
      const cut = built({ ...goldenBench, tools }).steps.find((step) => step.id === "cut-timber");

      expect(cut?.tools).toContainEqual({
        tool: "long-end-support",
        name: "Support for the long end",
        toHand: false,
      });
      expect(cut?.actions[1]?.howTo).toBe(
        circular
          ? "Rest the long end on a support as high as what it's clamped to (a sawhorse, a stool or the stack of timber), so it stays level and can't sag and pinch the saw."
          : "Rest the long end on a support as high as the jaws (a sawhorse, a stool or the stack of timber), so it stays level and can't sag and pinch the saw.",
      );
      // Cut and label: each piece's letter goes on it as it comes off.
      expect(cut?.actions.at(-1)?.howTo).toBe(
        "As each piece comes off, write its letter on it in pencil, and stand it with the others of its letter.",
      );
    }
  });

  it("say every action twice, show me how and just the numbers", () => {
    for (const step of built(goldenBench).steps) {
      expect(step.actions.length).toBeGreaterThan(0);
      for (const action of step.actions) {
        expect(action.howTo.length).toBeGreaterThan(action.numbers.length);
        expect(action.numbers.length).toBeGreaterThan(0);
      }
    }
  });

  it("make the end frames with their sizes, two screws a joint and a check for square", () => {
    const step = built(goldenBench).steps.find((step) => step.number === 5);

    expect(step?.fixings).toEqual([{ name: "5 × 80 screws", count: 16 }]);
    expect(step?.safety.map((tool) => tool.tool)).toEqual(["safety-glasses"]);
    expect(step?.closeUp?.dimensions.map((line) => line.mm)).toEqual([460, 750, 250]);
    expect(step?.closeUp?.fixings).toHaveLength(8);
    expect(step?.check.says).toBe(
      "Measure corner to corner both ways. The same within 2 mm means it's square.",
    );
    expect(step?.words).toEqual(["flush", "square", "pilot hole"]);
  });

  it("need a helper to stand the frame up", () => {
    const helped = built(goldenBench)
      .steps.filter((step) => step.helper)
      .map((step) => step.number);

    expect(helped).toEqual([6, 7]);
  });

  it("point every word they use into the glossary", () => {
    const build = built(goldenBench);
    const words = build.glossary.map((entry) => entry.word);

    for (const step of build.steps) for (const word of step.words) expect(words).toContain(word);
    expect(build.glossary.find((entry) => entry.word === "pilot hole")?.means).toBe(
      "A small hole drilled first, so the screw goes in straight and the wood doesn't split.",
    );
  });
});

describe("the golden bench's steps, at the bench (#699)", () => {
  const stepOf = (build: Build, id: string) => build.steps.find((step) => step.id === id);

  it("each keep one ID whatever else the bench has, so progress stays on its step", () => {
    const ids = (build: Build) => build.steps.map((step) => step.id);

    expect(ids(built(goldenBench))).toEqual([
      "check-delivery",
      "mark-lengths",
      "cut-timber",
      "fit-castors",
      "end-frames",
      "long-rails",
      "stand-on-bases",
      "fit-supports",
      "fit-shelf",
      "fit-braces",
      "fit-top",
      "check-bench",
    ]);
    const plain = built({
      ...goldenBench,
      castors: null,
      shelf: { ...goldenBench.shelf, on: false },
    });
    expect(ids(plain)).toEqual([
      "check-delivery",
      "mark-lengths",
      "cut-timber",
      "end-frames",
      "long-rails",
      "fit-supports",
      "fit-braces",
      "fit-top",
      "check-bench",
    ]);
    expect(stepOf(plain, "fit-top")?.title).toBe("Fit the top");
  });

  it("list the tape measure, and the square, in the steps that measure and square", () => {
    const build = built(goldenBench);
    const tools = (id: string) => stepOf(build, id)?.tools.map((tool) => tool.tool);

    for (const id of ["end-frames", "long-rails", "fit-braces"]) {
      expect(tools(id)).toContain("tape-measure");
      expect(tools(id)).toContain(id === "fit-braces" ? "drill-driver" : "square");
    }
  });

  it("hold each leg to its castor base with two brackets, each with its screws in pilot holes", () => {
    const build = built(goldenBench);
    const standing = stepOf(build, "stand-on-bases");

    expect(standing?.fixings).toEqual([
      { name: "40 mm angle brackets", count: 8 },
      { name: "4 × 30 screws", count: 32 },
    ]);
    expect(standing?.actions.map((action) => action.numbers)).toContain("2 brackets a leg.");
    expect(standing?.actions.at(-1)?.howTo).toBe(
      "Hold each bracket tight into its corner and mark through its holes. Drill a 3 mm pilot hole at each mark, then drive a screw into each hole.",
    );
    expect(stepOf(build, "fit-supports")?.fixings).toEqual([
      { name: "40 mm angle brackets", count: 4 },
      { name: "4 × 30 screws", count: 16 },
    ]);
  });

  it("screw the brackets with the sheet screws when no bracket screws are given", () => {
    const { bracketScrews: _bracketScrews, ...fixings } = goldenBench.fixings;
    const build = built({ ...goldenBench, fixings });

    expect(stepOf(build, "fit-supports")?.fixings).toEqual([
      { name: "40 mm angle brackets", count: 4 },
      { name: "4 × 40 screws", count: 16 },
    ]);
    expect(build.buyList.lines.find((line) => line.item === "4 × 40 screws")?.needed).toBe(43 + 48);
  });

  it("countersink the top's screws so their heads sit flush", () => {
    const build = built(goldenBench);
    const top = stepOf(build, "fit-top");

    expect(top?.tools.map((tool) => tool.tool)).toContain("countersink-bit");
    expect(top?.actions.map((action) => action.howTo)).toContain(
      "Countersink each hole with the countersink bit, a little at a time, until a screw's head sits flush with the top.",
    );
    expect(build.glossary.find((entry) => entry.word === "countersink")?.means).toBe(
      "A cone-shaped dip cut into the top of a screw hole, so the screw's head sits flush.",
    );
  });

  it("say every size to the whole mm, though the bench is 899.6 high on its castors", () => {
    const build = built(goldenBench);
    const said = build.steps.flatMap((step) => [
      ...step.actions.flatMap((action) => [action.howTo, action.numbers]),
      ...(step.closeUp?.notes ?? []),
    ]);

    expect(build.size.height).toBe(899.6);
    expect(stepOf(build, "check-bench")?.actions[1]?.howTo).toBe(
      "Measure the height to the top: it should be 900.",
    );
    for (const line of said) expect(line).not.toMatch(/\d\.\d/);
  });
});
