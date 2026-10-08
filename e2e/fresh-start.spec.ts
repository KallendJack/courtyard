import { expect, test } from "@playwright/test";
import { OWNER_PASSWORD } from "./owner.ts";

// Runs against a worker and folders of its own (playwright.config.ts): a fresh start clears every
// workspace, which would take the other tests' fixtures with it.

test("a fresh start from the home page clears every workspace, once the words are typed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByLabel("Password again").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Create my login" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Garage gym" })).toBeVisible();

  await page.getByRole("link", { name: "Fresh start…" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Fresh start" })).toBeVisible();
  // The fixtures' long session.
  await expect(page.getByText("Every session (1)")).toBeVisible();
  const startFresh = page.getByRole("button", { name: "Start fresh" });
  const words = page.getByLabel("Type “start fresh” to confirm");
  await expect(startFresh).toBeDisabled();
  await words.fill("start");
  await expect(startFresh).toBeDisabled();
  await words.fill("start fresh");
  await startFresh.click();

  await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
  await expect(main.getByText("No workspaces yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Garage gym" })).toHaveCount(0);
});
