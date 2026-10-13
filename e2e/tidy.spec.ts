import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { openWhatCourtyardKnows } from "./workspace-page.ts";

test("the owner tidies a context file, unticking one change, and Recent changes shows the tidy", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  // Markers at the ends of lines script the fake's tidy: merge these two, remove this one.
  await startSaving(
    page,
    [
      "save fact: Double garage (merge)",
      "save fact: The garage is 5.4 m by 5.1 m (merge)",
      "save plan: Get a quote for rubber flooring (stale)",
    ].join("\n"),
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openWhatCourtyardKnows(page);
  await page.getByRole("link", { name: "Tidy", exact: true }).click();

  const proposed = page.getByRole("list", { name: "Proposed changes" });
  await expect(proposed.getByRole("listitem")).toHaveCount(2);
  await proposed.getByRole("checkbox", { name: /Remove from Plans/ }).uncheck();
  await page.getByRole("button", { name: "Save 1 change" }).click();

  const changes = page.getByRole("list", { name: "Recent changes" });
  await expect(changes).toContainText("Tidied");
  await expect(changes).toContainText("Double garage, The garage is 5.4 m by 5.1 m");

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openWhatCourtyardKnows(page);
  const file = page.getByRole("region", { name: "What Courtyard knows" });
  await expect(file).toContainText("Double garage, The garage is 5.4 m by 5.1 m");
  await expect(file).toContainText("Get a quote for rubber flooring (stale)");
  // The session title repeats the first line, so check the second is gone.
  await expect(file).not.toContainText("5.1 m (merge)");
});

// Owner rule (2026-10-12): nothing jumps in. While a model reads the file, Tidy is its title and
// faint rows in the shape of its changes, no spinner and no words, filled in place.
test("while a tidy is asked for, the page keeps its place with faint rows", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/owner-context/tidy", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/tidy");
  const title = page.getByRole("heading", { level: 1, name: "Tidy your owner context" });
  await expect(page.locator("main [data-placeholder]").first()).toBeVisible();
  // What it waits on is said to a screen reader only: the words take no room on screen.
  const words = page.getByRole("status").getByText(/Reading your owner context for lines/);
  expect((await words.boundingBox())?.width).toBeLessThanOrEqual(1);
  const before = await title.boundingBox();

  release();
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  expect(await title.boundingBox()).toEqual(before);
});
