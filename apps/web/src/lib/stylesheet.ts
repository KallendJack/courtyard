/**
 * Adds a lazily loaded folder's own stylesheet to the page (the rich blocks', Things'). Tailwind
 * puts every class it finds into the first load's stylesheet, so a folder whose code only loads
 * with its page is left out of `styles.css` and gets a stylesheet of its own, which comes inside
 * the folder's script rather than as a file the first load would have to name. It goes after the
 * theme's stylesheet, so where both have a class, this one's screen-size variants still win.
 */
export const addStylesheet = (name: string, css: string) => {
  const style = document.createElement("style");
  style.dataset.courtyard = name;
  style.textContent = css;
  document.head.append(style);
};
