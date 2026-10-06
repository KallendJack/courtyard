import { expect, test } from "@playwright/test";

test("the owner sees every workspace and switches between them in one tap", async ({ page }) => {
  await page.goto("/");

  const list = page.getByRole("main");
  await expect(list.getByRole("link", { name: "Garage gym" })).toBeVisible();
  await expect(list.getByRole("link", { name: /office/ })).toContainText("No context file yet");

  const switcher = page.getByRole("navigation", { name: "Workspaces" });
  await switcher.getByRole("link", { name: "Garage gym" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText(
    "The garage is single, with an up-and-over door.",
  );
  await expect(page.getByRole("region", { name: "Plans" })).toContainText(
    "A squat rack on the left wall.",
  );

  await switcher.getByRole("link", { name: "office" }).click();
  await expect(page.getByText("No context file yet.")).toBeVisible();
});

test("a workspace's address loads it directly", async ({ page }) => {
  const response = await page.goto("/workspaces/garage-gym");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
});

test("warns when a context file grows long enough to crowd every message", async ({ page }) => {
  await page.goto("/workspaces/reading-list");
  await expect(page.getByRole("status")).toContainText("long");

  await page.goto("/workspaces/garage-gym");
  await expect(page.getByRole("region", { name: "Facts" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("the owner adds a workspace from the sidebar, and it opens ready for a first session", async ({
  page,
}) => {
  // A name of its own, so the test can run again on the same worker.
  const name = `Allotment ${Date.now()}`;
  await page.goto("/");
  const switcher = page.getByRole("navigation", { name: "Workspaces" });

  await switcher.getByRole("link", { name: "New workspace" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add workspace" }).click();

  await expect(page).toHaveURL(/\/workspaces\/allotment-\d+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText("Nothing yet.");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(switcher.getByRole("link", { name })).toBeVisible();

  // Its colour can change, and the change stays. A colour it hasn't got, so the test can't pass
  // by doing nothing, chosen by clicking its dot as a person would: the radio itself is hidden.
  await page.getByRole("button", { name: "Change colour" }).click();
  const colours = page.getByRole("group", { name: "Colour" });
  const other = colours.getByRole("radio", { checked: false }).first();
  const colour = await other.getAttribute("value");
  // Each dot's tooltip is its colour's name, the same as its radio's.
  await colours.getByTitle((await other.getAttribute("aria-label")) ?? "", { exact: true }).click();
  await expect(colours).toBeHidden();
  await page.reload();
  await expect(
    switcher.getByRole("link", { name }).locator("[data-workspace-colour]"),
  ).toHaveAttribute("data-workspace-colour", colour ?? "");
});

test("a name another workspace has gets a clear message", async ({ page }) => {
  await page.goto("/new-workspace");

  await page.getByLabel("Name").fill("garage GYM");
  await page.getByRole("button", { name: "Add workspace" }).click();

  await expect(page.getByRole("alert")).toContainText("already a workspace called Garage gym");
  await expect(page).toHaveURL(/\/new-workspace$/);
});
