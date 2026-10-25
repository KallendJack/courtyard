import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { type BuildsLock, takePlace } from "@courtyard/builds";
import type { MadePart } from "@courtyard/contract";
import { type CheckedRecipe, FONT_FILE, type Made } from "@courtyard/fabrication";
import { err, ok, type Result } from "../../lib/result.ts";
import type { ReadBuild } from "./index.ts";

// A printed part's Build made into its solid and files (#702): in a thread of its own, once it
// has its turn in the machine's builds lock (#306), and stopped if it runs past its time limit.
// What's made is kept for the Build as it is, so the page asking again every 30 seconds, or a
// download after it, makes nothing twice.

/** PLA's density, g/mm³: a part's weight solid, which the slicer's infill makes less. */
const PLA = 1.24 / 1000;

/** How many made parts are kept: the Builds the owner has open, and a few more. */
const KEPT_MOST = 12;

/** How many recipes that couldn't be made are remembered, each only its reason. */
const REFUSED_MOST = 100;

const FONT_PATH = join(
  dirname(fileURLToPath(import.meta.resolve("@courtyard/fabrication"))),
  FONT_FILE,
);

/** A part as made, with its files' bytes. */
export type MadePrint = {
  readonly made: Made;
  readonly threeMf: Uint8Array;
  readonly stl: Uint8Array;
};

/** Why a part wasn't made. */
export type PrintRefusal =
  /** It isn't a printed part. */
  | { readonly kind: "not-printed" }
  /** Its recipe can't be made: each reason. */
  | { readonly kind: "cannot-make"; readonly problems: readonly string[] }
  /** It ran past its time limit, and was stopped. */
  | { readonly kind: "too-long" }
  /** The request went away while it waited for its turn. */
  | { readonly kind: "stopped" }
  | { readonly kind: "failed" };

/** How a part is made: its turn in the builds lock, and its thread's time and memory limits. */
type Printing = { lock: BuildsLock; timeLimitMs: number; memoryLimitMb: number };

/**
 * Makes a recipe in a thread of its own, stopping the thread at the time limit, or when its
 * JavaScript heap passes the memory limit (manifold's WebAssembly memory is its own, outside it).
 */
const inThread = (
  recipe: CheckedRecipe,
  name: string,
  limits: Pick<Printing, "timeLimitMs" | "memoryLimitMb">,
) =>
  new Promise<Result<MadePrint, PrintRefusal>>((resolve) => {
    const thread = new Worker(new URL("./make-thread.ts", import.meta.url), {
      workerData: { recipe, name, fontPath: FONT_PATH },
      resourceLimits: { maxOldGenerationSizeMb: limits.memoryLimitMb },
    });
    const limit = setTimeout(() => {
      void thread.terminate();
      resolve(err({ kind: "too-long" }));
    }, limits.timeLimitMs);
    const done = (result: Result<MadePrint, PrintRefusal>) => {
      clearTimeout(limit);
      void thread.terminate();
      resolve(result);
    };
    thread.once("message", (message: unknown) => {
      const sent = message as
        | { ok: true; made: Made; threeMf: Uint8Array; stl: Uint8Array }
        | { ok: false; problems: string[] };
      done(
        sent.ok
          ? ok({ made: sent.made, threeMf: sent.threeMf, stl: sent.stl })
          : err({ kind: "cannot-make", problems: sent.problems }),
      );
    });
    thread.once("error", () => done(err({ kind: "failed" })));
    thread.once("exit", () => done(err({ kind: "failed" })));
  });

/** A printed part's files' names: its Build's file name, as a 3MF and an STL. */
export const filesOf = (slug: string): MadePart["files"] => ({
  threeMf: `${slug}.3mf`,
  stl: `${slug}.stl`,
});

/** A made part as the Fabrication API answers it, its corners to the hundredth of a mm. */
export const madePartOf = (print: MadePrint, files: MadePart["files"]): MadePart => {
  const { made } = print;
  return {
    size: made.size,
    volume: Math.round(made.volume),
    watertight: made.watertight,
    grams: Math.round(made.volume * PLA),
    mesh: {
      positions: Array.from(made.positions, (mm) => Math.round(mm * 100) / 100),
      triangles: Array.from(made.triangles),
    },
    files,
  };
};

/**
 * The printed parts' maker: one part at a time per Build, each in the machine's builds lock, kept
 * while its Build's file is as it was made from. A recipe that couldn't be made is remembered by
 * what it says, so asking again (the page every 30 seconds) is answered at once rather than
 * holding the builds lock for another time limit; only a recipe that changes is tried again.
 */
export const createPrints = (options: Printing) => {
  const kept = new Map<string, { text: string; made: Promise<Result<MadePrint, PrintRefusal>> }>();
  const refused = new Map<string, PrintRefusal>();

  const makeNow = async (
    build: ReadBuild,
    signal: AbortSignal,
  ): Promise<Result<MadePrint, PrintRefusal>> => {
    const print = build.derived.print;
    if (print === null) return err({ kind: "not-printed" });
    if (print.recipe === null) {
      const found = build.derived.findings.find((finding) => finding.kind === "cannot-make");
      return err({ kind: "cannot-make", problems: found?.problems ?? [] });
    }
    const recipe = JSON.stringify(print.recipe);
    const before = refused.get(recipe);
    if (before !== undefined) return err(before);
    const place = await takePlace(options.lock, {
      label: `Courtyard print ${build.summary.slug}`,
      signal,
    });
    if (place === null) return err({ kind: "stopped" });
    try {
      const made = await inThread(print.recipe, build.file.name, options);
      // Making it again would only fail the same way; a stopped request is no answer about it.
      if (!made.ok && made.error.kind !== "stopped") {
        refused.set(recipe, made.error);
        while (refused.size > REFUSED_MOST) {
          const oldest = refused.keys().next().value;
          if (oldest === undefined) break;
          refused.delete(oldest);
        }
      }
      return made;
    } finally {
      place.free();
    }
  };

  return {
    /** A Build's part made, or why not: kept while its file is as it was made from. */
    make: (key: string, build: ReadBuild, signal: AbortSignal) => {
      const there = kept.get(key);
      if (there !== undefined && there.text === build.text) return there.made;
      const made = makeNow(build, signal);
      kept.delete(key);
      kept.set(key, { text: build.text, made });
      // Only what's made is kept here: a refusal is asked again, and answered from its recipe.
      void made.then((result) => {
        if (!result.ok && kept.get(key)?.made === made) kept.delete(key);
      });
      while (kept.size > KEPT_MOST) {
        const oldest = kept.keys().next().value;
        if (oldest === undefined) break;
        kept.delete(oldest);
      }
      return made;
    },
  };
};
