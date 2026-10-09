/** Elements that could run script, load something or go somewhere, removed with what's in them. */
const NEVER = new Set([
  "script",
  "foreignObject",
  "image",
  "feImage",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
]);

/** CSS that names something outside the drawing: a `url()` that isn't `#` in it, or an import. */
const OUTSIDE = /url\(\s*(?!["']?#)|@import|image-set|\\/i;

/** Takes away anything in a drawing that could run script, load something or go somewhere. */
const clean = (element: Element) => {
  for (const child of [...element.children]) {
    if (
      NEVER.has(child.localName) ||
      (child.localName === "style" && OUTSIDE.test(child.textContent))
    )
      child.remove();
    else if (child.localName === "a") {
      // A link keeps its words and loses the link.
      clean(child);
      child.replaceWith(...child.childNodes);
    } else clean(child);
  }
  for (const { name, value } of [...element.attributes]) {
    const named = name.toLowerCase();
    if (
      named.startsWith("on") ||
      (named.endsWith("href") && !value.startsWith("#")) ||
      OUTSIDE.test(value) ||
      /javascript:/i.test(value)
    )
      element.removeAttribute(name);
  }
};

/**
 * Mermaid's drawing as an element to put in the page (ADR 0021). Mermaid's strict setting has
 * already made it safe, but not to load nothing, so this takes away whatever could still run
 * script, load something or go somewhere: links (keeping their words), pictures, foreign content,
 * event handlers, addresses and CSS that names anything outside the drawing. It's drawn at its own
 * size, so a wide diagram scrolls sideways rather than shrinking to fit. `undefined` when the
 * markup holds no drawing to show: one that isn't well-formed SVG, say.
 */
export const cleanDiagram = (markup: string, id: string): SVGSVGElement | undefined => {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.getElementById(id);
  if (!(svg instanceof SVGSVGElement)) return undefined;
  clean(svg);
  const { width, height } = svg.viewBox.baseVal;
  svg.removeAttribute("style");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return document.importNode(svg, true);
};
