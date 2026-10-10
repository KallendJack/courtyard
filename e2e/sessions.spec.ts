import { expect, test } from "@playwright/test";

test("the owner starts a session, watches the answer stream in, and finds it again later", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");

  await page.getByLabel("Message").fill("Where should the rack go?");
  await page.getByRole("button", { name: "Start" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
  await expect(session).toContainText("You said: Where should the rack go?");

  // Reopening the session shows everything it recorded.
  await page.reload();
  await expect(session).toContainText("Where should the rack go?");
  await expect(session).toContainText("You said: Where should the rack go?");

  // A failed turn says why, with a retry.
  await page.getByLabel("Message").fill("please fail");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("failed on purpose");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(session.getByRole("alert")).toHaveCount(2);

  await page.getByRole("link", { name: "Back to Garage gym" }).click();
  // By its first line, or the title a model gave it after the first answer.
  await expect(page.getByRole("region", { name: "Sessions" })).toContainText(
    /where should the rack go/i,
  );
});

test("the owner sees which files the model read", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill("please read the context file first");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("list", { name: "What the model did" })).toHaveText(
    "Read CONTEXT.md",
  );
});

test("what the model writes between what it does shows apart, between its activities, live and on reopening", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await page
    .getByLabel("Message")
    .fill("write: Now the contract.\nread file: docs/notes.md\nwrite: Good, it's imported.");
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });

  const inOrder = async () => {
    // Each piece of text a paragraph of its own, never run together with the next.
    const before = session.getByText("Now the contract.", { exact: true });
    const did = session.getByRole("list", { name: "What the model did" });
    const after = session.getByText("Good, it's imported.", { exact: true });
    await expect(before).toBeVisible();
    await expect(did).toHaveText("Read docs/notes.md");
    await expect(after).toBeVisible();
    const [first, middle, last] = await Promise.all(
      [before, did, after].map(async (each) => (await each.boundingBox())?.y ?? Number.NaN),
    );
    expect(first).toBeLessThan(middle ?? Number.NaN);
    expect(middle).toBeLessThan(last ?? Number.NaN);
  };

  await inOrder();
  await page.reload();
  await inOrder();
});

test("a new session takes the model's title once its first answer is in", async ({ page }) => {
  // A message of its own, so the test can run again on the same worker.
  const stamp = Date.now();
  const message = `plan the garage lighting ${stamp} please`;
  const titled = `Plan The Garage Lighting ${stamp}`;
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(`You said: ${message}`);

  // The fake titles a session with the first few words of its message, in title case.
  await expect(page.getByRole("heading", { level: 1, name: titled, exact: true })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent in Garage gym" });
  await expect(recent.getByRole("link", { name: titled, exact: true })).toBeVisible();
});
