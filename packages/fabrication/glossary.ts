import type { GlossaryWord } from "./build.ts";

// Words a beginner may not know, each meant once here; a step names the ones it uses and the
// Build carries only those.

const WORDS = {
  flush: "Level with the next piece's face or edge, with no step between them.",
  "pilot hole":
    "A small hole drilled first, so the screw goes in straight and the wood doesn't split.",
  "waste side":
    "The side of your pencil line that becomes offcut. Saw there, so the piece keeps its length.",
  kerf: "The width of wood the saw blade turns to dust in one cut.",
  offcut: "What's left of a length or a sheet once its pieces are cut.",
  square: "At a right angle. Also the tool you check one with.",
  "clearance hole": "A hole a little wider than the bolt, so the bolt slides through.",
  "lock nut": "A nut with a nylon ring inside, which stops it shaking loose.",
  countersink:
    "A cone-shaped dip cut into the top of a screw hole, so the screw's head sits flush.",
} as const;

export type Word = keyof typeof WORDS;

const isWord = (word: string): word is Word => Object.hasOwn(WORDS, word);

/** The words the steps use, each with its meaning, in the order they first come up. */
export const glossaryOf = (words: readonly string[]): GlossaryWord[] =>
  [...new Set(words)].filter(isWord).map((word) => ({ word, means: WORDS[word] }));
