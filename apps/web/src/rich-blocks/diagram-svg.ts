/**
 * Mermaid's drawing, as an element to put in the page, at its own size, so a wide diagram scrolls
 * sideways rather than shrinking to fit.
 */
export const cleanDiagram = (markup: string, id: string): SVGSVGElement => {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.getElementById(id);
  if (!(svg instanceof SVGSVGElement)) throw new Error("Mermaid drew no diagram");
  const { width, height } = svg.viewBox.baseVal;
  svg.removeAttribute("style");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return document.importNode(svg, true);
};
