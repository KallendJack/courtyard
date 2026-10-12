import type { Page } from "@playwright/test";

/** Opens one of a planning workspace's tabs on its page (#300), by its name. */
export const openTab = (page: Page, name: "Home" | "Sessions" | "Things" | "Docs") =>
  page
    .getByRole("navigation", { name: "Workspace tabs" })
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();

/** Opens What Courtyard knows from a planning workspace's Home (#300). */
export const openWhatCourtyardKnows = (page: Page) =>
  page.getByRole("link", { name: "What Courtyard knows" }).click();
