import type { z } from "zod";
import type { SourcedSize } from "../sourced/size.ts";

// How a Build's recipe (ADR 0039, #769) is refused, in plain words: a size over its most, and a
// kind of stock, piece, group or joint the recipe doesn't have. What's out of version 1 (pocket
// holes, dowels, glue-only joints, hinges, drawers) says so, with the nearest a recipe can make.

/** Each thing out of version 1, by a word in the kind a recipe gave it, and what to use instead. */
const OUT_OF_VERSION_1: readonly { readonly word: RegExp; readonly says: string }[] = [
  {
    word: /pocket/,
    says: "Pocket holes aren't in a recipe yet: screw timber into timber instead.",
  },
  { word: /dowel/, says: "Dowels aren't in a recipe yet: screw timber into timber instead." },
  {
    word: /glue/,
    says: "Glue-only joints aren't in a recipe yet: screw timber into timber, or a sheet into the edges under it, instead.",
  },
  { word: /hinge/, says: "Hinges aren't in a recipe yet: a box open at the front instead." },
  {
    word: /drawer/,
    says: "Drawers aren't in a recipe yet: shelves in a box or frame, holding storage boxes, instead.",
  },
];

/**
 * A stock, piece, group or joint of a kind the recipe doesn't have, refused saying what it does
 * have, or what to make instead when it's out of version 1. Any other problem keeps Zod's words.
 */
export const notAKind =
  (what: string): z.core.$ZodErrorMap =>
  (issue) => {
    const options: unknown = "options" in issue ? issue.options : undefined;
    if (issue.code !== "invalid_union" || !Array.isArray(options)) return undefined;
    const input: unknown = issue.input;
    const kind =
      input !== null && typeof input === "object" && "kind" in input ? String(input.kind) : "";
    const out = OUT_OF_VERSION_1.find(({ word }) => word.test(kind.toLowerCase()));
    if (out) return out.says;
    const kinds = options.map(String);
    const has = `${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}`;
    return kind
      ? `"${kind}" isn't a ${what} a recipe has: it has ${has}.`
      : `A ${what} says its kind: ${has}.`;
  };

/**
 * A size over its most, or nothing where it can't be (a 0 kerf or overhang can), refused with what
 * it is and what it can be.
 */
export const overMost = (
  context: z.RefinementCtx,
  path: (string | number)[],
  size: SourcedSize,
  most: number,
  what: string,
  { zero = false }: { zero?: boolean } = {},
) => {
  if ((!zero && size.value <= 0) || size.value > most) {
    context.addIssue({
      code: "custom",
      path,
      message: `${what} is ${size.value} mm: it must be ${zero ? "" : "more than 0 and "}at most ${most} mm.`,
    });
  }
};
