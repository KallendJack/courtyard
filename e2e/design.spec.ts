import { expect, test } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };

test("shows an answer's Markdown formatted, not as raw marks", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  // The fake model echoes the message back, Markdown and all.
  await page
    .getByLabel("Message", { exact: true })
    .fill("**bold** and\n\n## A heading\n\n1. first\n2. second");
  await page.getByRole("button", { name: "Start" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session.getByRole("heading", { name: "A heading" })).toBeVisible();
  await expect(session.locator("strong", { hasText: "bold" })).toBeVisible();
  await expect(session.locator("ol > li")).toHaveText(["first", "second"]);
  // The owner's own message stays as they typed it; only the answer is formatted.
  await expect(session).not.toContainText("You said: **");
});

test.describe("on a desktop", () => {
  test.use({ viewport: DESKTOP });

  test("collapses the sidebar to a rail with Ctrl+B, and remembers it", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    await expect(workspaces.getByText("Garage gym", { exact: true })).toBeVisible();

    await page.keyboard.press("Control+b");
    await expect(workspaces.getByText("Garage gym", { exact: true })).toBeHidden();
    // Still one tap from every workspace: the rail keeps a link to each.
    await expect(workspaces.getByRole("link", { name: "Garage gym" })).toBeVisible();

    await page.reload();
    await expect(workspaces.getByRole("link", { name: "Garage gym" })).toBeVisible();
    await expect(workspaces.getByText("Garage gym", { exact: true })).toBeHidden();

    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(workspaces.getByText("Garage gym", { exact: true })).toBeVisible();
  });

  test("shows each workspace's icon by its name, the one its name suggests until one is picked", async ({
    page,
  }) => {
    await page.goto("/");
    const icon = (name: string) =>
      page
        .getByRole("navigation", { name: "Workspaces" })
        .getByRole("link", { name })
        .locator("svg[data-workspace-icon]");

    await expect(icon("Reading list")).toHaveAttribute("data-workspace-icon", "book");
    await expect(icon("office")).toHaveAttribute("data-workspace-icon", "briefcase");
    await expect(icon("Side project")).toHaveAttribute("data-workspace-icon", "code");
  });
});

test("is dark whatever the device's setting", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  // Handheld's black, by day and by night (#210), and the browser's own bars to match.
  expect(await background()).toBe("rgb(7, 7, 7)");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#070707");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).toBe("rgb(7, 7, 7)");
});

test("never loads an image an answer points to, so an answer can't send data away", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("courtyard.example")) requested.push(request.url());
  });
  await page.goto("/workspaces/garage-gym");
  await page
    .getByLabel("Message", { exact: true })
    .fill("![the plan](https://courtyard.example/plan.png?secret=1)");
  await page.getByRole("button", { name: "Start" }).click();

  const session = page.getByRole("list", { name: "Session" });
  // Shown as a link the owner can choose to open, never fetched by itself.
  await expect(session.getByRole("link", { name: "the plan" })).toBeVisible();
  await expect(session.locator("img")).toHaveCount(0);
  expect(requested).toEqual([]);
});

test.describe("while typing on a desktop", () => {
  test.use({ viewport: DESKTOP });

  test("leaves Ctrl+B to the message box", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    await page.getByLabel("Message", { exact: true }).press("Control+b");

    await expect(workspaces.getByText("Garage gym", { exact: true })).toBeVisible();
  });
});
