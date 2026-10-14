import { expect, test } from "@playwright/test";
import { chooseEffort, chosen } from "./frame.ts";

// Effort, on the frame's Model sheet beside the model (#194; on every screen since #197).

test("the owner picks an effort beside the model, and the session keeps it", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");

  // A new session starts at the model's default.
  expect((await chosen(page)).effort).toBe("");
  await chooseEffort(page, "high");
  await page.getByLabel("Message", { exact: true }).fill("Plan the whole garage");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Plan the whole garage",
  );
  await page.reload();
  expect((await chosen(page)).effort).toBe("high");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 400, height: 640 } });

  test("the frame's Model sets the effort for the next message, and the session follows it", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByLabel("Message", { exact: true }).fill("Where should the rack go?");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "You said: Where should the rack go?",
    );

    await chooseEffort(page, "low");
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByLabel("Message", { exact: true }).fill("Quickly, the bench?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "You said: Quickly, the bench?",
    );
    // The session follows the effort its last message was sent with.
    await page.reload();
    expect((await chosen(page)).effort).toBe("low");
  });
});
