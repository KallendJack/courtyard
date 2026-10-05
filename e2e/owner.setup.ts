import { expect, test as setup } from "@playwright/test";
import { OWNER_LOGIN, OWNER_PASSWORD } from "./owner.ts";

setup("a fresh install asks the owner to create their login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByLabel("Password again").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Create my login" }).click();

  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await page.context().storageState({ path: OWNER_LOGIN });
});
