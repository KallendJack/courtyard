import type { Page } from "@playwright/test";

/** Opens one of a planning workspace's tabs on its page (#300), by its name. */
export const openTab = (page: Page, name: "Home" | "Sessions" | "Things" | "Docs") =>
  page
    .getByRole("navigation", { name: "Workspace tabs" })
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();

/**
 * Picks Rename, Change icon or Archive from the ⋯ beside a workspace's name (#333, #503), the
 * workspace named `name`.
 */
export const fromWorkspaceMenu = async (
  page: Page,
  name: string,
  choice: "Rename" | "Change icon" | "Archive" | "Blocked shops",
) => {
  await page.getByRole("button", { name: "Workspace options" }).click();
  await page
    .getByRole("dialog", { name })
    .getByRole("button", { name: new RegExp(`^${choice}`) })
    .click();
};

/** Opens What Courtyard knows from a planning workspace's Home (#300). */
export const openWhatCourtyardKnows = (page: Page) =>
  page.getByRole("link", { name: "What Courtyard knows" }).click();
