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
  readonly kind: "timber" | "sheet" | "fitted" | "fixing";
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

/**
 * A length of timber as it's marked: its cuts end to end from its square end, a saw cut between
 * each two, and the offcut left over.
 */
export type MarkedLength = {
  readonly stock: string;
  readonly stockLength: number;
  /** How many lengths are marked the same way. */
  readonly count: number;
  readonly kerf: number;
  readonly cuts: readonly Cut[];
  readonly offcut: number;
};

/**
 * One action of a step, said for a beginner ("show me how") and for someone who knows how, and
 * the length it marks when it marks one (#754).
 */
export type Action = {
  readonly howTo: string;
  readonly numbers: string;
  readonly length?: MarkedLength;
};

/** A point in a step's scene, in mm, as a box's corner is: `x` along, `y` back, `z` up. */
export type At = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Something drawn in a step's scene: a part (with its letter), something fitted, a tool, or the
 * offcut on the waste side. This step's own are lit, those put on before are faint (built), and
 * the rest plain.
 */
export type ScenePiece = {
  readonly kind: "part" | "fitted" | "tool" | "offcut";
  readonly name: string;
  readonly label: string | null;
  readonly tone: "lit" | "built" | "plain";
  readonly boxes: readonly Box[];
};

/**
 * What's drawn over a scene, each from the Build's numbers: a size as a dimension line, a pencil
 * line on a piece, an arrow (where the saw runs, where a screw goes in), a corner-to-corner check,
 * and a note at a place (where the support goes, the waste side).
 */
export type SceneMark =
  | { readonly kind: "size"; readonly from: At; readonly to: At; readonly mm: number }
  | { readonly kind: "line"; readonly from: At; readonly to: At; readonly says: string }
  | { readonly kind: "arrow"; readonly from: At; readonly to: At; readonly says: string }
  | { readonly kind: "check"; readonly from: At; readonly to: At; readonly mm: number }
  | {
      readonly kind: "note";
      readonly at: At;
      readonly says: string;
      readonly tone: "plain" | "waste" | "check";
    };

/**
 * A step's picture (#754): the job as it's done (the length in the Workmate, an end frame flat on
 * the floor, the frame so far), in its own mm, with where it opens from.
 */
export type Scene = {
  /** What it shows, as the picture's heading: "In the Workmate". */
  readonly title: string;
  /**
   * Where it opens from, in degrees: turned from the front (towards the right end is +) and up
   * from level, between 15 and 60.
   */
  readonly view: { readonly turn: number; readonly tilt: number };
  readonly pieces: readonly ScenePiece[];
  readonly marks: readonly SceneMark[];
};

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
  readonly scene: Scene;
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
  readonly template: "framed-bench";
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
};
