import type { ReactNode } from "react";
import "./stylesheet.ts";

/**
 * Where the rich blocks' own classes apply (rich-blocks.css): around a block Courtyard draws, a
 * table or a drawing, never around a fallback or the rest of an answer. That stylesheet comes after
 * the theme's, so outside here one of its classes would outrank the theme's screen-size variants
 * on every page.
 */
export function RichBlock(props: {
  /**
   * It fills the block it's in, a column whose height the layout sets (a Home block, #662), so
   * what's in it can take that height. Its own classes are the first load's: those of
   * rich-blocks.css apply only inside it.
   */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-rich-block="" className={props.fill ? "flex min-h-0 grow flex-col" : undefined}>
      {props.children}
    </div>
  );
}
