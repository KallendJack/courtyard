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

/** What's on the clipboard, with line ends as written (Windows' clipboard turns them into \r\n). */
const clipboard = async (page: Page) =>
  (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n");

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

  test("a code block names its language and copies just its code", async ({ page }) => {
    const code = "def one_rep_max(weight, reps):\n    return round(weight * (1 + reps / 30), 1)";
    const session = await ask(
      page,
      `To work it out:\n\n\`\`\`python\n${code}\n\`\`\`\n\nThat's all.`,
    );

    const block = session.getByRole("figure", { name: "Python" });
    await block.getByRole("button", { name: "Copy code" }).click();
    expect(await clipboard(page)).toBe(code);
    await expect(block.getByRole("status")).toHaveText("Copied");
    await expect(block.getByRole("status")).toBeEmpty({ timeout: 5_000 });
  });
});
