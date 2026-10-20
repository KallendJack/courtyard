import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { openTab } from "./workspace-page.ts";

// Add to wanted (#245): a product named in an answer becomes a wanted Thing with one tap. The wanted
// list's picks, price checks and Blocked shops are gone (#600): a wanted Thing is a Thing like any
// other, its status Want.

test("a product named in an answer is added as a wanted Thing with one tap", async ({ page }) => {
  const name = `Back wall ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    'Two kinds fit:\n\n```product\n{"name": "Wall track", "about": "about £140 · moves as the garage changes"}\n```\n\nThat\'s all.',
  );
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);

  const product = page.getByLabel("Wall track", { exact: true });
  await expect(product).toContainText("about £140 · moves as the garage changes");
  await product.getByRole("button", { name: "Add to wanted" }).click();
  await expect(product).toContainText("In Wanted");
  await expect(product.getByRole("button", { name: "Add to wanted" })).toHaveCount(0);

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "Things");
  await expect(page.getByRole("region", { name: "Wanted" })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Things" })
      .getByRole("listitem")
      .filter({ hasText: "Wall track" }),
  ).toContainText("Want");
});

test("a planning workspace's ⋯ has no Blocked shops or Allowed commands (#600)", async ({
  page,
}) => {
  const name = `Menu ${Date.now()}`;
  await newWorkspace(page, name);

  await page.getByRole("button", { name: "Workspace options" }).click();
  const menu = page.getByRole("dialog", { name });
  await expect(menu.getByRole("button", { name: /^Rename/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /^Blocked shops/ })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /^Allowed commands/ })).toHaveCount(0);
});
