import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { type CheckedRecipe, makePart, readFont, to3mf, toStl } from "@courtyard/fabrication";

// One printed part made, in a thread of its own (`print.ts`), so a part that takes too long can
// be stopped: manifold works without a break, so nothing in the worker's own thread could.

const { recipe, name, fontPath } = workerData as {
  recipe: CheckedRecipe;
  name: string;
  fontPath: string;
};

const lettered = recipe.features.some((feature) => feature.kind === "text");
const font = lettered
  ? readFont(new Uint8Array(await readFile(fontPath)).buffer as ArrayBuffer)
  : undefined;
const made = await makePart(recipe, font === undefined ? {} : { font });
if (!made.ok) {
  parentPort?.postMessage({ ok: false, problems: made.error });
} else {
  const threeMf = to3mf(made.value, name);
  const stl = toStl(made.value, name);
  // Handed over, not copied: they're made here and only read there.
  parentPort?.postMessage({ ok: true, made: made.value, threeMf, stl }, [
    threeMf.buffer as ArrayBuffer,
    stl.buffer as ArrayBuffer,
  ]);
}
