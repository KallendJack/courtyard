import { expect, test } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };

test("shows an answer's Markdown formatted, not as raw marks", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  // The fake model echoes the message back, Markdown and all.
  await page.getByLabel("Message").fill("**bold** and\n\n## A heading\n\n1. first\n2. second");
  await page.getByRole("button", { name: "Send" }).click();

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

  test("gives each workspace its own colour, the same on every visit", async ({ page }) => {
    await page.goto("/");
    const dotColour = (name: string) =>
      page
        .getByRole("navigation", { name: "Workspaces" })
        .getByRole("link", { name })
        .locator("[data-workspace-colour]")
        .evaluate((dot) => getComputedStyle(dot).backgroundColor);

    const first = await dotColour("Garage gym");
    expect(first).not.toBe(await dotColour("office"));
    await page.reload();
    expect(await dotColour("Garage gym")).toBe(first);
  });
});

test("follows the device's dark mode", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const light = await background();
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await background();

  // Moorland's mist by day, its peat-dark by night.
  expect(light).toBe("rgb(243, 240, 236)");
  expect(dark).toBe("rgb(27, 24, 26)");
});
