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

  // Its icon is the one its name suggests (#210). Picked in the Icon sheet, by tapping its tile as
  // a person would (the radio itself is hidden), it shows on its tile at once, and stays.
  const icon = switcher.getByRole("link", { name }).locator("svg[data-workspace-icon]");
  await expect(icon).toHaveAttribute("data-workspace-icon", "sprout");
  await page.getByRole("button", { name: "Change icon" }).click();
  const sheet = page.getByRole("dialog", { name: "Icon" });
  const icons = sheet.getByRole("radiogroup", { name: "Icon" });
  await expect(icons.getByRole("radio")).toHaveCount(15);
  await expect(icons.getByRole("radio", { checked: true })).toHaveAccessibleName("Plant");
  await icons.getByTitle("Music", { exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(icon).toHaveAttribute("data-workspace-icon", "music");
  await page.reload();
  await expect(icon).toHaveAttribute("data-workspace-icon", "music");
});

test("what a new workspace is for, when the owner says, shows under its name as the intro line", async ({
  page,
}) => {
  const name = `Pottery ${Date.now()}`;
  await page.goto("/new-workspace");

  await page.getByLabel("Name").fill(name);
  const forWhat = page.getByLabel("What's it for?");
  await expect(forWhat).toHaveAccessibleDescription(
    "One line. It sits at the top of the context file, and Get to know starts from it.",
  );
  await expect(page.getByText("Optional", { exact: true })).toBeVisible();
  await forWhat.fill("Turning the shed into a pottery studio by spring");
  await page.getByRole("button", { name: "Add workspace" }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Turning the shed into a pottery studio by spring")).toBeVisible();
});

test("a name another workspace has gets a clear message", async ({ page }) => {
  await page.goto("/new-workspace");

  await page.getByLabel("Name").fill("garage GYM");
  await page.getByRole("button", { name: "Add workspace" }).click();

  await expect(page.getByRole("alert")).toContainText("already a workspace called Garage gym");
  await expect(page).toHaveURL(/\/new-workspace$/);
});
