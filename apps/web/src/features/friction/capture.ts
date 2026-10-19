import { domToBlob } from "modern-screenshot";
import { LEFT_OUT } from "./filled-in.ts";

// Loaded only once Something's off is tapped (#554), so the first load stays as light as it is.

/** Long enough for the page's fonts and pictures; a capture that takes longer files without one. */
const CAPTURE_TIMEOUT_MS = 8000;

/**
 * The screen as the owner sees it, at the moment of the tap (#554): the whole window at one CSS
 * pixel to a pixel, scrolled lists where they were, as a JPEG; or `undefined` when the browser
 * couldn't draw it. Drawn by the browser itself (an SVG of the page), so the theme's colours come
 * out as they are on screen.
 */
export const takeScreen = async (): Promise<Blob | undefined> => {
  try {
    return await domToBlob(document.body, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      type: "image/jpeg",
      quality: 0.85,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      timeout: CAPTURE_TIMEOUT_MS,
      filter: (node) => !(node instanceof Element && node.hasAttribute(LEFT_OUT)),
      features: { restoreScrollPosition: true },
    });
  } catch {
    return undefined;
  }
};
