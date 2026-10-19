import type { Page } from "@playwright/test";

/**
 * Opens one of a planning workspace's tabs on its page (#300, #481), by its name; Home is the way
 * back, the tab that's open tapped again.
 */
export const openTab = (page: Page, name: "Home" | "History" | "Things" | "Docs") => {
  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  return name === "Home"
    ? tabs.locator('[aria-current="page"]').click()
    : tabs.getByRole("link", { name: new RegExp(`^${name}`) }).click();
};

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

/** Opens What Courtyard knows from a planning workspace's ⋯ (#481). */
export const openWhatCourtyardKnows = async (page: Page) => {
  await page.getByRole("button", { name: "Workspace options" }).click();
  await page.getByRole("button", { name: /^What Courtyard knows/ }).click();
};
