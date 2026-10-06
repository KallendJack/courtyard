import { expect, test } from "@playwright/test";

test("the home page says when the context backup is behind, and why", async ({ page }) => {
  await page.goto("/");
  const backup = page.getByRole("region", { name: "Backup" });

  await expect(backup).toContainText("Context backup behind since Today");
  await expect(backup).toContainText("missing-backup.git");
  await expect(backup).toContainText("tries again every ten minutes");
});
