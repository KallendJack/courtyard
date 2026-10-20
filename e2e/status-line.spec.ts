import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// The status line under a workspace's name (#256) is a code workspace's only, built from its data
// (worker test status-line.test.ts). A planning workspace has none (#600): no model moves one along
// as its turns end, and nothing shows under its name.

test("a planning workspace shows no status line, even after a session's turn", async ({ page }) => {
  const name = `Kit ${Date.now()}`;
  await newWorkspace(page, name);
  // Words the fake once moved a line along with.
  await startSaving(page, "Pump's here. just done: Shock pump; now: Lights; next: Shoes");
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  // Loaded afresh, as a line moved along once the turn ended would have been.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("list", { name: "Status" })).toHaveCount(0);
});
