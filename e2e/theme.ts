import type { Page } from "@playwright/test";

/**
 * A Moorland colour by its name in styles.css (`primary`, `workspace-slate`), as the browser
 * computes it now, in light or dark: what a test compares a drawn colour against, rather than a
 * value of its own.
 */
export const themeColour = (page: Page, name: string) =>
  page.evaluate((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--${token})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
