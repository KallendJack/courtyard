import { expect, test } from "@playwright/test";

test("the home page says when the context backup is behind, and why", async ({ page }) => {
  await page.goto("/");
  const backup = page.getByRole("region", { name: "Backup" });

  // The page asks once the worker has tried its first push, which on a fresh worker can take
  // around five seconds on Windows, so this waits longer than the usual five.
  await expect(backup).toContainText("Context backup behind since Today", { timeout: 15_000 });
  await expect(backup).toContainText("missing-backup.git");
  await expect(backup).toContainText("tries again every ten minutes");
});
