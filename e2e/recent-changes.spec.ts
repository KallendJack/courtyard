import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { openWhatCourtyardKnows } from "./workspace-page.ts";

test("a save shows in Recent changes, and Undo there marks its chat note undone", async ({
  page,
}) => {
  const name = `Allotment ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save fact: The plot faces south.");
  const session = page.url();

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openWhatCourtyardKnows(page);
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

// Owner rule (2026-10-12): nothing jumps in. The list keeps its place with faint rows the first
// time, and coming back shows the list last known at once, asked for again quietly.
test("Recent changes keeps its place until its list comes, and shows it at once on the way back", async ({
  page,
}) => {
  const name = `Orchard ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save fact: Three apple trees.");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openWhatCourtyardKnows(page);

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/workspaces/*/changes*", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("link", { name: "Recent changes" }).click();
  const title = page.getByRole("heading", { level: 1, name: "Recent changes" });
  await expect(page.locator("main [data-placeholder]").first()).toBeVisible();
  const before = await title.boundingBox();

  release();
  const changes = page.getByRole("list", { name: "Recent changes" });
  await expect(changes).toContainText("Three apple trees.");
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  expect(await title.boundingBox()).toEqual(before);

  // The worker answers slowly from now on: the way back mustn't wait for it.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/workspaces/*/changes*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.continue();
  });
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openWhatCourtyardKnows(page);
  await page.getByRole("link", { name: "Recent changes" }).click();
  await expect(changes).toContainText("Three apple trees.", { timeout: 2000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
