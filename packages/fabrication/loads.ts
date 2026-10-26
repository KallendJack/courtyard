import type { Sheet } from "./stock.ts";

// What a Build carries and what its sheets take (#771): the load said in plain words read as a
// load class, each from a source and set conservatively (the heaviest class any word says, and the
// heaviest when no word is known); and how stiff each sheet is, so a shelf's sag is worked out.

export type LoadClassName = "medium" | "heavy" | "very heavy";

/** A load class: how much a square metre of shelf carries, and where that's from. */
type LoadClassRow = { readonly kgPerM2: number; readonly reference: string };

export const LOAD_CLASSES: Readonly<Record<LoadClassName, LoadClassRow>> = {
  medium: {
    kgPerM2: 100,
    reference:
      "A full bookshelf's least, 9 kg a running foot on a 300 mm shelf (woodbin.com, the Sagulator); EN 16121:2023's general shelf test, 1.0 kg/dm²",
  },
  heavy: {
    kgPerM2: 200,
    reference:
      "A full bookshelf's most, 18 kg a running foot on a 300 mm shelf (woodbin.com, the Sagulator); EN 16121:2013's severe shelf test, 2.0 kg/dm²",
  },
  "very heavy": {
    kgPerM2: 300,
    reference:
      "Canned goods, 60 lb a running foot on a 12 inch shelf (JLC, Practical engineering: down with sagging shelves)",
  },
};

/**
 * The words that say each class, the heaviest first; a word is read only whole, singular or plural.
 * Anything dense (metal, liquid, soil, fixings by the box, food in tins or jars) is very heavy; a
 * 3D printer with its spools on a shelf is heavy, more than its own footprint's worth of books.
 */
const WORDS: readonly (readonly [LoadClassName, readonly string[]])[] = [
  [
    "very heavy",
    [
      "paint",
      "tin",
      "can",
      "tile",
      "brick",
      "block",
      "cement",
      "concrete",
      "sand",
      "stone",
      "slab",
      "water",
      "bottle",
      "drink",
      "jar",
      "food",
      "liquid",
      "oil",
      "battery",
      "batteries",
      "engine",
      "metal",
      "steel",
      "iron",
      "weight",
      "dumbbell",
      "compost",
      "soil",
      "plant",
      "pot",
      "screw",
      "bolt",
      "nail",
      "fixing",
      "hardware",
    ],
  ],
  [
    "heavy",
    [
      "tool",
      "book",
      "file",
      "paper",
      "part",
      "timber",
      "wood",
      "offcut",
      "log",
      "record",
      "vinyl",
      "printer",
      "filament",
      "spool",
      "electronics",
    ],
  ],
  [
    "medium",
    [
      "kit",
      "shoe",
      "boot",
      "game",
      "camping",
      "tent",
      "sport",
      "helmet",
      "clothes",
      "clothing",
      "linen",
      "towel",
      "bedding",
      "duvet",
      "pillow",
      "cushion",
      "toy",
      "ornament",
      "decoration",
      "roll",
      "empty",
    ],
  ],
];

/** A load said in plain words, read as its class: the words, the one that decided it, and its row. */
export type LoadClass = {
  readonly class: LoadClassName;
  readonly kgPerM2: number;
  readonly reference: string;
  /** The owner's words; null when the recipe says none. */
  readonly said: string | null;
  /** The word that decided the class; null when none was known, so the heaviest is assumed. */
  readonly matched: string | null;
};

const said = (word: string) => new RegExp(`\\b${word}(?:s|es)?\\b`, "i");

/**
 * The load said in plain words as its class: the heaviest class any of its words says, else the
 * heaviest there is. "4 storage boxes of tools" is heavy, "camping kit" medium.
 */
export const loadClassOf = (words: string | undefined): LoadClass => {
  const text = words ?? "";
  for (const [name, known] of WORDS) {
    const matched = known.find((word) => said(word).test(text));
    if (matched !== undefined) {
      return { class: name, ...LOAD_CLASSES[name], said: words ?? null, matched };
    }
  }
  return { class: "very heavy", ...LOAD_CLASSES["very heavy"], said: words ?? null, matched: null };
};

/** A sheet's stiffness in bending, N/mm², and where that's from. */
type Stiffness = { readonly modulus: number; readonly reference: string };

/**
 * Each sheet material's stiffness from each thickness up, mm, conservatively: a piece may be cut
 * along the sheet or across it, and a shelf may span either way of the piece, so a layered sheet's
 * is its weaker way, across the face grain; a thickness between two takes the thinner's, and one
 * on an MDF band's edge the thicker band's (the less stiff). Below 9 mm, plywood's is its 9 mm's,
 * the thinnest the declaration gives.
 */
const STIFFNESS: readonly (readonly [RegExp, string, readonly (readonly [number, number])[]])[] = [
  [
    /ply/i,
    "Spruce plywood, sanded, across the face grain (Metsä Wood's declaration of performance MW/PW/421-001)",
    [
      [0, 422],
      [12, 1363],
      [15, 2763],
      [18, 3385],
      [21, 3723],
      [24, 3795],
      [27, 4248],
      [30, 4442],
    ],
  ],
  [/osb/i, "OSB/3, its minor axis (Egger's OSB 3 data sheet, EN 300)", [[0, 1400]]],
  [
    /mdf/i,
    "MDF, its thickness's least (EN 622-5, as Swiss Krono's table gives it)",
    [
      [0, 2700],
      [9, 2500],
      [12, 2200],
      [19, 2100],
      [30, 1900],
    ],
  ],
];

/** A material's stiffness at a thickness: its band's, the thinnest band's below every band. */
const atThickness = (bands: readonly (readonly [number, number])[], thickness: number) =>
  bands.reduce(
    (found, [from, modulus]) => (thickness >= from ? modulus : found),
    bands[0]?.[1] ?? 0,
  );

/**
 * A sheet's stiffness at a thickness: by its option, else its name, else the least of those known
 * at that thickness.
 */
export const stiffnessOf = (
  sheet: Pick<Sheet, "name" | "option">,
  thickness: number,
): Stiffness => {
  const named = `${sheet.option ?? ""} ${sheet.name}`;
  const rows = STIFFNESS.map(([word, reference, bands]) => ({
    word,
    modulus: atThickness(bands, thickness),
    reference,
  }));
  const known = rows.find((row) => row.word.test(named));
  if (known) return { modulus: known.modulus, reference: known.reference };
  const least = rows.reduce((weakest, row) => (row.modulus < weakest.modulus ? row : weakest));
  return {
    modulus: least.modulus,
    reference: `The least known at ${thickness} mm: ${least.reference}`,
  };
};
