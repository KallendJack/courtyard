import { expect, type Page } from "@playwright/test";

/** A workspace of its own, so a test can run again on the same worker; opens it. */
export const newWorkspace = async (page: Page, name: string) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("link", { name: "New workspace" })
    .click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
};

/**
 * Starts a session whose message scripts the fake provider's saves, and waits for its answer. A
 * save waits its turn behind every other change to the context folder, and with the browser tests
 * running side by side on Windows that queue can take around five seconds, so this waits longer
 * than the usual five.
 */
export const startSaving = async (page: Page, message: string) => {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:", {
    timeout: 15_000,
  });
};
