import { expect, test } from "@playwright/test";

test("the owner starts their owner context, and each workspace says it reads it", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Owner context" });

  await panel.getByRole("button", { name: "Start your owner context" }).click();

  await expect(panel.getByRole("region", { name: "Facts" })).toContainText("Nothing yet.");
  await expect(panel.getByRole("region", { name: "How to answer me" })).toContainText(
    "Nothing yet.",
  );
  await expect(panel.getByRole("button", { name: "Start your owner context" })).toHaveCount(0);

  await page.goto("/workspaces/garage-gym");
  await page.getByRole("link", { name: "your owner context" }).click();
  await expect(page.getByRole("region", { name: "Owner context" })).toBeVisible();
});
