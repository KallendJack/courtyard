import { expect, test } from "@playwright/test";

test("the owner stops a turn mid-answer, keeps what it wrote, and carries on", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page
    .getByLabel("Message")
    .fill("Tell me everything about racks, benches, bars, plates, flooring, mirrors and lighting.");
  await page.getByRole("button", { name: "Send" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said:");
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(session).toContainText("You stopped this turn.");
  // The answer echoes the message; stopped early, it never reaches the end.
  await expect(session).not.toContainText(
    "You said: Tell me everything about racks, benches, bars, plates, flooring, mirrors and lighting.",
  );

  await page.getByLabel("Message").fill("Just the rack, then.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(session).toContainText("You said: Just the rack, then.");
});
