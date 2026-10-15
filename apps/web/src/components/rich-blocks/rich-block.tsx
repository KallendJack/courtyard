import type { ReactNode } from "react";
import "./stylesheet.ts";

/**
 * Where the rich blocks' own classes apply (rich-blocks.css): around a block Courtyard draws, a
 * table or a drawing, never around a fallback or the rest of an answer. That stylesheet comes after
 * the theme's, so outside here one of its classes would outrank the theme's screen-size variants
 * on every page.
 */
export function RichBlock(props: { children: ReactNode }) {
  return <div data-rich-block="">{props.children}</div>;
}
