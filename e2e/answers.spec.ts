import { expect, type Page, test } from "@playwright/test";

/** Starts a session with `message`; the fake model echoes it back, Markdown and all. */
const ask = async (page: Page, message: string) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session.locator("[aria-live]").last()).toHaveAttribute("aria-busy", "false");
  return session;
};

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test.describe("copying", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copies a finished answer's Markdown as it was written, and says so", async ({ page }) => {
    const message = "**Bold** and a [link](https://courtyard.example/rack).";
    const session = await ask(page, message);

    await session.getByRole("button", { name: "Copy answer" }).click();
    expect(await clipboard(page)).toBe(`You said: ${message}`);
    await expect(session.getByRole("status")).toHaveText("Copied");
    // A couple of seconds on, it's back to a copy button.
    await expect(session.getByRole("status")).toBeEmpty({ timeout: 5_000 });
    await expect(session.getByRole("button", { name: "Copy answer" })).toBeVisible();
  });
});
