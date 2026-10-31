import type { BuildRecipe } from "@courtyard/contract";
import { clashesOf } from "../assembly/space.ts";
import type { Box, Finding, Part } from "../build.ts";
import { type LoadClass, loadClassOf, stiffnessOf } from "../loads.ts";
import { castorFixingsTaken } from "./castors.ts";
import { BOX_EDGE } from "./fixings.ts";
import { type Axis, alongOf, contactOf, extent, span, tenth, thinnest } from "./geometry.ts";
import { type Layout, said, stockIn, words } from "./layout.ts";

// The checks any recipe gets (#771), each a finding with a plain fix. Sag: each sheet resting on
// supports, under the load said in plain words, against a 600th of its span. Tipping: its height
// against how far apart its feet are the narrow way. Racking: legs and rails with no brace.
// Screws: long enough to grip what they go into, and not out the far side.

/** A shelf may sag a 600th of its span: a 1200 mm shelf, 2 mm (woodbin.com, the Sagulator). */
const SAG_RATIO = 600;
/** Sheet thicknesses sold, mm, for a thicker one to use. */
const THICKNESSES = [12, 15, 18, 25] as const;
const GRAVITY = 9.81;

/**
 * Taller than this many times its feet are apart wants a wider base: Bito's shelving guidance
 * anchors past 5 to 1, and past 4 to 1 for units with doors; the stricter is used.
 */
const TIP_RATIO = 4;

/**
 * The least a screw's point goes into what it grips, in its diameters: EN 1995-1-1's least
 * point-side penetration for a threaded nail or a screw up to 6 mm.
 */
const GRIP = 6;
/** Screw lengths sold, mm, for a longer or shorter one to use. */
const SCREW_LENGTHS = [16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120] as const;

/** A sheet's sag under its load, mm, resting on two supports `span` apart. */
const sagOf = (span: number, thickness: number, modulus: number, load: LoadClass) => {
  const pressure = (load.kgPerM2 * GRAVITY) / 1e6;
  return (5 * pressure * span ** 4) / (32 * modulus * thickness ** 3);
};

/** The longest span a sheet takes under its load, sagging a 600th of it. */
const mostSpan = (thickness: number, modulus: number, load: LoadClass) => {
  const pressure = (load.kgPerM2 * GRAVITY) / 1e6;
  return Math.round(Math.cbrt((32 * modulus * thickness ** 3) / (5 * SAG_RATIO * pressure)));
};

/**
 * The span a sheet bridges: for each way across it, the widest gap between the supports under it
 * (each narrower than half the sheet that way), and the shorter of the two ways that have one.
 */
const spanOf = (sheet: Box, under: readonly Box[]) => {
  const spans = (["x", "y"] as const).flatMap((axis: Axis) => {
    const across = extent(sheet, axis);
    const runs = under
      .filter((support) => extent(support, axis) < across / 2)
      .map((support) => span(support, axis))
      .sort((a, b) => a.from - b.from);
    let widest = 0;
    let reached: number | undefined;
    for (const run of runs) {
      if (reached !== undefined) widest = Math.max(widest, run.from - reached);
      reached = Math.max(reached ?? run.to, run.to);
    }
    return widest > 0 ? [widest] : [];
  });
  return spans.length > 0 ? Math.min(...spans) : undefined;
};

const sags = (recipe: BuildRecipe, layout: Layout, parts: readonly Part[]): Finding[] => {
  const load = loadClassOf(recipe.load);
  const of = stockIn(recipe);
  const boxes = layout.placed.flatMap((piece) => piece.boxes.map((at) => ({ piece, at })));
  return layout.placed.flatMap((piece): Finding[] => {
    const [sheet] = piece.boxes;
    if (piece.kind !== "sheet" || sheet === undefined || thinnest(sheet) !== "z") return [];
    const under = boxes
      .filter(({ piece: other, at }) => {
        if (other === piece) return false;
        const contact = contactOf(sheet, at);
        return contact?.across === "z" && Math.abs(at.z + at.h - sheet.z) < 0.05;
      })
      .map(({ at }) => at);
    const bridged = spanOf(sheet, under);
    if (bridged === undefined) return [];
    const sheetStock = of(piece.stock, "sheet");
    const modulusAt = (thick: number) => stiffnessOf(sheetStock, thick).modulus;
    const thickness = piece.thickness;
    const modulus = modulusAt(thickness);
    const allowed = bridged / SAG_RATIO;
    const sag = sagOf(bridged, thickness, modulus, load);
    if (sag <= allowed) return [];
    const holds = (spanned: number, thick: number) =>
      sagOf(spanned, thick, modulusAt(thick), load) <= spanned / SAG_RATIO;
    const thicker = THICKNESSES.filter((mm) => mm > thickness);
    const alone = thicker.find((mm) => holds(bridged, mm));
    const centre = holds(bridged / 2, thickness);
    const both = thicker.find((mm) => holds(bridged / 2, mm));
    // Past what a centre support and the thickest sheet take, the supports closer together.
    const thickest = thicker.at(-1) ?? thickness;
    const closer = Math.floor((2 * mostSpan(thickest, modulusAt(thickest), load)) / 10) * 10;
    const fixes = [
      ...(alone ? [`Use ${alone} mm`] : []),
      ...(centre ? ["Add a centre support"] : []),
      ...(!alone && !centre && both ? [`Add a centre support and use ${both} mm`] : []),
      ...(!alone && !centre && !both
        ? [`Add a centre support and use ${thickest} mm, its supports at most ${closer} mm apart`]
        : []),
    ];
    return [
      {
        kind: "sags",
        label: parts.find((part) => part.name === piece.name)?.label ?? "",
        name: piece.name,
        span: tenth(bridged),
        thickness,
        sag: tenth(sag),
        allowed: tenth(allowed),
        most: mostSpan(thickness, modulus, load),
        load,
        fixes,
      },
    ];
  });
};

/**
 * What it stands on, each way: its pieces on the floor, or its castors by their middles, where a
 * swivel castor turns; its wheel trails round that point, so the plate's outer edge isn't where it
 * stands.
 */
const feetOf = (layout: Layout) => {
  const castors = layout.fitted.flatMap((piece) => piece.boxes);
  const placed = layout.placed.flatMap((piece) => piece.boxes);
  const floor = Math.min(...[...castors, ...placed].map((at) => at.z));
  const onFloor = (at: Box) => Math.abs(at.z - floor) < 0.05;
  return (axis: Axis) => [
    ...placed.filter(onFloor).map((at) => span(at, axis)),
    ...castors.filter(onFloor).map((at) => {
      const middle = (span(at, axis).from + span(at, axis).to) / 2;
      return { from: middle, to: middle };
    }),
  ];
};

const tips = (layout: Layout, height: number): Finding[] => {
  const feet = feetOf(layout);
  const reach = (axis: Axis) =>
    Math.max(...feet(axis).map((at) => at.to)) - Math.min(...feet(axis).map((at) => at.from));
  const endToEnd = reach("x");
  const frontToBack = reach("y");
  const narrow = Math.min(endToEnd, frontToBack);
  if (height <= TIP_RATIO * narrow) return [];
  const way = frontToBack <= endToEnd ? "front to back" : "end to end";
  const wider = Math.ceil(height / TIP_RATIO / 10) * 10;
  return [
    {
      kind: "tips",
      height: tenth(height),
      feet: tenth(narrow),
      way,
      fixes: [`Widen its feet to ${wider} mm ${way}`],
      advice: "Or fix it to the wall with a bracket at the top.",
    },
  ];
};

const racks = (recipe: BuildRecipe): Finding[] =>
  recipe.groups.flatMap((legs): Finding[] => {
    if (legs.kind !== "legs") return [];
    const frames = recipe.groups.filter(
      (group) => group.kind === "frame" && group.legs === legs.id,
    );
    const braced = recipe.groups.some(
      (group) =>
        group.kind === "brace" && (group.on === legs.id || frames.some((f) => f.id === group.on)),
    );
    if (frames.length === 0 || braced) return [];
    return [{ kind: "racks", frame: said(words(legs.id)), fixes: ["Add a brace or a back panel"] }];
  });

/** "4 × 40 screws": its diameter and length, mm. */
const screwSize = (name: string) => {
  const sized = /(\d+(?:\.\d+)?)\s*[×x]\s*(\d+)/i.exec(name);
  return sized ? { diameter: Number(sized[1]), length: Number(sized[2]) } : undefined;
};

/**
 * Screws in each screwed joint, each sheet-screwed joint and each box: through the thinner piece
 * (the sheet, for a sheet), into the other, gripping it at least 6 diameters and not out the far
 * side. A joint's first contact stands for all of it.
 */
const screwLengths = (recipe: BuildRecipe, layout: Layout): Finding[] => {
  const of = stockIn(recipe);
  const boxesOf = (id: string) =>
    layout.placed.filter((piece) => piece.from === id).flatMap((piece) => piece.boxes);
  const checked = (
    screwsId: string,
    joint: string,
    pairs: readonly (readonly [Box, Box])[],
  ): Finding[] => {
    const screws = of(screwsId, "fixing");
    const size = screwSize(screws.name);
    if (size === undefined) return [];
    const least = GRIP * size.diameter;
    const found = new Map<"too short" | "too long", Finding>();
    for (const [a, b] of pairs) {
      const contact = contactOf(a, b);
      if (contact === null) continue;
      const [first, second] = [extent(a, contact.across), extent(b, contact.across)];
      const through = Math.min(first, second);
      const room = Math.max(first, second);
      const into = size.length - through;
      // Out the far side is the worse: a cleat too thin to grip is still too long.
      const problem = into > room ? "too long" : into < least ? "too short" : undefined;
      if (problem === undefined || found.has(problem)) continue;
      // The shortest that grips and stays in; else, too long, the longest that stays in.
      const use =
        SCREW_LENGTHS.find((mm) => mm - through >= least && mm - through <= room) ??
        (problem === "too long"
          ? SCREW_LENGTHS.findLast((mm) => mm - through <= room && mm > through)
          : undefined);
      found.set(problem, {
        kind: "screw-length",
        screws: screws.name,
        joint,
        problem,
        through,
        into,
        least,
        room,
        fixes: [
          use === undefined ? "Bolt it through instead" : `Use ${size.diameter} × ${use} screws`,
        ],
      });
    }
    return [...found.values()];
  };
  const pairsOf = (a: readonly Box[], b: readonly Box[]) =>
    a.flatMap((one) => b.map((other) => [one, other] as const));

  return [
    ...recipe.joints.flatMap((joint) => {
      if (joint.kind !== "screwed" && joint.kind !== "sheet-screwed") return [];
      const [a, b] = joint.joins;
      const named = `${said(words(a))} to ${said(words(b))}`;
      if (joint.kind === "screwed") {
        return checked(joint.fixing, named, pairsOf(boxesOf(a), boxesOf(b)));
      }
      // A sheet's screws go through its face, into the edge or face under it.
      const sheets = boxesOf(a);
      const frame = recipe.groups.find((group) => group.id === b);
      const onto = [b, ...(frame?.kind === "frame" ? [frame.legs] : [])].flatMap(boxesOf);
      const pairs = pairsOf(sheets, onto).filter(
        ([sheet, other]) => contactOf(sheet, other)?.across === thinnest(sheet),
      );
      return checked(joint.fixing, named, pairs);
    }),
    ...recipe.groups.flatMap((group) => {
      if (group.kind !== "box") return [];
      // Its cleats are screwed face to face, its panels into each other's edges: each its own
      // finding, so screws too long for one and too short for the other aren't one joint.
      const cleats = new Set(
        recipe.groups.flatMap((shelf) =>
          shelf.kind === "shelf" && shelf.on === group.id && shelf.rests === "cleats"
            ? [`${words(shelf.id)} cleats`]
            : [],
        ),
      );
      const held = layout.placed
        .filter((piece) => piece.from === group.id)
        .flatMap((piece) => piece.boxes.map((at) => ({ at, cleat: cleats.has(piece.name) })));
      // Only where its fixings are counted: a cleat's end on the back isn't screwed.
      const pairs = held.flatMap((one, index) =>
        held.slice(index + 1).flatMap((other) => {
          const contact = contactOf(one.at, other.at);
          return contact !== null && contact.face[alongOf(contact)] >= BOX_EDGE
            ? [{ pair: [one.at, other.at] as const, other, one }]
            : [];
        }),
      );
      const box = said(words(group.id));
      return [
        ...checked(
          group.fixing,
          `the ${box}'s panels`,
          pairs.filter(({ one, other }) => !one.cleat && !other.cleat).map(({ pair }) => pair),
        ),
        ...checked(
          group.fixing,
          `the ${box}'s cleats`,
          pairs.filter(({ one, other }) => one.cleat || other.cleat).map(({ pair }) => pair),
        ),
      ];
    }),
  ];
};

/**
 * The whole Build as one (#835): its castors' nuts and bolt ends, the brackets at the feet on
 * their bases, and every piece, each keeping its own space. A fixing that takes a piece's says
 * its own fixes.
 */
const clashes = (recipe: BuildRecipe, layout: Layout): Finding[] => {
  const fixings = castorFixingsTaken(recipe, layout);
  const taken = [
    ...fixings,
    ...layout.placed.map((piece) => ({ name: piece.name, boxes: piece.boxes })),
    ...layout.fitted.map((each) => ({ name: words(each.from), boxes: each.boxes })),
  ];
  return clashesOf(taken).map((clash) => ({
    kind: "clashes",
    ...clash,
    fixes: fixings.find((each) => each.name === clash.what)?.fixes ?? [
      "Change their sizes so each keeps its own space",
    ],
  }));
};

/** Every check's findings for a recipe laid out, its parts lettered and its height. */
export const checksOf = (options: {
  recipe: BuildRecipe;
  layout: Layout;
  parts: readonly Part[];
  height: number;
}): Finding[] => [
  ...sags(options.recipe, options.layout, options.parts),
  ...tips(options.layout, options.height),
  ...racks(options.recipe),
  ...screwLengths(options.recipe, options.layout),
  ...clashes(options.recipe, options.layout),
];
