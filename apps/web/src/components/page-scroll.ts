import { createContext, useContext } from "react";

/**
 * What scrolls a page behind the login (#266, #339): its middle, between its pinned header and
 * footer (`Page`), never the window or the panel it sits on, so the sidebar, or the Handheld
 * frame's rails, bar and message box, stay where they are, and so do the page's title and main
 * action. Anything that follows the scroll (a session's turns, Jump to latest) listens to it and
 * moves it, through `usePageScroll`.
 */
export const PageScrollContext = createContext<HTMLElement | null>(null);

/** The middle that scrolls the page, or nothing until it's on screen. */
export const usePageScroll = () => useContext(PageScrollContext);

/**
 * The scrolling middle's name to the router, which keeps its scroll by it: back to where a page
 * was, or to the top of a new one (main.tsx).
 */
export const PAGE_SCROLL = "page";
export const PAGE_SCROLL_SELECTOR = `[data-scroll-restoration-id="${PAGE_SCROLL}"]`;
