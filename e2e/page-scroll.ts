import type { Page } from "@playwright/test";

/**
 * What scrolls a page behind the login (#266): the nearest box around its `main` that scrolls up
 * and down, found as the browser lays it out, or the document when nothing around it does.
 */
const scrollerOf = (page: Page) =>
  page.evaluateHandle(() => {
    let box = document.querySelector("main")?.parentElement;
    while (box) {
      const { overflowY } = getComputedStyle(box);
      if (overflowY === "auto" || overflowY === "scroll") return box;
      box = box.parentElement;
    }
    return document.scrollingElement ?? document.documentElement;
  });

/** What scrolls the page: its edges on screen, how far it's scrolled, and the window's own scroll. */
export const pageScroll = async (page: Page) => {
  const scroller = await scrollerOf(page);
  return scroller.evaluate((box) => {
    const { right, top, bottom } = box.getBoundingClientRect();
    return {
      document: box === document.scrollingElement,
      right,
      top,
      bottom,
      scrollTop: box.scrollTop,
      scrolls: box.scrollHeight > box.clientHeight,
      windowScrollY: window.scrollY,
    };
  });
};

/** How far the end of the page is below the bottom of what scrolls it, in pixels. */
export const fromTheEnd = async (page: Page) => {
  const scroller = await scrollerOf(page);
  return scroller.evaluate((box) => box.scrollHeight - (box.clientHeight + box.scrollTop));
};

/** Scrolls the page to `top`, as far as it goes, or to its end. */
export const scrollPageTo = async (page: Page, top: number | "end") => {
  const scroller = await scrollerOf(page);
  await scroller.evaluate(
    (box, to) => box.scrollTo({ top: to === "end" ? box.scrollHeight : to }),
    top,
  );
};

/** Scrolls the page to the middle of what it holds. */
export const scrollPageToMiddle = async (page: Page) => {
  const scroller = await scrollerOf(page);
  await scroller.evaluate((box) => box.scrollTo({ top: box.scrollHeight / 2 }));
};

/** Whether the page is wider than the screen, so the page itself would scroll sideways. */
export const pageScrollsSideways = async (page: Page) => {
  const scroller = await scrollerOf(page);
  return scroller.evaluate(
    (box) =>
      box.scrollWidth > box.clientWidth ||
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
};
