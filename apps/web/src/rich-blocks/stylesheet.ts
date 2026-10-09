import css from "./rich-blocks.css?inline";

/**
 * The rich blocks' stylesheet, added to the page once, when the answer renderer first loads. It
 * comes inside the renderer's own script rather than as a file of its own, which the first load
 * would have to name so it could fetch it with the page that needs it. It goes after the theme's
 * stylesheet, so where both have a class, this one's screen-size variants still win.
 */
const style = document.createElement("style");
style.dataset.courtyard = "rich-blocks";
style.textContent = css;
document.head.append(style);
