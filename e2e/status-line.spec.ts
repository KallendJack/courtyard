import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// The status line under a workspace's name (#256; Paper, "Tablet · Header with the status line",
// "Tablet · Status line: an item tapped" and "Cover · Header with the status line"): ✓ just done ·
// ● now · ○ next, moved along as a session's turn ends, and ticked, edited or removed by the owner.

const statusLine = (page: Page) => page.getByRole("list", { name: "Status" });

/** A workspace whose session's turn has moved its line along; back on its Home, the line shown. */
const withLine = async (page: Page) => {
  const name = `Kit ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "Pump's here. just done: Shock pump; now: Lights; next: Shoes");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  // Moved along in the background as the turn ended: shown once it has been.
  await expect(async () => {
    await page.reload();
    await expect(statusLine(page)).toHaveText(/Shock pump.*Lights.*Shoes/, { timeout: 1000 });
  }).toPass();
  return name;
};

test("a session's turn moves the line along under the workspace's name", async ({ page }) => {
  await withLine(page);

  const items = statusLine(page).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText(/✓\s*Just done: Shock pump/);
  await expect(items.nth(1).getByRole("button")).toHaveAccessibleName("Now: Lights");
  await expect(items.nth(2).getByRole("button")).toHaveAccessibleName("Next: Shoes");
});

test("Done on now moves the line along at once: now is just done, next is now", async ({ page }) => {
  await withLine(page);

  await statusLine(page).getByRole("button", { name: "Now: Lights" }).click();
  const card = page.getByRole("dialog", { name: "Now: Lights" });
  await expect(card).toContainText("From today's chat · next is Shoes");
  await expect(card).toContainText("Done moves the line along: Lights ✓ · Shoes now");
  await card.getByRole("button", { name: "Done" }).click();

  await expect(card).toBeHidden();
  await expect(statusLine(page).getByRole("button", { name: "Just done: Lights" })).toBeVisible();
  await expect(statusLine(page).getByRole("button", { name: "Now: Shoes" })).toBeVisible();
  await expect(statusLine(page).getByRole("listitem")).toHaveCount(2);
});

test("Edit gives an item the owner's own words, and Remove takes one off", async ({ page }) => {
  await withLine(page);

  await statusLine(page).getByRole("button", { name: "Next: Shoes" }).click();
  const card = page.getByRole("dialog", { name: "Next: Shoes" });
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByRole("textbox", { name: "Next" }).fill("Flat pedals");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(statusLine(page).getByRole("button", { name: "Next: Flat pedals" })).toBeVisible();

  await statusLine(page).getByRole("button", { name: "Next: Flat pedals" }).click();
  const edited = page.getByRole("dialog", { name: "Next: Flat pedals" });
  await expect(edited).toContainText("In your own words");
  await edited.getByRole("button", { name: "Remove" }).click();
  await expect(statusLine(page).getByRole("listitem")).toHaveCount(2);

  // Kept by the worker: still so once the page loads again.
  await page.reload();
  await expect(statusLine(page)).toHaveText(/Shock pump.*Lights/);
  await expect(statusLine(page).getByRole("listitem")).toHaveCount(2);
});
