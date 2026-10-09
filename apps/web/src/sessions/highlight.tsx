import type { LanguageFn } from "highlight.js";
import { createLowlight } from "lowlight";
import type { ReactNode } from "react";

/**
 * Colouring code in answers, loaded with the first code block in a known language and never on
 * the first load. Each language's grammar is loaded when a block first needs it.
 */
const lowlight = createLowlight();
const loading = new Map<string, Promise<void>>();

/** Loads and registers a language's grammar, once. */
export const loadLanguage = (id: string, grammar: () => Promise<{ default: LanguageFn }>) => {
  const known = loading.get(id);
  if (known) return known;
  const loaded = grammar().then((module) => lowlight.register(id, module.default));
  loading.set(id, loaded);
  return loaded;
};

/** Whether a language's grammar has loaded. */
export const knows = (id: string) => lowlight.registered(id);

/** The theme colour for each kind of piece the highlighter finds; the rest stay the body colour. */
const COLOURS: Record<string, string> = {
  keyword: "text-code-keyword",
  "selector-tag": "text-code-keyword",
  section: "text-code-keyword",
  name: "text-code-keyword",
  title: "text-code-name",
  built_in: "text-code-name",
  type: "text-code-name",
  attr: "text-code-name",
  "selector-class": "text-code-name",
  "selector-id": "text-code-name",
  number: "text-code-number",
  literal: "text-code-number",
  string: "text-code-string",
  regexp: "text-code-string",
  comment: "italic text-code-comment",
  quote: "italic text-code-comment",
};

type Root = ReturnType<typeof lowlight.highlight>;
type Piece = Root["children"][number];

const colourOf = (piece: Extract<Piece, { type: "element" }>) => {
  const names = piece.properties.className;
  const kind = Array.isArray(names) ? String(names[0] ?? "").replace(/^hljs-/, "") : "";
  return COLOURS[kind];
};

/** The highlighter's pieces as React elements, never as HTML. */
const render = (pieces: readonly Piece[]): ReactNode[] =>
  pieces.map((piece, index) => {
    if (piece.type === "text") return piece.value;
    if (piece.type !== "element") return null;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one piece of code, in order
      <span key={index} className={colourOf(piece)}>
        {render(piece.children)}
      </span>
    );
  });

/** Code coloured in a language whose grammar `loadLanguage` has loaded. */
export const colourCode = (id: string, code: string): ReactNode =>
  render(lowlight.highlight(id, code).children);
