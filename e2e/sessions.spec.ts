import { expect, test } from "@playwright/test";

test("the owner starts a session, watches the answer stream in, and finds it again later", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");

  await page.getByLabel("Message").fill("Where should the rack go?");
  await page.getByRole("button", { name: "Send" }).click();

  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
  await expect(conversation).toContainText("You said: Where should the rack go?");

  // Reopening the session shows its whole history.
  await page.reload();
  await expect(conversation).toContainText("Where should the rack go?");
  await expect(conversation).toContainText("You said: Where should the rack go?");

  // A failed turn says why, with a retry.
  await page.getByLabel("Message").fill("please fail");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("failed on purpose");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

  await page.getByRole("link", { name: "← Back to the workspace" }).click();
  await expect(page.getByRole("region", { name: "Sessions" })).toContainText(
    "Where should the rack go?",
  );
});
