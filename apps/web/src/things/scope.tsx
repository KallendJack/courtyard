import type { ReactNode } from "react";
import "./stylesheet.ts";

/**
 * Where Things' own classes apply (things.css): around the Things section and a Thing's card. That
 * stylesheet comes after the theme's, so outside here one of its classes would outrank the theme's
 * screen-size variants on every page.
 */
export function ThingsScope(props: { children: ReactNode }) {
  return <div data-things="">{props.children}</div>;
}
