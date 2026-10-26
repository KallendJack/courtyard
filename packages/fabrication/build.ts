import type { BuildTemplate } from "@courtyard/contract";
import type { ToolSize } from "./capacity.ts";
import type { CloseUp, FixingType } from "./close-up.ts";
import type { BagItem, Uses } from "./parts-page.ts";
import type { BuildPrint, PrintSize } from "./print/build-print.ts";
import type { Scene } from "./scene.ts";
import type { Tool } from "./tools.ts";

export type { CloseUp, CloseUpShape, CloseUpType, FixingType } from "./close-up.ts";
export type { BagItem, Uses } from "./parts-page.ts";
export type { BuildPrint, PrintLine, PrintSize } from "./print/build-print.ts";

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

/** A bolt's length worked out (#763): what it passes through, then two threads, and their sum. */
export type BoltLength = {
  readonly needed: number;
  readonly through: readonly { readonly what: string; readonly mm: number }[];
  /** The owner's own bolts of its thread that are too short, and by how much, when they have some. */
  readonly yoursShort?: { readonly name: string; readonly by: number };
};

export type BuyLine = {
  readonly item: string;
  /** A tool is one the owner chose to buy, from the Tools tab (#763). */
  readonly kind: "timber" | "sheet" | "fitted" | "fixing" | "filament" | "tool";
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
  /** A bolt's, how its length was worked out. */
  readonly length?: BoltLength;
};

export type BuyList = {
  readonly lines: readonly BuyLine[];
  /** The priced lines' total, in pence. */
  readonly total: number;
  /** How many lines have no price yet, so the total leaves them out. */
  readonly unpriced: number;
};

/** A drill bit a step needs: its size, what it drills, and whether the owner's set has it. */
export type Bit = {
  readonly mm: number;
  /** "pilot holes", "the M6 bolts". */
  readonly for: string;
  /** Left out while the set's sizes aren't known: "a 7 mm bit: check your set". */
  readonly have?: boolean;
};

export type StepTool = {
  readonly tool: Tool;
  readonly name: string;
  readonly toHand: boolean;
  /** Something the owner has besides Your tools that will do, by its name: "Step stool" (#763). */
  readonly standIn?: string;
  /** Drill bits' sizes, each the step drills with. */
  readonly bits?: readonly Bit[];
};

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

/**
 * A way a step can be done (a hand saw, a circular saw or a mitre saw): its tool, the one in use,
 * and whether its tool is to hand. The steps use the best way whose tools are to hand, unless the
 * step was done another way.
 */
export type Way = {
  readonly tool: Tool;
  readonly name: string;
  readonly using: boolean;
  readonly toHand: boolean;
};

/**
 * A step started, and the tool it was done with (#777), or the lines it was started on (#783): it
 * stays as it was started.
 */
export type KeptWay = { readonly step: string; readonly tool: string };

/**
 * What a Build is worked out with besides its parameters (#777): the owner's tools as Your tools
 * saves them (each by its tile's name, or the owner's own), which the steps follow in place of the
 * parameters' own when given, their sizes (a mitre saw's cutting capacity, #780), and the ways the
 * steps already started were done.
 */
export type BuildSetting = {
  /** Left out, or undefined, when the owner has saved none: the steps follow the Build's own. */
  readonly tools?: readonly string[] | undefined;
  /** The sizes the owner gave their tools, each by one of its names: a bit set's "3, 7 mm". */
  readonly sizes?: readonly ToolSize[];
  readonly kept?: readonly KeptWay[];
  /** The steps with a line ticked, by ID: a step started keeps the lines it had (#783). */
  readonly started?: readonly string[];
  /** What else the owner has, by name (#763): a step stool for the long end, bolts too short. */
  readonly have?: readonly string[];
  /** The tools the owner chose to buy for this Build, which its buy list lists until they have them. */
  readonly buying?: readonly Tool[];
};

/**
 * One move of a step a beginner may never have made, in order, with its close-up where one shows
 * it: "Tape", then "Tick", "Square" and "Line" for marking (#777).
 */
export type WalkStep = {
  readonly title: string;
  readonly says: string;
  readonly closeUp: CloseUp | null;
};

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
  /** What it takes, to lay out first: the pieces it puts on and its fixings (#778). */
  readonly uses: Uses;
  /** The ways it can be done, when there's more than one; none otherwise. */
  readonly ways: readonly Way[];
  /**
   * What its lines are, for a step that keeps them once started (#783): kept beside the ways its
   * steps were done, so a step started on other lines keeps those.
   */
  readonly lines?: string;
  /**
   * The way the Build's own tools would do it, and the way the owner's do now, when they differ
   * and it isn't started yet: "Now uses your mitre saw" (#777).
   */
  readonly wayChanged: { readonly was: string; readonly now: string } | null;
  readonly tools: readonly StepTool[];
  readonly safety: readonly StepTool[];
  /** Its fixings, each with the type of close-up that shows how it's made (#813). */
  readonly fixings: readonly {
    readonly name: string;
    readonly count: number;
    readonly joint?: FixingType;
  }[];
  readonly batch: string; // How to batch it: "One joint at a time" (#789).
  readonly actions: readonly Action[];
  readonly tips: readonly string[]; // Extras, behind a Tips tap, never in the lines (#789).
  /** Its close-ups: most steps have one, a fixing two (tightening it, and taken apart, #783). */
  readonly closeUps: readonly CloseUp[];
  /**
   * The techniques it uses, each as its close-up (#813): open in full the first time the Build's
   * steps use it (`first`), a "how?" tap after.
   */
  readonly techniques: readonly { readonly closeUp: CloseUp; readonly first: boolean }[];
  /** What "show me how" walks through first, the first time it comes up; none otherwise. */
  readonly walkThrough: readonly WalkStep[];
  /** The step's picture (#754); null where another view shows it, as a printed part's plate. */
  readonly scene: Scene | null;
  /** How to know it's right before moving on, and the photo to send to have it checked. */
  readonly check: { readonly says: string; readonly photo: string };
  /** Words in it a beginner may not know, each in the Build's glossary. */
  readonly words: readonly string[];
};

export type GlossaryWord = { readonly word: string; readonly means: string };

/**
 * What the making rules found (ADR 0036). A bolt too short isn't one: the steps and buy list use
 * the length to use, and its line says so only when the owner has the short ones (#763).
 */
export type Finding =
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
  readonly template: BuildTemplate | "recipe"; // A recipe that's no template's (#770).
  /** The finished size, mm. */
  readonly size: { readonly length: number; readonly depth: number; readonly height: number };
  readonly parts: readonly Part[];
  readonly fitted: readonly Fitted[];
  readonly cutPlan: CutPlan;
  readonly buyList: BuyList;
  /** The fixings bag, for the parts page (#778): each fixing by its kind and count. */
  readonly bag: readonly BagItem[];
  readonly steps: readonly Step[];
  readonly glossary: readonly GlossaryWord[];
  readonly findings: readonly Finding[];
  /** Each timber and sheet with more than one option, to pick from. */
  readonly options: readonly StockOptions[];
  /** A printed part's own; `null` for a Build cut from timber and sheets. */
  readonly print: BuildPrint | null;
};
