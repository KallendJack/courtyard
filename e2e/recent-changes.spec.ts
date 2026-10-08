import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

test("a save shows in Recent changes, and Undo there marks its chat note undone", async ({
  page,
}) => {
  const name = `Allotment ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save fact: The plot faces south.");
  const session = page.url();

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await page.getByRole("link", { name: "Recent changes" }).click();

  const changes = page.getByRole("list", { name: "Recent changes" });
  await expect(changes).toContainText("Saved to Facts");
  await expect(changes).toContainText("The plot faces south.");
  await expect(
    // The session's title, its first line or the title a model gave it after the answer.
    changes.getByRole("link", { name: /save fact:? the plot faces/i }),
  ).toBeVisible();

  await changes.getByRole("button", { name: "Undo" }).click();
  await expect(changes).toContainText("Undone");
  await expect(changes.getByRole("button", { name: "Undo" })).toHaveCount(0);

  await page.goto(session);
  await expect(page.getByRole("list", { name: "Saved to context" })).toContainText("Undone");
});
