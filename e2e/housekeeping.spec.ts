import { expect, test } from "@playwright/test";

test("the owner renames a workspace, then archives it after a confirm step", async ({ page }) => {
  // Names of its own, so the test can run again on the same worker.
  const name = `Shed ${Date.now()}`;
  const renamed = `Workshop ${Date.now()}`;
  await page.goto("/new-workspace");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const address = page.url();
  const switcher = page.getByRole("navigation", { name: "Workspaces" });

  await page.getByRole("button", { name: "Rename workspace" }).click();
  await page.getByLabel("Workspace name").fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  await expect(switcher.getByRole("link", { name: renamed })).toBeVisible();
  // The folder stays as it was, so its address does too.
  expect(page.url()).toBe(address);

  // A name another workspace has gets the same message as adding one.
  await page.getByRole("button", { name: "Rename workspace" }).click();
  await page.getByLabel("Workspace name").fill("garage GYM");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("already a workspace called Garage gym");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Archive workspace" }).click();
  const confirm = page.getByRole("region", { name: `Archive ${renamed}?` });
  await expect(confirm).toContainText("archived");
  await confirm.getByRole("button", { name: "Archive workspace" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(switcher.getByRole("link", { name: renamed })).toHaveCount(0);
});

test("the owner renames a session from its page and the sidebar, then deletes it", async ({
  page,
}) => {
  const first = `Where should the bench go? ${Date.now()}`;
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(first);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(`You said: ${first}`);
  const recent = page.getByRole("region", { name: "Recent in Garage gym" });

  await page.getByRole("button", { name: "Rename session" }).click();
  await page.getByLabel("Session title").fill("Bench position");
  // Exactly, as Save as document sits under the answer.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bench position" })).toBeVisible();
  await expect(recent.getByRole("link", { name: "Bench position" })).toBeVisible();

  await recent.getByRole("button", { name: "Rename Bench position" }).click();
  await recent.getByLabel("Session title").fill("Bench and rack");
  await recent.getByLabel("Session title").press("Enter");
  await expect(recent.getByRole("link", { name: "Bench and rack" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Bench and rack" })).toBeVisible();

  await page.getByRole("button", { name: "Delete session" }).click();
  const confirm = page.getByRole("region", { name: "Delete “Bench and rack”?" });
  await confirm.getByRole("button", { name: "Delete session" }).click();

  await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
  await expect(page.getByRole("region", { name: "Sessions" })).not.toContainText("Bench and rack");
  await expect(recent.getByRole("link", { name: "Bench and rack" })).toHaveCount(0);
});
