import { expect, type Page, test } from "@playwright/test";

// A session's flow: whose turn it is (#179), messages queued while a turn runs (#177), and
// scrolling that never moves the owner away from where they are (#168).

/** Words enough that the fake model takes a few seconds to write them. */
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");

/** Starts a session in Garage gym with `text` as its first message, and waits for its page. */
const startSession = async (page: Page, text: string) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
};

const sessionOn = (page: Page) => page.getByRole("list", { name: "Session" });

test.describe("whose turn it is", () => {
  test("a Working line says what the model is doing and for how long, then Your turn marks the end", async ({
    page,
  }) => {
    await startSession(page, `please read, then ${words(60)}`);
    const session = sessionOn(page);

    const working = session.getByText("Working", { exact: true });
    await expect(working).toBeVisible();
    // What it's doing, then how long the turn has taken so far.
    await expect(session).toContainText(/writing the answer0:0\d/);

    await expect(session).toContainText(/Your turn · finished \d\d:\d\d/);
    await expect(working).toHaveCount(0);
  });

  test("a stopped turn is marked as stopped, and the owner's turn", async ({ page }) => {
    await startSession(page, words(200));
    await expect(sessionOn(page).getByText("Working", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();

    await expect(sessionOn(page)).toContainText(/Your turn · stopped \d\d:\d\d/);
  });

  test("the workspace's sessions say which is working and which is the owner's turn", async ({
    page,
  }) => {
    await startSession(page, `The finished one ${words(3)}`);
    await expect(sessionOn(page)).toContainText("Your turn · finished");
    await startSession(page, `The working one ${words(300)}`);
    await expect(sessionOn(page)).toContainText("writing the answer");

    await page.goto("/workspaces/garage-gym");
    const sessions = page.getByRole("region", { name: "Sessions" });
    const working = sessions.getByRole("link", { name: /The working one/i });
    await expect(working).toContainText("Working");
    await expect(working).toContainText(/writing the answer · \d+:\d\d/);
    // A model titles a session once its first answer is in (the fake, from its first words).
    await expect(sessions.getByRole("link", { name: /The finished one/i })).toContainText(
      "Your turn",
    );
    // The sidebar's recent sessions mark the one working with a dot.
    await expect(
      page
        .getByRole("region", { name: "Recent in Garage gym" })
        .getByRole("link", { name: /The working one/i })
        .getByRole("img", { name: "Working" }),
    ).toBeVisible();

    // It's asked again while one works, so the list says when that one ends.
    await expect(working).toContainText("Your turn", { timeout: 45_000 });
  });
});
