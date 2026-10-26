import type { Build, PrintSize } from "./build.ts";
import type { LoadClass } from "./loads.ts";
import type { Tool } from "./tools.ts";

// What a Build's making rules and checks found, each kind with what its card and the model say.

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
    }
  | CheckFinding;

/** What the checks any recipe gets found (#771), each with its plain fixes. */
type CheckFinding =
  /**
   * A sheet that sags under its load (#771): the part, its clear span and thickness, the sag
   * worked out and what's allowed (a 600th of the span), the longest span its sheet takes under
   * that load, the load class, and each plain fix that passes.
   */
  | {
      readonly kind: "sags";
      readonly label: string;
      readonly name: string;
      readonly span: number;
      readonly thickness: number;
      readonly sag: number;
      readonly allowed: number;
      readonly most: number;
      readonly load: LoadClass;
      readonly fixes: readonly string[];
    }
  /**
   * Too tall for its feet (#771): its height against how far apart its feet are the narrow way,
   * the fixes, and the wall as advice only until Builds go on walls (#767).
   */
  | {
      readonly kind: "tips";
      readonly height: number;
      readonly feet: number;
      readonly way: "front to back" | "end to end";
      readonly fixes: readonly string[];
      readonly advice: string;
    }
  /** A frame of legs and rails with no brace or panel, so it can lean over (#771). */
  | {
      readonly kind: "racks";
      readonly frame: string;
      readonly fixes: readonly string[];
    }
  /**
   * Screws too short to grip what they go into, or long enough to come out the far side (#771):
   * the screws, the joint, what they pass through and go into, and the length to use.
   */
  | {
      readonly kind: "screw-length";
      readonly screws: string;
      readonly joint: string;
      readonly problem: "too short" | "too long";
      readonly through: number;
      /** How far the screw's point goes into what it grips, the least that grips, and the room. */
      readonly into: number;
      readonly least: number;
      readonly room: number;
      readonly fixes: readonly string[];
    };
