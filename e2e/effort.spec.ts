import { expect, test } from "@playwright/test";

test("the owner picks an effort beside the model, and the session keeps it", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  const effort = page.getByLabel("Effort");

  // A new session starts at the model's default.
  await expect(effort.locator("option:checked")).toHaveText("Default effort (Medium)");
  await effort.selectOption({ label: "High effort" });
  await page.getByLabel("Message").fill("Plan the whole garage");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Plan the whole garage",
  );
  await page.reload();
  await expect(page.getByLabel("Effort").locator("option:checked")).toHaveText("High effort");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 400, height: 640 } });

  test("the chip above the message box opens the model and effort, for the next message", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByLabel("Message").fill("Where should the rack go?");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "You said: Where should the rack go?",
    );

    const chip = page.getByRole("button", { name: /^Fake \(echoes you\) · Default effort/ });
    await chip.click();
    const sheet = page.getByRole("dialog", { name: "Model for this session" });
    await sheet.getByLabel("Effort").selectOption({ label: "Low effort" });
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Fake (echoes you) · Low effort" }),
    ).toBeVisible();

    await page.getByLabel("Message").fill("Quickly, the bench?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "You said: Quickly, the bench?",
    );
    // The session follows the effort its last message was sent with.
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Fake (echoes you) · Low effort" }),
    ).toBeVisible();
  });
});
