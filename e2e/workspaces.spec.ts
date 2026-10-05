import { expect, test } from "@playwright/test";

test("the owner sees every workspace and switches between them in one tap", async ({ page }) => {
  await page.goto("/");

  const list = page.getByRole("main");
  await expect(list.getByRole("link", { name: "Garage gym" })).toBeVisible();
  await expect(list.getByRole("link", { name: /office/ })).toContainText("No context file yet");

  const switcher = page.getByRole("navigation", { name: "Workspaces" });
  await switcher.getByRole("link", { name: "Garage gym" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText(
    "The garage is single, with an up-and-over door.",
  );
  await expect(page.getByRole("region", { name: "Plans" })).toContainText(
    "A squat rack on the left wall.",
  );

  await switcher.getByRole("link", { name: "office" }).click();
  await expect(page.getByText("No context file yet.")).toBeVisible();
});

test("a workspace's address loads it directly", async ({ page }) => {
  const response = await page.goto("/workspaces/garage-gym");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
});
