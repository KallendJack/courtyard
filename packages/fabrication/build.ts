import type { BuildTemplate, SizeSource, SourcedSize } from "@courtyard/contract";
import type { CheckedRecipe } from "./print/recipe.ts";
import type { Tool } from "./tools.ts";

// What any template derives from its parameters (ADR 0036): everything a Build shows. Code works
// every number out; a model only reads them.

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * A piece's place in the 3D view, in mm: `x` along the length from the left end, `y` back from the
 * front, `z` up from the floor, and its size each way (`w` along x, `d` along y, `h` along z).
 */
export type Box = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
};

/**
 * What a part is made of. A Build can mix them (printed brackets joining timber), so the kind
 * stays open even where a template makes only some.
 */
export type Material =
  | { readonly kind: "timber"; readonly stock: string }
  | { readonly kind: "sheet"; readonly stock: string }
  | { readonly kind: "printed"; readonly stock: string };

/**
 * A part, once for all its pieces: its label (A, B…), what it does in the Build in a line, its
 * cut size and a box for each piece.
 */
export type Part = {
  readonly label: string;
  readonly name: string;
  /** Where it goes and what it holds: "One at each corner, standing on the castor bases." */
  readonly does: string;
  readonly count: number;
  readonly material: Material;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly boxes: readonly Box[];
};

/**
 * Something bought and fitted whole (a castor), drawn in the 3D view but never cut, and the part
 * it's fitted to, which it comes with as the steps build the Build up.
 */
export type Fitted = { readonly name: string; readonly on: string; readonly boxes: readonly Box[] };

export type Cut = { readonly label: string; readonly length: number };

export type CutPlan = {
  readonly kerf: number;
  /** For each timber the parts come from, the lengths to buy and what's cut from each. */
  readonly timber: readonly {
    readonly stock: string;
    readonly stockLength: number;
    readonly lengths: readonly {
      readonly cuts: readonly Cut[];
      readonly used: number;
      readonly offcut: number;
    }[];
  }[];
  /** For each sheet the parts come from, the sheets to buy and where each piece sits on them. */
  readonly sheets: readonly {
    readonly stock: string;
    readonly sheetLength: number;
    readonly sheetWidth: number;
    readonly sheets: readonly {
      readonly pieces: readonly {
        readonly label: string;
        readonly x: number;
        readonly y: number;
        readonly along: number;
        readonly across: number;
        readonly turned: boolean;
      }[];
    }[];
  }[];
};

export type BuyLine = {
  readonly item: string;
  readonly kind: "timber" | "sheet" | "fitted" | "fixing" | "filament";
  /** The timber or sheet it buys, by name, so its row can open that stock's options (#704). */
  readonly stock?: string;
  /** What it's for, in a few words. */
  readonly for: string;
  /** How many pieces the Build uses. */
  readonly needed: number;
  /** How many come in one pack (a set of 4 castors, a box of 100 screws); 1 when sold singly. */
  readonly packOf: number;
  readonly packs: number;
  /** A pack's price in pence, and where from, when known. */
  readonly price?: { readonly pence: number; readonly shop?: string; readonly link?: string };
  /** The packs' total in pence, when the price is known. */
  readonly total?: number;
};

export type BuyList = {
  readonly lines: readonly BuyLine[];
  /** The priced lines' total, in pence. */
  readonly total: number;
  /** How many lines have no price yet, so the total leaves them out. */
  readonly unpriced: number;
};

export type StepTool = { readonly tool: Tool; readonly name: string; readonly toHand: boolean };

/** One action of a step, said for a beginner ("show me how") and for someone who knows how. */
export type Action = { readonly howTo: string; readonly numbers: string };

/**
 * A step's close-up: a flat view of what it makes, in mm from the view's top left corner (`y`
 * down), with its key sizes as dimension lines and where each fixing goes.
 */
export type CloseUp = {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly pieces: readonly {
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }[];
  readonly dimensions: readonly {
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
    readonly mm: number;
  }[];
  readonly fixings: readonly { readonly x: number; readonly y: number }[];
  readonly notes: readonly string[];
};

/**
 * A way a step can be done (a hand saw, or a circular saw): the one in use, and whether its tool is
 * to hand. The steps use the best way whose tools are to hand.
 */
export type Way = { readonly name: string; readonly using: boolean; readonly toHand: boolean };

export type Step = {
  /**
   * What the step does, as a slug ("fit-castors"): the same whatever else the Build has, so
   * progress kept by it stays on its step when one before it comes or goes.
   */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly minutes: number;
  /** Whether it needs a second pair of hands (standing the bench up). */
  readonly helper: boolean;
  readonly parts: readonly string[];
  /** The parts it puts on the Build; none for a step that prepares or checks. */
  readonly adds: readonly string[];
  /** The ways it can be done, when there's more than one; none otherwise. */
  readonly ways: readonly Way[];
  readonly tools: readonly StepTool[];
  readonly safety: readonly StepTool[];
  readonly fixings: readonly { readonly name: string; readonly count: number }[];
  readonly actions: readonly Action[];
  readonly closeUp: CloseUp | null;
  /** How to know it's right before moving on, and the photo to send to have it checked. */
  readonly check: { readonly says: string; readonly photo: string };
  /** Words in it a beginner may not know, each in the Build's glossary. */
  readonly words: readonly string[];
};

export type GlossaryWord = { readonly word: string; readonly means: string };

/** A fixing found too short, as its parameters give it. */
export type TooShort = {
  readonly kind: "fixing-too-short";
  readonly fixing: string;
  readonly length: number;
  readonly needed: number;
  /** What it passes through, each with its thickness, then the two threads past the nut. */
  readonly through: readonly { readonly what: string; readonly mm: number }[];
  /** The shortest usual length that's long enough, which the steps and buy list use instead. */
  readonly use: number;
};

/** What the making rules found (ADR 0036). */
export type Finding =
  | (TooShort & {
      /** The steps that fit it, by number, so each step shows what was found about it. */
      readonly steps: readonly number[];
    })
  | {
      readonly kind: "tools-missing";
      readonly tools: readonly {
        readonly tool: Tool;
        readonly name: string;
        readonly steps: readonly number[];
      }[];
    }
  | { readonly kind: "too-big-for-stock"; readonly label: string; readonly stock: string }
  | {
      /** A stock wrong for what it's used for: MDF in a damp garage, CLS for castor bases. */
      readonly kind: "wrong-stock";
      readonly stock: string;
      /** The parts it's wrong for, by name. */
      readonly parts: readonly string[];
      readonly why: string;
    }
  | {
      readonly kind: "assumed";
      /** The sizes nobody measured or read from a maker: check these before cutting. */
      readonly sizes: readonly string[];
    }
  /** A printed part's recipe can't be made as it is, so it isn't: each reason. */
  | { readonly kind: "cannot-make"; readonly problems: readonly string[] }
  | {
      readonly kind: "too-big-for-plate";
      readonly size: Build["size"];
      readonly plate: PrintSize;
    }
  /** A wall thinner than the nozzle prints well: where, how thick, and the least. */
  | {
      readonly kind: "wall-too-thin";
      readonly where: string;
      readonly mm: number;
      readonly least: number;
    };

/** A printer's plate, or how far it reaches up, mm. */
export type PrintSize = { readonly width: number; readonly depth: number; readonly height: number };

/** A size the Print tab lists: its name, as it says it, and its source when it's an object's. */
export type PrintLine = {
  readonly name: string;
  readonly says: string;
  readonly source: SizeSource | null;
};

/**
 * A printed part's own (#702): the plate it's for and whether it fits, its clearance and nozzle,
 * the sizes to list, and the recipe it's made from, checked, which the worker makes into a solid.
 */
export type BuildPrint = {
  readonly plate: PrintSize;
  readonly fits: boolean;
  readonly clearance: SourcedSize;
  readonly nozzle: SourcedSize;
  readonly sizes: readonly PrintLine[];
  /** `null` when it can't be made (a `cannot-make` finding says why). */
  readonly recipe: CheckedRecipe | null;
};

/** What an option is like, as a chip says it: fine, or something to know. */
export type Said = { readonly text: string; readonly tone: "fine" | "warn" };

/** One stock a Build's timber or sheet could be swapped for, costed for this Build (#704). */
export type StockChoice = {
  /**
   * The option it is; none for what the Build uses when that's no option ("45 × 95 C24"), shown
   * first as picked and never offered again once swapped out.
   */
  readonly option?: string;
  /** As a beginner reads it: "CLS, 38 × 89". */
  readonly title: string;
  /** Its name as the parts, cut plan and buy list give it: "38 × 89 CLS". */
  readonly stock: string;
  /** Why pick it, or not, in a line: its strength for the job and its finish. */
  readonly why: string;
  /** Its faces, when it's an option. */
  readonly finish?: "rough" | "smooth";
  readonly says: readonly Said[];
  /** What this Build would buy of it: "5 lengths of 2.4 m". */
  readonly buys: string;
  /** A length's or a sheet's price, and where from, when known. */
  readonly price?: { readonly pence: number; readonly shop?: string; readonly link?: string };
  /** What this Build's lengths or sheets of it come to, when priced. */
  readonly total?: number;
  readonly picked: boolean;
  readonly recommended: boolean;
};

/** A timber or sheet a Build uses, with the options it could be, the recommended first. */
export type StockOptions = {
  /** The stock it is now, as the buy list and cut plan name it. */
  readonly stock: string;
  readonly name: string;
  /** The parts cut from it: "Top, shelf and braces". */
  readonly for: string;
  readonly choices: readonly StockChoice[];
};

export type Build = {
  readonly template: BuildTemplate;
  /** The finished size, mm. */
  readonly size: { readonly length: number; readonly depth: number; readonly height: number };
  readonly parts: readonly Part[];
  readonly fitted: readonly Fitted[];
  readonly cutPlan: CutPlan;
  readonly buyList: BuyList;
  readonly steps: readonly Step[];
  readonly glossary: readonly GlossaryWord[];
  readonly findings: readonly Finding[];
  /** Each timber and sheet with more than one option, to pick from. */
  readonly options: readonly StockOptions[];
  /** A printed part's own; `null` for a Build cut from timber and sheets. */
  readonly print: BuildPrint | null;
};
