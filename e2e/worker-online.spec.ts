import { expect, test } from "@playwright/test";

test("the web app shows that the worker is online", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Courtyard" })).toBeVisible();
  await expect(page.getByText("Worker online")).toBeVisible();
});

test("an app route loads the app on a fresh visit", async ({ page }) => {
  const response = await page.goto("/somewhere/deep");

  expect(response?.status()).toBe(200);
  await expect(page.locator("#app")).toBeAttached();
});
