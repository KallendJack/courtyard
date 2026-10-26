import type { Sheet } from "./stock.ts";

// What a Build carries and what its sheets take (#771): the load said in plain words read as a
// load class, each from a source and set conservatively (the heaviest class any word says, and the
// heaviest when no word is known); and how stiff each sheet is, so a shelf's sag is worked out.

export type LoadClassName = "light" | "medium" | "heavy" | "very heavy";

/** A load class: how much a square metre of shelf carries, and where that's from. */
type LoadClassRow = { readonly kgPerM2: number; readonly reference: string };

export const LOAD_CLASSES: Readonly<Record<LoadClassName, LoadClassRow>> = {
  light: {
    kgPerM2: 50,
    reference: "Half the lightest full bookshelf below (woodbin.com, the Sagulator's note 4)",
  },
  medium: {
    kgPerM2: 100,
    reference:
      "A full bookshelf's least, 9 kg a running foot on a 300 mm shelf (woodbin.com, the Sagulator's note 4)",
  },
  heavy: {
    kgPerM2: 200,
    reference:
      "A full bookshelf's most, 18 kg a running foot on a 300 mm shelf (woodbin.com, the Sagulator's note 4)",
  },
  "very heavy": {
    kgPerM2: 300,
    reference:
      "Canned goods, 60 lb a running foot on a 12 inch shelf (JLC, Practical engineering: down with sagging shelves)",
  },
};

/** The words that say each class, the heaviest first; a word is read only whole, singular or plural. */
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
      "screw",
      "bolt",
      "nail",
      "fixing",
      "hardware",
      "food",
      "timber",
      "wood",
      "offcut",
      "log",
      "plant",
      "pot",
      "record",
      "vinyl",
    ],
  ],
  [
    "medium",
    [
      "printer",
      "filament",
      "spool",
      "electronics",
      "kit",
      "shoe",
      "boot",
      "game",
      "camping",
      "tent",
      "sport",
      "helmet",
    ],
  ],
  [
    "light",
    [
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
 * heaviest there is. "4 storage boxes of tools" is heavy, "a 3D printer" medium.
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
 * Each sheet material's stiffness, conservatively: a piece may be cut along the sheet or across
 * it, so a layered sheet's is the mean of its two ways.
 */
const STIFFNESS: readonly (readonly [RegExp, Stiffness])[] = [
  [
    /ply/i,
    {
      modulus: 6000,
      reference:
        "Spruce plywood 18 mm: 8615 along the face grain, 3385 across, their mean (Metsä Wood's declaration of performance)",
    },
  ],
  [
    /osb/i,
    {
      modulus: 2450,
      reference: "OSB/3: 3500 along, 1400 across, their mean (Egger's OSB 3 data sheet)",
    },
  ],
  [
    /mdf/i,
    { modulus: 2200, reference: "MDF 12–19 mm (EN 622-5, as Swiss Krono's table gives it)" },
  ],
];

/** A sheet's stiffness: by its option, else its name, else the least of those known (MDF's). */
export const stiffnessOf = (sheet: Pick<Sheet, "name" | "option">): Stiffness => {
  const named = `${sheet.option ?? ""} ${sheet.name}`;
  const known = STIFFNESS.find(([word]) => word.test(named));
  if (known) return known[1];
  const least = STIFFNESS.reduce((weakest, row) =>
    row[1].modulus < weakest[1].modulus ? row : weakest,
  );
  return least[1];
};
