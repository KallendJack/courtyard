import { expect, test } from "@playwright/test";
import { OWNER_PASSWORD } from "./owner.ts";

// A device that has never logged in.
test.use({ storageState: { cookies: [], origins: [] } });

test("a logged-out device is sent to login, gets in with the password, and can log out", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password");

  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();

  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("the setup page is gone once the owner exists", async ({ page }) => {
  await page.goto("/setup");

  await expect(page).toHaveURL(/\/login$/);
});
