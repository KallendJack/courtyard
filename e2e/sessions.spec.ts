import { expect, test } from "@playwright/test";

test("the owner starts a session, watches the answer stream in, and finds it again later", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");

  await page.getByLabel("Message").fill("Where should the rack go?");
  await page.getByRole("button", { name: "Send" }).click();

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
  await expect(page.getByRole("region", { name: "Sessions" })).toContainText(
    "Where should the rack go?",
  );
});

test("the owner sees which files the model read", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill("please read the context file first");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("list", { name: "What the model did" })).toHaveText(
    "Read CONTEXT.md",
  );
});
